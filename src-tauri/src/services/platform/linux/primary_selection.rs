//! Which window the primary selection was made in.
//!
//! The primary selection is one for the whole session: it holds what was
//! selected last, in whatever window. Taken as it is, the context of an
//! activation could come from a window other than the one Tyco was called
//! from. So every change of the selection is attributed to the window that
//! had the focus at that moment, and an activation takes the selection only
//! when it was made in its own window.
//!
//! A change made while a Tyco window has the focus is attributed to the window
//! Tyco was called from: the change is reported asynchronously, so a hotkey
//! pressed right after selecting may open a Tyco window first.
//!
//! Wayland only: `wl-paste --watch` reports the changes, and the window
//! tracker tells the focused window. Without either (X11, a compositor that
//! lacks the data control protocol, or no tracker backend) nothing is known
//! about the owner, and the selection is taken as it is.

use crate::locks::MutexExt;
use std::io::Read;
use std::os::unix::process::CommandExt;
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use super::backoff::DISPLAY_RECONNECT;

use crate::services::platform::window_tracker::tracker;

/// A watch that keeps failing is not supported by the compositor.
const MAX_FAILURES: u32 = 5;
/// How often an idle watcher checks for output and for a stop.
const READ_POLL_INTERVAL: Duration = Duration::from_millis(20);

#[derive(Debug, Default)]
struct SelectionOriginState {
    watching: bool,
    /// `wl-paste --watch` reports the selection it finds at start, which was
    /// made before the watch, in a window nobody knows.
    initial_pending: bool,
    /// The window the selection was last made in, see the module docs; `None`
    /// when it is not known, or no application window had the focus.
    owner_window_id: Option<String>,
}

impl SelectionOriginState {
    fn watch_started(&mut self) {
        self.watching = true;
        self.initial_pending = true;
        self.owner_window_id = None;
    }

    fn watch_stopped(&mut self) {
        self.watching = false;
        self.owner_window_id = None;
    }

    fn selection_changed(&mut self, focused: Option<String>) {
        if std::mem::take(&mut self.initial_pending) {
            self.owner_window_id = None;
            return;
        }
        self.owner_window_id = focused;
    }

    /// `None` when the owner is not watched, so it cannot be told.
    fn is_selection_from_window(&self, window_id: Option<&str>) -> Option<bool> {
        if !self.watching {
            return None;
        }
        Some(window_id.is_some() && self.owner_window_id.as_deref() == window_id)
    }
}

fn state() -> &'static Mutex<SelectionOriginState> {
    static STATE: OnceLock<Mutex<SelectionOriginState>> = OnceLock::new();
    STATE.get_or_init(Mutex::default)
}

fn update<T>(change: impl FnOnce(&mut SelectionOriginState) -> T) -> T {
    change(&mut state().locked())
}

/// Whether the primary selection was made in `window_id`; `None` when that is
/// not known, see the module docs.
pub fn is_selection_from_window(window_id: Option<&str>) -> Option<bool> {
    if !tracker().is_running() {
        return None;
    }
    update(|state| state.is_selection_from_window(window_id))
}

/// Follows the changes of the primary selection for as long as Tyco runs.
pub fn spawn_watcher(
    services: &crate::services::background::BackgroundServices,
) -> Result<(), crate::errors::AppError> {
    services.spawn_thread("primary-selection", |stop| {
        let mut failures = 0u32;
        while !stop.is_stopped() {
            match watch(&stop) {
                Ok(()) => failures = 0,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    log::warn!(
                        "wl-paste is not installed: the selection of any window may become the context"
                    );
                    return;
                }
                Err(error) => {
                    failures = failures.saturating_add(1);
                    log::warn!("Could not watch the primary selection: {error}");
                    if failures >= MAX_FAILURES {
                        update(SelectionOriginState::watch_stopped);
                        log::warn!(
                            "Gave up watching the primary selection: the selection of any window may become the context"
                        );
                        return;
                    }
                }
            }
            update(SelectionOriginState::watch_stopped);
            if stop.wait(DISPLAY_RECONNECT.delay(failures)) { return; }
        }
    })
}

/// Runs one `wl-paste --watch` until it exits; an error when it failed.
fn watch(stop: &crate::services::background::StopToken) -> std::io::Result<()> {
    let mut command = Command::new("wl-paste");
    command
        .args(["--primary", "--watch", "echo"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    // SAFETY: prctl is async-signal-safe and touches only the child. The
    // watch must not outlive Tyco, which may be killed without a chance to
    // stop it; the thread that spawns it lives until it exits.
    unsafe {
        command.pre_exec(|| {
            if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM) != 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    let mut child = command.spawn()?;
    let result = (|| {
        let Some(mut stdout) = child.stdout.take() else {
            return Ok(());
        };
        use crate::services::platform::process::PollablePipe;
        stdout.prepare()?;
        update(SelectionOriginState::watch_started);
        log::info!("Watching which window the primary selection is made in");
        let mut bytes = [0u8; 1024];
        while !stop.is_stopped() {
            match stdout.read(&mut bytes) {
                Ok(0) => break,
                Ok(count) => {
                    for _ in bytes[..count].iter().filter(|byte| **byte == b'\n') {
                        let owner = tracker().target();
                        update(|state| state.selection_changed(owner));
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    if stop.wait(READ_POLL_INTERVAL) {
                        break;
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
                Err(error) => return Err(error),
            }
        }
        Ok(())
    })();
    let _ = child.kill();
    let status = child.wait()?;
    update(SelectionOriginState::watch_stopped);
    result?;
    if !stop.is_stopped() && !status.success() {
        return Err(std::io::Error::other(format!("wl-paste exited: {status}")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn watching() -> SelectionOriginState {
        let mut state = SelectionOriginState::default();
        state.watch_started();
        state
    }

    #[test]
    fn tells_nothing_without_a_watch() {
        let mut state = SelectionOriginState::default();
        state.selection_changed(Some("a".into()));
        assert_eq!(state.is_selection_from_window(Some("a")), None);
    }

    #[test]
    fn the_selection_found_at_start_has_no_owner() {
        let state = {
            let mut state = watching();
            state.selection_changed(Some("a".into()));
            state
        };
        assert_eq!(state.is_selection_from_window(Some("a")), Some(false));
    }

    #[test]
    fn a_selection_belongs_to_the_window_focused_when_it_changed() {
        let mut state = watching();
        state.selection_changed(None);
        state.selection_changed(Some("a".into()));
        assert_eq!(state.is_selection_from_window(Some("a")), Some(true));

        // selected in another window afterwards: the first one's is gone
        state.selection_changed(Some("b".into()));
        assert_eq!(state.is_selection_from_window(Some("a")), Some(false));
        assert_eq!(state.is_selection_from_window(Some("b")), Some(true));
    }

    #[test]
    fn an_unknown_window_owns_nothing() {
        let mut state = watching();
        state.selection_changed(None);
        state.selection_changed(None);
        assert_eq!(state.is_selection_from_window(None), Some(false));
    }

    #[test]
    fn a_stopped_watch_forgets_the_owner() {
        let mut state = watching();
        state.selection_changed(None);
        state.selection_changed(Some("a".into()));
        state.watch_stopped();
        assert_eq!(state.is_selection_from_window(Some("a")), None);
    }
}
