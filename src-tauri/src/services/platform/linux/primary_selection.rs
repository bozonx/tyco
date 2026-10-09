//! Which window the primary selection was made in.
//!
//! The primary selection is one for the whole session: it holds what was
//! selected last, in whatever window. Taken as it is, the context of an
//! activation could come from a window other than the one Tyco was called
//! from. So every change of the selection is attributed to the window that
//! had the focus at that moment, and an activation takes the selection only
//! when it was made in its own window.
//!
//! Wayland only: `wl-paste --watch` reports the changes. Without it (X11, or a
//! compositor that lacks the data control protocol) nothing is known about the
//! owner, and the selection is taken as it is.

use std::io::{BufRead, BufReader};
use std::os::unix::process::CommandExt;
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;

use crate::services::platform::window_tracker::tracker;

const RETRY_DELAY: Duration = Duration::from_secs(2);
const MAX_RETRY_DELAY: Duration = Duration::from_secs(60);
/// A watch that keeps failing is not supported by the compositor.
const MAX_FAILURES: u32 = 5;

#[derive(Debug, Default)]
struct OwnerState {
    watching: bool,
    /// `wl-paste --watch` reports the selection it finds at start, which was
    /// made before the watch, in a window nobody knows.
    initial_pending: bool,
    /// The window focused when the selection last changed; `None` when it is
    /// not known, or no application window had the focus.
    owner: Option<String>,
}

impl OwnerState {
    fn watch_started(&mut self) {
        self.watching = true;
        self.initial_pending = true;
        self.owner = None;
    }

    fn watch_stopped(&mut self) {
        self.watching = false;
        self.owner = None;
    }

    fn selection_changed(&mut self, focused: Option<String>) {
        if std::mem::take(&mut self.initial_pending) {
            self.owner = None;
            return;
        }
        self.owner = focused;
    }

    /// `None` when the owner is not watched, so it cannot be told.
    fn made_in(&self, window_id: Option<&str>) -> Option<bool> {
        if !self.watching {
            return None;
        }
        Some(window_id.is_some() && self.owner.as_deref() == window_id)
    }
}

fn state() -> &'static Mutex<OwnerState> {
    static STATE: OnceLock<Mutex<OwnerState>> = OnceLock::new();
    STATE.get_or_init(Mutex::default)
}

fn update<T>(change: impl FnOnce(&mut OwnerState) -> T) -> T {
    change(&mut state().lock().expect("primary selection lock poisoned"))
}

/// Whether the primary selection was made in `window_id`; `None` when that is
/// not known, see the module docs.
#[allow(dead_code)]
pub fn made_in(window_id: Option<&str>) -> Option<bool> {
    update(|state| state.made_in(window_id))
}

/// Follows the changes of the primary selection for as long as Tyco runs.
pub fn spawn_watcher() {
    thread::spawn(|| {
        let mut failures = 0u32;
        loop {
            match watch() {
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
                        update(OwnerState::watch_stopped);
                        log::warn!(
                            "Gave up watching the primary selection: the selection of any window may become the context"
                        );
                        return;
                    }
                }
            }
            update(OwnerState::watch_stopped);
            thread::sleep(retry_delay(failures));
        }
    });
}

/// Runs one `wl-paste --watch` until it exits; an error when it failed.
fn watch() -> std::io::Result<()> {
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
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Ok(());
    };
    update(OwnerState::watch_started);
    log::info!("Watching which window the primary selection is made in");

    for line in BufReader::new(stdout).lines() {
        if line.is_err() {
            break;
        }
        let focused = tracker().active_window().map(|window| window.id);
        update(|state| state.selection_changed(focused));
    }
    let status = child.wait()?;
    if !status.success() {
        return Err(std::io::Error::other(format!("wl-paste exited: {status}")));
    }
    log::warn!("The primary selection watch exited");
    Ok(())
}

fn retry_delay(failures: u32) -> Duration {
    RETRY_DELAY
        .saturating_mul(2u32.saturating_pow(failures.saturating_sub(1)))
        .min(MAX_RETRY_DELAY)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn watching() -> OwnerState {
        let mut state = OwnerState::default();
        state.watch_started();
        state
    }

    #[test]
    fn tells_nothing_without_a_watch() {
        let mut state = OwnerState::default();
        state.selection_changed(Some("a".into()));
        assert_eq!(state.made_in(Some("a")), None);
    }

    #[test]
    fn the_selection_found_at_start_has_no_owner() {
        let state = {
            let mut state = watching();
            state.selection_changed(Some("a".into()));
            state
        };
        assert_eq!(state.made_in(Some("a")), Some(false));
    }

    #[test]
    fn a_selection_belongs_to_the_window_focused_when_it_changed() {
        let mut state = watching();
        state.selection_changed(None);
        state.selection_changed(Some("a".into()));
        assert_eq!(state.made_in(Some("a")), Some(true));

        // selected in another window afterwards: the first one's is gone
        state.selection_changed(Some("b".into()));
        assert_eq!(state.made_in(Some("a")), Some(false));
        assert_eq!(state.made_in(Some("b")), Some(true));
    }

    #[test]
    fn an_unknown_window_owns_nothing() {
        let mut state = watching();
        state.selection_changed(None);
        state.selection_changed(None);
        assert_eq!(state.made_in(None), Some(false));
    }

    #[test]
    fn a_stopped_watch_forgets_the_owner() {
        let mut state = watching();
        state.selection_changed(None);
        state.selection_changed(Some("a".into()));
        state.watch_stopped();
        assert_eq!(state.made_in(Some("a")), None);
    }
}
