//! Ends what the windows show, gracefully, before an external request opens
//! something else or runs a command: voice dictation and the dialog stop
//! recording and save their result to the history first. What a hidden
//! window keeps, such as the editor or a chat, is not touched.
use crate::locks::MutexExt;
use std::collections::BTreeSet;
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

use crate::services::runtime::{MAIN_WINDOW_LABEL, QUICK_WINDOW_LABEL};

/// How long a request waits for the windows; a window that does not answer
/// in time does not hold the request up.
const ANSWER_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Default)]
struct PendingRequests {
    next_id: u64,
    /// The request waiting, with the windows that have not answered yet.
    current: Option<(u64, BTreeSet<String>)>,
}

/// The windows asked to end their visible work and which of them answered.
#[derive(Default)]
pub struct VisibleWork {
    pending: Mutex<PendingRequests>,
    answered: Condvar,
}

impl VisibleWork {
    /// A new request to `windows`; it replaces one still waiting.
    fn begin(&self, windows: impl IntoIterator<Item = String>) -> u64 {
        let mut pending = self.pending.locked();
        pending.next_id += 1;
        let id = pending.next_id;
        pending.current = Some((id, windows.into_iter().collect()));
        self.answered.notify_all();
        id
    }

    /// `window` has ended its work for request `id`.
    fn answer(&self, id: u64, window: &str) {
        let mut pending = self.pending.locked();
        if let Some((current, windows)) = pending.current.as_mut() {
            if *current == id {
                windows.remove(window);
            }
        }
        self.answered.notify_all();
    }

    /// Waits until every window answered request `id`, or until `timeout`;
    /// false when time ran out.
    fn wait(&self, id: u64, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        let mut pending = self.pending.locked();
        loop {
            match pending.current.as_ref() {
                Some((current, windows)) if *current == id && !windows.is_empty() => {}
                // answered, or replaced by a newer request
                _ => {
                    if pending
                        .current
                        .as_ref()
                        .is_some_and(|(current, _)| *current == id)
                    {
                        pending.current = None;
                    }
                    return true;
                }
            }
            let now = Instant::now();
            if now >= deadline {
                pending.current = None;
                return false;
            }
            pending = match self.answered.wait_timeout(pending, deadline - now) {
                Ok((guard, _)) => guard,
                Err(poisoned) => poisoned.into_inner().0,
            };
        }
    }
}

/// Asks the windows to end their visible work and waits for them, bounded.
/// Call it off the main thread: the windows answer through IPC.
pub fn end(app: &AppHandle) {
    let windows = [MAIN_WINDOW_LABEL, QUICK_WINDOW_LABEL]
        .into_iter()
        .filter(|label| app.get_webview_window(label).is_some())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let work = app.state::<VisibleWork>();
    let id = work.begin(windows.clone());
    for label in &windows {
        if let Err(error) =
            crate::events::emit_to::<crate::events::EndVisibleWork, _>(app, label.as_str(), id)
        {
            log::warn!("Could not ask {label} to end its work: {error}");
            work.answer(id, label);
        }
    }
    if !work.wait(id, ANSWER_TIMEOUT) {
        log::warn!("A window did not end its visible work in time");
    }
}

/// `window` has ended its visible work for request `id`.
pub fn answer(app: &AppHandle, id: u64, window: &str) {
    app.state::<VisibleWork>().answer(id, window);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn a_request_ends_when_every_window_answered() {
        let work = Arc::new(VisibleWork::default());
        let id = work.begin(["main".to_owned(), "quick".to_owned()]);
        let answering = Arc::clone(&work);
        let thread = std::thread::spawn(move || {
            answering.answer(id, "main");
            answering.answer(id, "quick");
        });
        assert!(work.wait(id, Duration::from_secs(5)));
        thread.join().unwrap();
    }

    #[test]
    fn a_silent_window_does_not_hold_the_request() {
        let work = VisibleWork::default();
        let id = work.begin(["main".to_owned()]);
        work.answer(id + 1, "main");
        assert!(!work.wait(id, Duration::from_millis(20)));
    }

    #[test]
    fn a_request_without_windows_ends_at_once() {
        let work = VisibleWork::default();
        let id = work.begin([]);
        assert!(work.wait(id, Duration::ZERO));
    }

    #[test]
    fn a_newer_request_releases_the_older_one() {
        let work = VisibleWork::default();
        let old = work.begin(["main".to_owned()]);
        let new = work.begin(["main".to_owned()]);
        assert!(work.wait(old, Duration::ZERO));
        work.answer(new, "main");
        assert!(work.wait(new, Duration::ZERO));
    }
}
