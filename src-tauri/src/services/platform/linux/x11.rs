//! Foreign windows on X11. An EWMH window manager publishes the focused
//! window in `_NET_ACTIVE_WINDOW` and the managed ones in `_NET_CLIENT_LIST`
//! on the root window; a property change event tells about every change, so
//! the tracker learns about them without polling. Window ids are decimal, the
//! way `xdotool` prints and takes them.

use std::collections::BTreeSet;
use std::fmt::Display;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use super::backoff::DISPLAY_RECONNECT;

use x11rb::connection::Connection;
use x11rb::properties::WmClass;
use x11rb::protocol::xproto::{
    Atom, AtomEnum, ChangeWindowAttributesAux, ClientMessageEvent, ConnectionExt as _, EventMask,
    Window,
};
use x11rb::protocol::Event;
use x11rb::rust_connection::RustConnection;
use x11rb::CURRENT_TIME;

use crate::errors::AppError;
use crate::services::platform::window_tracker::{
    finish_startup, new_session, tracker, TrackerChange, WindowKind,
};

/// Read the target's class before activation, while Tyco may still have focus.
pub(crate) fn is_terminal_window(id: &str) -> bool {
    let Some(window) = id.parse::<Window>().ok() else {
        return false;
    };
    let Ok((connection, _)) = x11rb::connect(None) else {
        return false;
    };
    WmClass::get(&connection, window)
        .ok()
        .and_then(|cookie| cookie.reply().ok().flatten())
        .is_some_and(|class| {
            crate::services::platform::selection::is_terminal_class(&String::from_utf8_lossy(
                class.class(),
            )) || crate::services::platform::selection::is_terminal_class(&String::from_utf8_lossy(
                class.instance(),
            ))
        })
}

/// How long a window manager may take to focus a window it was asked to.
const ACTIVATION_TIMEOUT: Duration = Duration::from_secs(1);
const ACTIVATION_POLL_INTERVAL: Duration = Duration::from_millis(10);
/// `_NET_ACTIVE_WINDOW` source indication of a pager: window managers that
/// prevent focus stealing honour a request from one, as from the user.
const SOURCE_PAGER: u32 = 2;

/// The focused window, as the window manager publishes it.
pub(crate) fn active_window() -> Option<String> {
    let (connection, screen) = x11rb::connect(None).ok()?;
    let root = connection.setup().roots[screen].root;
    let atom = intern(&connection, "_NET_ACTIVE_WINDOW").ok()?;
    read_active_window(&connection, root, atom).map(|window| window.to_string())
}

/// Asks the window manager to focus `id` and waits until it has, as
/// `xdotool windowactivate --sync` does.
pub(crate) fn activate_window(id: &str) -> Result<(), AppError> {
    let window = id
        .parse::<Window>()
        .map_err(|_| AppError::InvalidInput(format!("Invalid X11 window id: {id}")))?;
    let (connection, screen) = x11rb::connect(None).map_err(x11_error)?;
    let root = connection.setup().roots[screen].root;
    let atom = intern(&connection, "_NET_ACTIVE_WINDOW")?;
    if read_active_window(&connection, root, atom) == Some(window) {
        return Ok(());
    }
    request_window_activation(&connection, root, atom, window)?;
    let deadline = std::time::Instant::now() + ACTIVATION_TIMEOUT;
    while std::time::Instant::now() < deadline {
        if read_active_window(&connection, root, atom) == Some(window) {
            return Ok(());
        }
        std::thread::sleep(ACTIVATION_POLL_INTERVAL);
    }
    Err(AppError::Stale(String::from(
        "The target window did not get the focus back",
    )))
}

/// Asks the window manager to focus `id` when it is still on the current
/// desktop, without waiting or switching workspaces.
pub(crate) fn restore_window_focus(id: &str) {
    let Ok(window) = id.parse::<Window>() else {
        return;
    };
    let Ok((connection, screen)) = x11rb::connect(None) else {
        return;
    };
    let root = connection.setup().roots[screen].root;
    let Ok(active_atom) = intern(&connection, "_NET_ACTIVE_WINDOW") else {
        return;
    };
    if read_active_window(&connection, root, active_atom) == Some(window) {
        return;
    }
    if let (Ok(current_atom), Ok(window_atom)) = (
        intern(&connection, "_NET_CURRENT_DESKTOP"),
        intern(&connection, "_NET_WM_DESKTOP"),
    ) {
        let current = read_cardinal(&connection, root, current_atom);
        let target = read_cardinal(&connection, window, window_atom);
        if !stays_on_current_desktop(current, target) {
            return;
        }
    }
    let _ = request_window_activation(&connection, root, active_atom, window);
}

fn request_window_activation(
    connection: &RustConnection,
    root: Window,
    active_atom: Atom,
    window: Window,
) -> Result<(), AppError> {
    let event = ClientMessageEvent::new(
        32,
        window,
        active_atom,
        [SOURCE_PAGER, CURRENT_TIME, 0, 0, 0],
    );
    connection
        .send_event(
            false,
            root,
            EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY,
            event,
        )
        .map_err(x11_error)?
        .check()
        .map_err(x11_error)
}

fn read_cardinal(connection: &RustConnection, window: Window, atom: Atom) -> Option<u32> {
    connection
        .get_property(false, window, atom, AtomEnum::CARDINAL, 0, 1)
        .ok()?
        .reply()
        .ok()?
        .value32()?
        .next()
}

/// `0xFFFF_FFFF` is EWMH's sticky desktop value (visible on all desktops).
fn stays_on_current_desktop(current: Option<u32>, target: Option<u32>) -> bool {
    match (current, target) {
        (Some(current), Some(target)) => target == current || target == u32::MAX,
        _ => true,
    }
}

/// Moves Tyco's normal window to the active desktop and focuses it.
pub(crate) fn activate_own_window(own_class: &str) -> Result<(), AppError> {
    let Ok((connection, screen)) = x11rb::connect(None) else {
        return Ok(());
    };
    let root = connection.setup().roots[screen].root;
    let atoms = Atoms {
        active_window: intern(&connection, "_NET_ACTIVE_WINDOW")?,
        client_list: intern(&connection, "_NET_CLIENT_LIST")?,
        wm_pid: intern(&connection, "_NET_WM_PID")?,
        window_type: intern(&connection, "_NET_WM_WINDOW_TYPE")?,
        text_types: [
            intern(&connection, TEXT_WINDOW_TYPES[0])?,
            intern(&connection, TEXT_WINDOW_TYPES[1])?,
        ],
    };
    let current_desktop_atom = intern(&connection, "_NET_CURRENT_DESKTOP")?;
    let wm_desktop_atom = intern(&connection, "_NET_WM_DESKTOP")?;
    let watcher = Watcher {
        connection: &connection,
        root,
        atoms,
        own_class: own_class.to_owned(),
        pid: std::process::id(),
    };
    let Some(own_window) = watcher.clients().into_iter().find(|&w| {
        let class = watcher.class(w);
        watcher.kind(w, &class) == WindowKind::Own
    }) else {
        return Ok(());
    };
    if let Ok(cookie) =
        connection.get_property(false, root, current_desktop_atom, AtomEnum::CARDINAL, 0, 1)
    {
        if let Ok(reply) = cookie.reply() {
            if let Some(current_desktop) = reply.value32().and_then(|mut iter| iter.next()) {
                let event = ClientMessageEvent::new(
                    32,
                    own_window,
                    wm_desktop_atom,
                    [current_desktop, SOURCE_PAGER, 0, 0, 0],
                );
                let _ = connection.send_event(
                    false,
                    root,
                    EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY,
                    event,
                );
            }
        }
    }
    request_window_activation(&connection, root, watcher.atoms.active_window, own_window)
}

fn intern(connection: &RustConnection, name: &str) -> Result<Atom, AppError> {
    Ok(connection
        .intern_atom(false, name.as_bytes())
        .map_err(x11_error)?
        .reply()
        .map_err(x11_error)?
        .atom)
}

fn read_active_window(connection: &RustConnection, root: Window, atom: Atom) -> Option<Window> {
    connection
        .get_property(false, root, atom, AtomEnum::WINDOW, 0, 1)
        .ok()?
        .reply()
        .ok()?
        .value32()?
        .next()
        .filter(|window| *window != x11rb::NONE)
}

const LOGGED_FAILURES: u32 = 3;
/// How often an idle event loop checks for new events and for a stop.
const EVENT_POLL_INTERVAL: Duration = Duration::from_millis(20);

/// Window types that text can be inserted into. A window without a type is a
/// normal one, as EWMH says for managed windows.
const TEXT_WINDOW_TYPES: [&str; 2] = ["_NET_WM_WINDOW_TYPE_NORMAL", "_NET_WM_WINDOW_TYPE_DIALOG"];

struct Atoms {
    active_window: Atom,
    client_list: Atom,
    wm_pid: Atom,
    window_type: Atom,
    text_types: [Atom; 2],
}

/// Tracks windows on a thread of its own for the lifetime of the process.
/// `own_class` is the WM_CLASS of Tyco windows; `on_change` hears about every
/// change the tracker applied.
pub fn spawn_tracker(
    services: &crate::services::background::BackgroundServices,
    own_class: String,
    on_change: impl Fn(TrackerChange) + Send + 'static,
) -> Result<(), AppError> {
    services.spawn_thread("x11-window-tracker", move |stop| {
        supervise(&own_class, &on_change, &stop)
    })
}

fn supervise(
    own_class: &str,
    on_change: &dyn Fn(TrackerChange),
    stop: &crate::services::background::StopToken,
) {
    let mut failures = 0u32;
    while !stop.is_stopped() {
        let error = run(own_class, on_change, &mut failures, stop);
        tracker().reset(false, String::new());
        finish_startup();
        failures += 1;
        if failures <= LOGGED_FAILURES {
            log::warn!("X11 window tracker stopped: {error}");
        } else {
            log::debug!("X11 window tracker is still unavailable: {error}");
        }
        if stop.wait(DISPLAY_RECONNECT.delay(failures)) {
            return;
        }
    }
}

/// Reports windows until the connection fails; returns why it did.
fn run(
    own_class: &str,
    on_change: &dyn Fn(TrackerChange),
    failures: &mut u32,
    stop: &crate::services::background::StopToken,
) -> AppError {
    let (connection, screen) = match x11rb::connect(None) {
        Ok(connected) => connected,
        Err(error) => return x11_error(error),
    };
    let root = connection.setup().roots[screen].root;
    let watcher = match Watcher::new(&connection, root, own_class) {
        Ok(watcher) => watcher,
        Err(error) => return error,
    };
    let session = new_session();
    tracker().reset(true, session.clone());
    let seq = AtomicU64::new(0);
    let next_seq = || format!("{session}:{}", seq.fetch_add(1, Ordering::Relaxed) + 1);

    let mut clients = watcher.clients();
    watcher.report_active(&next_seq());
    finish_startup();
    if *failures == 0 {
        log::info!("Tracking foreign windows through X11 root window events");
    } else {
        log::info!("X11 window tracker started after {failures} failed attempts");
    }
    *failures = 0;

    loop {
        if stop.is_stopped() {
            return AppError::ServiceUnavailable("Window tracker is stopping".into());
        }
        let event = match connection.poll_for_event() {
            Ok(Some(event)) => event,
            Ok(None) => {
                stop.wait(EVENT_POLL_INTERVAL);
                continue;
            }
            Err(error) => return x11_error(error),
        };
        let Event::PropertyNotify(event) = event else {
            continue;
        };
        if event.window != root {
            continue;
        }
        if event.atom == watcher.atoms.active_window {
            if watcher.report_active(&next_seq()) {
                on_change(TrackerChange::Activated);
            }
        } else if event.atom == watcher.atoms.client_list {
            let current = watcher.clients();
            for id in closed_windows(&clients, &current) {
                let id = id.to_string();
                if tracker().window_closed(&next_seq(), &id) {
                    on_change(TrackerChange::Closed(id));
                }
            }
            clients = current;
        }
    }
}

struct Watcher<'a> {
    connection: &'a RustConnection,
    root: Window,
    atoms: Atoms,
    own_class: String,
    pid: u32,
}

impl<'a> Watcher<'a> {
    fn new(
        connection: &'a RustConnection,
        root: Window,
        own_class: &str,
    ) -> Result<Self, AppError> {
        let intern = |name: &str| intern(connection, name);
        let atoms = Atoms {
            active_window: intern("_NET_ACTIVE_WINDOW")?,
            client_list: intern("_NET_CLIENT_LIST")?,
            wm_pid: intern("_NET_WM_PID")?,
            window_type: intern("_NET_WM_WINDOW_TYPE")?,
            text_types: [intern(TEXT_WINDOW_TYPES[0])?, intern(TEXT_WINDOW_TYPES[1])?],
        };
        connection
            .change_window_attributes(
                root,
                &ChangeWindowAttributesAux::new().event_mask(EventMask::PROPERTY_CHANGE),
            )
            .map_err(x11_error)?
            .check()
            .map_err(x11_error)?;
        Ok(Self {
            connection,
            root,
            atoms,
            own_class: own_class.to_owned(),
            pid: std::process::id(),
        })
    }

    /// Reports the focused window; `false` when the tracker did not take it.
    fn report_active(&self, seq: &str) -> bool {
        let active = self
            .property32(self.root, self.atoms.active_window, AtomEnum::WINDOW)
            .and_then(|values| values.first().copied())
            .filter(|window| *window != x11rb::NONE);
        let Some(window) = active else {
            return tracker().window_activated(seq, "", WindowKind::Other, "");
        };
        let class = self.class(window);
        let kind = self.kind(window, &class);
        tracker().window_activated(seq, &window.to_string(), kind, &class.class)
    }

    fn kind(&self, window: Window, class: &WindowClass) -> WindowKind {
        let pid = self
            .property32(window, self.atoms.wm_pid, AtomEnum::CARDINAL)
            .and_then(|values| values.first().copied());
        let types = self
            .property32(window, self.atoms.window_type, AtomEnum::ATOM)
            .unwrap_or_default();
        window_kind(
            pid == Some(self.pid) || class.matches_name(&self.own_class),
            &types,
            &self.atoms.text_types,
        )
    }

    fn class(&self, window: Window) -> WindowClass {
        let class = WmClass::get(self.connection, window)
            .ok()
            .and_then(|cookie| cookie.reply().ok().flatten());
        class.map_or_else(WindowClass::default, |class| WindowClass {
            instance: String::from_utf8_lossy(class.instance()).into_owned(),
            class: String::from_utf8_lossy(class.class()).into_owned(),
        })
    }

    fn clients(&self) -> BTreeSet<Window> {
        self.property32(self.root, self.atoms.client_list, AtomEnum::WINDOW)
            .unwrap_or_default()
            .into_iter()
            .collect()
    }

    /// A 32 bit property; `None` when it is not set or the window is gone.
    fn property32(&self, window: Window, property: Atom, kind: AtomEnum) -> Option<Vec<u32>> {
        let reply = self
            .connection
            .get_property(false, window, property, kind, 0, u32::MAX / 4)
            .ok()?
            .reply()
            .ok()?;
        reply.value32().map(Iterator::collect)
    }
}

/// WM_CLASS: GTK sets the program name as the instance and a capitalized
/// form of it as the class.
#[derive(Debug, Default)]
struct WindowClass {
    instance: String,
    class: String,
}

impl WindowClass {
    fn matches_name(&self, name: &str) -> bool {
        !name.is_empty()
            && (self.instance.eq_ignore_ascii_case(name) || self.class.eq_ignore_ascii_case(name))
    }
}

fn window_kind(own: bool, types: &[Atom], text_types: &[Atom]) -> WindowKind {
    if own {
        WindowKind::Own
    } else if types.is_empty() || types.iter().any(|kind| text_types.contains(kind)) {
        WindowKind::Foreign
    } else {
        WindowKind::Other
    }
}

fn closed_windows<'a>(
    before: &'a BTreeSet<Window>,
    after: &'a BTreeSet<Window>,
) -> impl Iterator<Item = Window> + 'a {
    before.difference(after).copied()
}

fn x11_error(error: impl Display) -> AppError {
    AppError::Failed(format!("X11 request failed: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const NORMAL: Atom = 1;
    const DIALOG: Atom = 2;
    const DOCK: Atom = 3;

    #[test]
    fn classifies_windows_by_owner_and_type() {
        let text_types = [NORMAL, DIALOG];
        assert_eq!(window_kind(true, &[NORMAL], &text_types), WindowKind::Own);
        assert_eq!(
            window_kind(false, &[NORMAL], &text_types),
            WindowKind::Foreign
        );
        assert_eq!(
            window_kind(false, &[DIALOG], &text_types),
            WindowKind::Foreign
        );
        assert_eq!(window_kind(false, &[], &text_types), WindowKind::Foreign);
        assert_eq!(window_kind(false, &[DOCK], &text_types), WindowKind::Other);
    }

    #[test]
    fn matches_the_own_class_in_either_part() {
        let class = WindowClass {
            instance: String::from("tyco"),
            class: String::from("Tyco"),
        };
        assert!(class.matches_name("tyco"));
        assert!(class.matches_name("TYCO"));
        assert!(!class.matches_name("kate"));
        assert!(!WindowClass::default().matches_name(""));
    }

    #[test]
    fn finds_windows_gone_from_the_client_list() {
        let before = BTreeSet::from([1, 2, 3]);
        let after = BTreeSet::from([1, 3, 4]);
        assert_eq!(closed_windows(&before, &after).collect::<Vec<_>>(), [2]);
    }

    #[test]
    fn restores_focus_only_on_the_current_or_sticky_desktop() {
        assert!(stays_on_current_desktop(Some(1), Some(1)));
        assert!(stays_on_current_desktop(Some(1), Some(u32::MAX)));
        assert!(!stays_on_current_desktop(Some(1), Some(2)));
        assert!(stays_on_current_desktop(None, Some(2)));
        assert!(stays_on_current_desktop(Some(1), None));
    }
}
