//! Foreign windows on X11. An EWMH window manager publishes the focused
//! window in `_NET_ACTIVE_WINDOW` and the managed ones in `_NET_CLIENT_LIST`
//! on the root window; a property change event tells about every change, so
//! the tracker learns about them without polling. Window ids are decimal, the
//! way `xdotool` prints and takes them.
//!
//! The tracker keeps a connection of its own and sleeps in `poll(2)` until
//! the server sends something. The short requests of an activation share one
//! more connection, opened on first use and opened again once it fails.

use std::collections::BTreeSet;
use std::os::fd::AsRawFd;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::backoff::DISPLAY_RECONNECT;
use super::readiness::{wait_readable, Readiness, StopFd};
use crate::locks::MutexExt;

use x11rb::connection::Connection;
use x11rb::properties::WmClass;
use x11rb::protocol::xproto::{
    Atom, AtomEnum, ChangeWindowAttributesAux, ClientMessageEvent, ConnectionExt as _,
    CreateWindowAux, EventMask, PropMode, Window, WindowClass as XWindowClass,
};
use x11rb::protocol::Event;
use x11rb::rust_connection::RustConnection;
use x11rb::CURRENT_TIME;

use crate::errors::AppError;
use crate::services::platform::window_tracker::{
    finish_startup, new_session, tracker, TrackerChange, WindowKind,
};

/// The connection for short requests, with the atoms they use.
struct Display {
    connection: RustConnection,
    root: Window,
    atoms: Atoms,
    current_desktop: Atom,
    wm_desktop: Atom,
    /// An unmapped window of Tyco's, to learn the server time on, see
    /// `server_time`.
    time_window: Window,
    time_property: Atom,
    /// `server_time` waits for an event of this connection; one at a time.
    time_lock: Mutex<()>,
}

impl Display {
    fn open() -> Result<Self, AppError> {
        let (connection, screen) = x11rb::connect(None).map_err(x11_error)?;
        let root = connection.setup().roots[screen].root;
        let atoms = Atoms::intern(&connection)?;
        let current_desktop = intern(&connection, "_NET_CURRENT_DESKTOP")?;
        let wm_desktop = intern(&connection, "_NET_WM_DESKTOP")?;
        let time_property = intern(&connection, "_TYCO_TIMESTAMP")?;
        let time_window = connection.generate_id().map_err(x11_error)?;
        connection
            .create_window(
                0,
                time_window,
                root,
                -1,
                -1,
                1,
                1,
                0,
                XWindowClass::INPUT_ONLY,
                0,
                &CreateWindowAux::new().event_mask(EventMask::PROPERTY_CHANGE),
            )
            .map_err(x11_error)?
            .check()
            .map_err(x11_error)?;
        Ok(Self {
            connection,
            root,
            atoms,
            current_desktop,
            wm_desktop,
            time_window,
            time_property,
            time_lock: Mutex::new(()),
        })
    }

    fn active_window(&self) -> Option<Window> {
        read_active_window(&self.connection, self.root, self.atoms.active_window)
    }

    /// The current server time, the way GDK learns it: appending nothing to a
    /// property of an own window still makes the server send a property
    /// event, stamped with its time. `CURRENT_TIME` when no event comes.
    fn server_time(&self) -> u32 {
        const TIMEOUT: Duration = Duration::from_millis(200);
        let _lock = self.time_lock.locked();
        let appended = self
            .connection
            .change_property(
                PropMode::APPEND,
                self.time_window,
                self.time_property,
                AtomEnum::STRING,
                8,
                0,
                &[],
            )
            .map_err(x11_error)
            .and_then(|_| self.connection.flush().map_err(x11_error));
        if appended.is_err() {
            return CURRENT_TIME;
        }
        let deadline = Instant::now() + TIMEOUT;
        while Instant::now() < deadline {
            match self.connection.poll_for_event() {
                Ok(Some(Event::PropertyNotify(event))) if event.window == self.time_window => {
                    return event.time;
                }
                Ok(Some(_)) => {}
                Ok(None) => std::thread::sleep(Duration::from_millis(1)),
                Err(_) => break,
            }
        }
        CURRENT_TIME
    }
}

/// Runs `request` on the shared connection, see the module docs.
fn with_display<T>(request: impl FnOnce(&Display) -> Result<T, AppError>) -> Result<T, AppError> {
    static DISPLAY: Mutex<Option<Arc<Display>>> = Mutex::new(None);

    let display = {
        let mut cached = DISPLAY.locked();
        match cached.as_ref() {
            Some(display) => Arc::clone(display),
            None => {
                let display = Arc::new(Display::open()?);
                *cached = Some(Arc::clone(&display));
                display
            }
        }
    };
    let result = request(&display);
    if result.is_err() && !is_alive(&display.connection) {
        let mut cached = DISPLAY.locked();
        if cached
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, &display))
        {
            *cached = None;
        }
    }
    result
}

/// Whether the server still answers: a failed request may be an X error of a
/// window that is gone rather than a broken connection.
fn is_alive(connection: &RustConnection) -> bool {
    connection
        .get_input_focus()
        .ok()
        .and_then(|cookie| cookie.reply().ok())
        .is_some()
}

/// Whether the primary selection belongs to the client of window `id`. A
/// client keeps its selections on a window of its own, often a hidden one,
/// but every window it creates shares its resource id base. `None` when
/// that cannot be told.
pub(crate) fn is_primary_selection_from(id: &str) -> Option<bool> {
    let window = id.parse::<Window>().ok()?;
    with_display(|display| {
        let owner = display
            .connection
            .get_selection_owner(AtomEnum::PRIMARY.into())
            .map_err(x11_error)?
            .reply()
            .map_err(x11_error)?
            .owner;
        if owner == x11rb::NONE {
            return Ok(false);
        }
        Ok(is_same_client(
            owner,
            window,
            display.connection.setup().resource_id_mask,
        ))
    })
    .ok()
}

fn is_same_client(first: Window, second: Window, resource_id_mask: u32) -> bool {
    first & !resource_id_mask == second & !resource_id_mask
}

/// Waits until no modifier key is held, at most `timeout`; whether none is.
/// X11 keeps the key state of every keyboard apart, so a modifier the user
/// still holds stays down whatever a virtual keyboard releases, and would
/// turn Ctrl+C into Ctrl+Alt+C.
pub(crate) fn wait_for_modifiers_released(timeout: Duration) -> bool {
    let waited = with_display(|display| {
        let connection = &display.connection;
        let modifiers = connection
            .get_modifier_mapping()
            .map_err(x11_error)?
            .reply()
            .map_err(x11_error)?
            .keycodes;
        let deadline = Instant::now() + timeout;
        loop {
            let keys = connection
                .query_keymap()
                .map_err(x11_error)?
                .reply()
                .map_err(x11_error)?
                .keys;
            if !is_any_key_down(&keys, &modifiers) {
                return Ok(true);
            }
            if Instant::now() >= deadline {
                log::debug!("Modifier keys are still held; pressing the keys anyway");
                return Ok(false);
            }
            std::thread::sleep(ACTIVATION_POLL_INTERVAL);
        }
    });
    waited.unwrap_or(true)
}

/// Whether any of `keycodes` is down in a `QueryKeymap` bit vector.
fn is_any_key_down(keymap: &[u8; 32], keycodes: &[u8]) -> bool {
    keycodes
        .iter()
        .filter(|&&keycode| keycode != 0)
        .any(|&keycode| keymap[usize::from(keycode / 8)] & (1 << (keycode % 8)) != 0)
}

/// Read the target's class before activation, while Tyco may still have focus.
pub(crate) fn is_terminal_window(id: &str, extra: &[String]) -> bool {
    let Some(window) = id.parse::<Window>().ok() else {
        return false;
    };
    with_display(|display| {
        Ok(WmClass::get(&display.connection, window)
            .ok()
            .and_then(|cookie| cookie.reply().ok().flatten())
            .is_some_and(|class| {
                use crate::services::platform::terminals::is_terminal_class;
                is_terminal_class(&String::from_utf8_lossy(class.class()), extra)
                    || is_terminal_class(&String::from_utf8_lossy(class.instance()), extra)
            }))
    })
    .unwrap_or(false)
}

/// How long a window manager may take to focus a window it was asked to.
const ACTIVATION_TIMEOUT: Duration = Duration::from_secs(1);
const ACTIVATION_POLL_INTERVAL: Duration = Duration::from_millis(10);
/// `_NET_ACTIVE_WINDOW` source indication of a pager or taskbar. Tyco
/// activates a window of another application on the user's explicit command,
/// the way a taskbar does; as an application (source 1) it would ask for the
/// focus for itself, and focus stealing prevention would rightly refuse to
/// hand another client's window the focus.
const SOURCE_PAGER: u32 = 2;

/// The focused window, as the window manager publishes it.
pub(crate) fn active_window() -> Option<String> {
    with_display(|display| Ok(display.active_window()))
        .ok()
        .flatten()
        .map(|window| window.to_string())
}

/// Asks the window manager to focus `id` and waits until it has, as
/// `xdotool windowactivate --sync` does. The running tracker hears of the
/// change from the server; without it the property is read again.
pub(crate) fn activate_window(id: &str) -> Result<(), AppError> {
    let window = id
        .parse::<Window>()
        .map_err(|_| AppError::InvalidInput(format!("Invalid X11 window id: {id}")))?;
    let not_focused =
        || AppError::Stale(String::from("The target window did not get the focus back"));
    let polled = with_display(|display| {
        if display.active_window() == Some(window) {
            return Ok(true);
        }
        request_window_activation(display, window)?;
        if tracker().is_running() {
            return Ok(false);
        }
        let deadline = Instant::now() + ACTIVATION_TIMEOUT;
        while Instant::now() < deadline {
            if display.active_window() == Some(window) {
                return Ok(true);
            }
            std::thread::sleep(ACTIVATION_POLL_INTERVAL);
        }
        Err(not_focused())
    })?;
    if polled {
        return Ok(());
    }
    tracker()
        .wait_until_active(id, ACTIVATION_TIMEOUT)
        .map_err(|_| not_focused())
}

/// Asks the window manager to focus `id` when it is still on the current
/// desktop, without waiting or switching workspaces.
pub(crate) fn restore_window_focus(id: &str) {
    let Ok(window) = id.parse::<Window>() else {
        return;
    };
    let _ = with_display(|display| {
        if display.active_window() == Some(window) {
            return Ok(());
        }
        let current = read_cardinal(&display.connection, display.root, display.current_desktop);
        let target = read_cardinal(&display.connection, window, display.wm_desktop);
        if !stays_on_current_desktop(current, target) {
            return Ok(());
        }
        request_window_activation(display, window)
    });
}

/// EWMH asks for the time of the user action; the server time stands in for
/// it, as a request with no time at all is taken for a buggy client.
fn request_window_activation(display: &Display, window: Window) -> Result<(), AppError> {
    let event = ClientMessageEvent::new(
        32,
        window,
        display.atoms.active_window,
        [
            SOURCE_PAGER,
            display.server_time(),
            display.active_window().unwrap_or(x11rb::NONE),
            0,
            0,
        ],
    );
    send_to_root(display, event)
}

fn send_to_root(display: &Display, event: ClientMessageEvent) -> Result<(), AppError> {
    display
        .connection
        .send_event(
            false,
            display.root,
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

/// Moves Tyco's normal window to the active desktop, unless it is there or
/// on every desktop already, and focuses it.
pub(crate) fn activate_own_window(own_class: &str) -> Result<(), AppError> {
    with_display(|display| {
        let watcher = Watcher {
            connection: &display.connection,
            root: display.root,
            atoms: display.atoms,
            own_class: own_class.to_owned(),
            pid: std::process::id(),
        };
        let own_window = watcher
            .clients()
            .into_iter()
            .find(|&window| watcher.is_own_main_window(window))
            .ok_or_else(|| AppError::Failed(String::from("No normal Tyco window is managed")))?;
        let current = read_cardinal(&display.connection, display.root, display.current_desktop);
        let on_desktop = read_cardinal(&display.connection, own_window, display.wm_desktop);
        if let Some(desktop) = current.filter(|_| !stays_on_current_desktop(current, on_desktop)) {
            let event = ClientMessageEvent::new(
                32,
                own_window,
                display.wm_desktop,
                [desktop, SOURCE_PAGER, 0, 0, 0],
            );
            send_to_root(display, event)?;
        }
        request_window_activation(display, own_window)
    })
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

/// Window types that text can be inserted into. A window without a type is a
/// normal one, as EWMH says for managed windows.
const TEXT_WINDOW_TYPES: [&str; 2] = ["_NET_WM_WINDOW_TYPE_NORMAL", "_NET_WM_WINDOW_TYPE_DIALOG"];

#[derive(Clone, Copy)]
struct Atoms {
    active_window: Atom,
    client_list: Atom,
    wm_pid: Atom,
    window_type: Atom,
    text_types: [Atom; 2],
}

impl Atoms {
    fn intern(connection: &RustConnection) -> Result<Self, AppError> {
        let intern = |name: &str| intern(connection, name);
        Ok(Self {
            active_window: intern("_NET_ACTIVE_WINDOW")?,
            client_list: intern("_NET_CLIENT_LIST")?,
            wm_pid: intern("_NET_WM_PID")?,
            window_type: intern("_NET_WM_WINDOW_TYPE")?,
            text_types: [intern(TEXT_WINDOW_TYPES[0])?, intern(TEXT_WINDOW_TYPES[1])?],
        })
    }
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
    let stop_fd = match StopFd::new(stop) {
        Ok(stop_fd) => stop_fd,
        Err(error) => {
            log::warn!("X11 window tracker cannot wait for events: {error}");
            finish_startup();
            return;
        }
    };
    let mut failures = 0u32;
    while !stop.is_stopped() {
        let error = run(own_class, on_change, &mut failures, &stop_fd);
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
    stop: &StopFd,
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

    let socket = connection.stream().as_raw_fd();
    loop {
        // takes what the socket has; queued events come first
        let event = match connection.poll_for_event() {
            Ok(Some(event)) => event,
            Ok(None) => match wait_readable(socket, stop) {
                Ok(Readiness::Readable) => continue,
                Ok(Readiness::Stopped) => {
                    return AppError::ServiceUnavailable("Window tracker is stopping".into());
                }
                Err(error) => return x11_error(error),
            },
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
        let atoms = Atoms::intern(connection)?;
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
        window_kind(
            self.is_own(window, class),
            &self.types(window),
            &self.atoms.text_types,
        )
    }

    fn is_own(&self, window: Window, class: &WindowClass) -> bool {
        let pid = self
            .property32(window, self.atoms.wm_pid, AtomEnum::CARDINAL)
            .and_then(|values| values.first().copied());
        pid == Some(self.pid) || class.matches_name(&self.own_class)
    }

    fn types(&self, window: Window) -> Vec<Atom> {
        self.property32(window, self.atoms.window_type, AtomEnum::ATOM)
            .unwrap_or_default()
    }

    /// A normal window of Tyco: not its quick panel or a dialog.
    fn is_own_main_window(&self, window: Window) -> bool {
        let types = self.types(window);
        self.is_own(window, &self.class(window))
            && (types.is_empty() || types.contains(&self.atoms.text_types[0]))
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

fn x11_error(error: impl std::fmt::Display) -> AppError {
    AppError::Failed(format!("X11 request failed: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_of_one_client_share_the_resource_id_base() {
        let mask = 0x001F_FFFF;
        assert!(is_same_client(0x0420_0001, 0x0420_00A3, mask));
        assert!(!is_same_client(0x0420_0001, 0x0440_0001, mask));
    }

    #[test]
    fn tells_held_keys_from_the_keymap_bits() {
        let mut keymap = [0u8; 32];
        // keycode 37, the left Ctrl of a usual X11 keymap
        keymap[4] = 1 << 5;
        assert!(is_any_key_down(&keymap, &[50, 37]));
        assert!(!is_any_key_down(&keymap, &[50, 0]));
    }

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
