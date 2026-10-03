//! Foreign windows on X11. An EWMH window manager publishes the focused
//! window in `_NET_ACTIVE_WINDOW` and the managed ones in `_NET_CLIENT_LIST`
//! on the root window; a property change event tells about every change, so
//! the tracker learns about them without polling. Window ids are decimal, the
//! way `xdotool` prints and takes them.

use std::collections::BTreeSet;
use std::fmt::Display;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use x11rb::connection::Connection;
use x11rb::properties::WmClass;
use x11rb::protocol::xproto::{
    Atom, AtomEnum, ChangeWindowAttributesAux, ConnectionExt as _, EventMask, Window,
};
use x11rb::protocol::Event;
use x11rb::rust_connection::RustConnection;

use crate::errors::AppError;
use crate::services::platform::window_tracker::{
    finish_startup, new_session, tracker, TrackerChange, WindowKind,
};

/// The first retry after a lost connection; each next one waits twice as long.
const RETRY_DELAY: Duration = Duration::from_secs(2);
const MAX_RETRY_DELAY: Duration = Duration::from_secs(60);
const LOGGED_FAILURES: u32 = 3;

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
pub fn spawn_tracker(own_class: String, on_change: impl Fn(TrackerChange) + Send + 'static) {
    std::thread::spawn(move || supervise(&own_class, &on_change));
}

fn supervise(own_class: &str, on_change: &dyn Fn(TrackerChange)) -> ! {
    let mut failures = 0u32;
    loop {
        let error = run(own_class, on_change, &mut failures);
        tracker().reset(false, String::new());
        finish_startup();
        failures += 1;
        if failures <= LOGGED_FAILURES {
            log::warn!("X11 window tracker stopped: {error}");
        } else {
            log::debug!("X11 window tracker is still unavailable: {error}");
        }
        std::thread::sleep(retry_delay(failures));
    }
}

fn retry_delay(failures: u32) -> Duration {
    RETRY_DELAY
        .saturating_mul(2u32.saturating_pow(failures.saturating_sub(1)))
        .min(MAX_RETRY_DELAY)
}

/// Reports windows until the connection fails; returns why it did.
fn run(own_class: &str, on_change: &dyn Fn(TrackerChange), failures: &mut u32) -> AppError {
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
        let event = match connection.wait_for_event() {
            Ok(event) => event,
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
        let intern = |name: &str| -> Result<Atom, AppError> {
            Ok(connection
                .intern_atom(false, name.as_bytes())
                .map_err(x11_error)?
                .reply()
                .map_err(x11_error)?
                .atom)
        };
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

    fn kind(&self, window: Window, class: &Class) -> WindowKind {
        let pid = self
            .property32(window, self.atoms.wm_pid, AtomEnum::CARDINAL)
            .and_then(|values| values.first().copied());
        let types = self
            .property32(window, self.atoms.window_type, AtomEnum::ATOM)
            .unwrap_or_default();
        window_kind(
            pid == Some(self.pid) || class.is(&self.own_class),
            &types,
            &self.atoms.text_types,
        )
    }

    fn class(&self, window: Window) -> Class {
        let class = WmClass::get(self.connection, window)
            .ok()
            .and_then(|cookie| cookie.reply().ok().flatten());
        class.map_or_else(Class::default, |class| Class {
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
struct Class {
    instance: String,
    class: String,
}

impl Class {
    fn is(&self, name: &str) -> bool {
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
    AppError::Message(format!("X11 request failed: {error}"))
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
        let class = Class {
            instance: String::from("tyco"),
            class: String::from("Tyco"),
        };
        assert!(class.is("tyco"));
        assert!(class.is("TYCO"));
        assert!(!class.is("kate"));
        assert!(!Class::default().is(""));
    }

    #[test]
    fn finds_windows_gone_from_the_client_list() {
        let before = BTreeSet::from([1, 2, 3]);
        let after = BTreeSet::from([1, 3, 4]);
        assert_eq!(closed_windows(&before, &after).collect::<Vec<_>>(), [2]);
    }

    #[test]
    fn retries_with_a_growing_but_bounded_delay() {
        assert_eq!(retry_delay(1), RETRY_DELAY);
        assert_eq!(retry_delay(2), RETRY_DELAY * 2);
        assert_eq!(retry_delay(40), MAX_RETRY_DELAY);
    }
}
