//! Which window has the keyboard focus, and which one text goes to. The
//! state is the same for every platform; a backend reports window activations
//! to it: a KWin script on KDE Plasma under Wayland, root window events on X11.
//!
//! Reports carry a sequence number "session:number". A backend may deliver
//! them out of order (KWin reports arrive as concurrent D-Bus calls), and a
//! restarted backend must not have its state undone by late reports of the
//! previous one.

// Only the Linux backends feed the tracker and ask about the session so far.
#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use std::sync::{Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::errors::AppError;

/// A change a backend applied to the tracker, for the app to follow.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TrackerChange {
    Activated,
    Closed(String),
}

/// What a backend tells about an activated window.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum WindowKind {
    /// An application window that text can be inserted into.
    Foreign,
    /// A window of Tyco itself.
    Own,
    /// The desktop, a panel, or no window at all.
    #[default]
    Other,
}

impl WindowKind {
    pub fn parse(kind: &str) -> Self {
        match kind {
            "foreign" => Self::Foreign,
            "own" => Self::Own,
            _ => Self::Other,
        }
    }
}

#[derive(Debug, Default, PartialEq, Eq)]
struct TrackerState {
    running: bool,
    /// Tells the reports of the running backend from late ones of an earlier run.
    session: String,
    /// The number of the latest report applied, see `accept`.
    last_seq: u64,
    /// Set by the first report of the backend.
    reported: bool,
    active: Option<String>,
    active_kind: WindowKind,
    /// The resource class (application id) of the active window.
    active_class: String,
    last_foreign: Option<String>,
    missing: Option<String>,
}

impl TrackerState {
    /// Whether a report numbered `seq` ("session:number") is newer than all
    /// applied so far. D-Bus calls are handled concurrently, so a report can
    /// arrive after a later one, and must not undo it.
    fn accept(&mut self, seq: &str) -> bool {
        let Some(number) = seq
            .split_once(':')
            .filter(|(session, _)| *session == self.session)
            .and_then(|(_, number)| number.parse::<u64>().ok())
        else {
            return false;
        };
        if number <= self.last_seq {
            return false;
        }
        self.last_seq = number;
        true
    }

    fn window_activated(&mut self, id: &str, kind: WindowKind) {
        self.reported = true;
        self.active = (!id.is_empty()).then(|| id.to_owned());
        self.active_kind = if id.is_empty() {
            WindowKind::Other
        } else {
            kind
        };
        if self.active_kind == WindowKind::Foreign {
            self.last_foreign = Some(id.to_owned());
        } else if self.active_kind == WindowKind::Other {
            self.last_foreign = None;
        }
    }

    /// The window text goes to: the focused application window, or the one
    /// focused before Tyco when a Tyco window has focus. Focus on the desktop
    /// or a panel means there is no target, rather than some window the user
    /// left long ago.
    fn target(&self) -> Option<String> {
        match self.active_kind {
            WindowKind::Foreign => self.active.clone(),
            WindowKind::Own => self.last_foreign.clone(),
            WindowKind::Other => None,
        }
    }

    fn window_closed(&mut self, id: &str) {
        if self.active.as_deref() == Some(id) {
            self.active = None;
            self.active_kind = WindowKind::Other;
            self.active_class.clear();
        }
        if self.last_foreign.as_deref() == Some(id) {
            self.last_foreign = None;
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ActiveWindow {
    pub id: String,
    pub class: String,
}

pub struct WindowTracker {
    state: Mutex<TrackerState>,
    changed: Condvar,
}

pub fn tracker() -> &'static WindowTracker {
    static TRACKER: OnceLock<WindowTracker> = OnceLock::new();
    TRACKER.get_or_init(|| WindowTracker {
        state: Mutex::new(TrackerState::default()),
        changed: Condvar::new(),
    })
}

impl WindowTracker {
    fn update<T>(&self, update: impl FnOnce(&mut TrackerState) -> T) -> T {
        let result = update(&mut self.state.lock().expect("window tracker lock poisoned"));
        self.changed.notify_all();
        result
    }

    /// Applies a report of the backend; `false` when it was outdated.
    pub fn window_activated(&self, seq: &str, id: &str, kind: WindowKind, class: &str) -> bool {
        self.update(|state| {
            if !state.accept(seq) {
                return false;
            }
            state.window_activated(id, kind);
            class.clone_into(&mut state.active_class);
            true
        })
    }

    /// Applies a report of the backend; `false` when it was outdated.
    pub fn window_closed(&self, seq: &str, id: &str) -> bool {
        self.update(|state| {
            if !state.accept(seq) {
                return false;
            }
            state.window_closed(id);
            true
        })
    }

    pub fn window_missing(&self, id: &str) {
        self.update(|state| {
            state.window_closed(id);
            state.missing = Some(id.to_owned());
        });
    }

    /// The window to insert text into, see `TrackerState::target`, if a
    /// backend runs.
    pub fn target(&self) -> Option<String> {
        let state = self.state.lock().expect("window tracker lock poisoned");
        state.running.then(|| state.target()).flatten()
    }

    /// The window that has the keyboard focus now, a Tyco one included, if
    /// it is an application window and a backend runs.
    pub fn active_window(&self) -> Option<ActiveWindow> {
        let state = self.state.lock().expect("window tracker lock poisoned");
        if !state.running || state.active_kind == WindowKind::Other {
            return None;
        }
        state.active.clone().map(|id| ActiveWindow {
            id,
            class: state.active_class.clone(),
        })
    }

    pub fn is_running(&self) -> bool {
        self.state
            .lock()
            .expect("window tracker lock poisoned")
            .running
    }

    /// Clears the window an activation found missing, before a new one.
    pub(crate) fn forget_missing(&self) {
        self.update(|state| state.missing = None);
    }

    /// Starts over for the backend run `session`, or for none when stopped.
    pub(crate) fn reset(&self, running: bool, session: String) {
        self.update(|state| {
            *state = TrackerState {
                running,
                session,
                ..TrackerState::default()
            }
        });
    }

    /// Waits until `done` returns a result, or fails with `timeout_message`.
    fn wait_for<T>(
        &self,
        timeout: Duration,
        timeout_message: &str,
        mut done: impl FnMut(&TrackerState) -> Option<Result<T, AppError>>,
    ) -> Result<T, AppError> {
        let deadline = Instant::now() + timeout;
        let mut state = self.state.lock().expect("window tracker lock poisoned");
        loop {
            if let Some(result) = done(&state) {
                return result;
            }
            let now = Instant::now();
            if now >= deadline {
                return Err(AppError::Message(timeout_message.to_owned()));
            }
            state = self
                .changed
                .wait_timeout(state, deadline - now)
                .expect("window tracker lock poisoned")
                .0;
        }
    }

    pub(crate) fn wait_until_active(&self, id: &str, timeout: Duration) -> Result<(), AppError> {
        self.wait_for(
            timeout,
            "Timed out waiting for the target window to receive focus",
            |state| {
                if state.active.as_deref() == Some(id) {
                    return Some(Ok(()));
                }
                (state.missing.as_deref() == Some(id)).then(|| {
                    Err(AppError::Message(String::from(
                        "The target window has been closed",
                    )))
                })
            },
        )
    }

    pub(crate) fn wait_until_reported(&self, timeout: Duration) -> Result<(), AppError> {
        self.wait_for(timeout, "The window tracker does not report", |state| {
            state.reported.then_some(Ok(()))
        })
    }
}

/// Whether the first attempt to start the tracker has finished, see
/// `wait_for_startup`.
struct Startup {
    done: Mutex<bool>,
    changed: Condvar,
}

fn startup() -> &'static Startup {
    static STARTUP: Startup = Startup {
        done: Mutex::new(false),
        changed: Condvar::new(),
    };
    &STARTUP
}

/// Reports that a backend started, or that none will start soon.
pub fn finish_startup() {
    *startup()
        .done
        .lock()
        .unwrap_or_else(|error| error.into_inner()) = true;
    startup().changed.notify_all();
}

/// Waits up to `timeout` for the first attempt to start a backend. An
/// activation needs the tracker to know the window it was called from.
pub fn wait_for_startup(timeout: Duration) {
    let done = startup()
        .done
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (_done, result) = startup()
        .changed
        .wait_timeout_while(done, timeout, |done| !*done)
        .unwrap_or_else(|error| error.into_inner());
    if result.timed_out() {
        log::debug!("Activating before the window tracker has started");
    }
}

/// A token no earlier backend run of this process has used.
pub(crate) fn new_session() -> String {
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let count = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|time| time.subsec_nanos())
        .unwrap_or_default();
    format!("{count}x{nanos}")
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::thread;

    use super::*;

    const WINDOW: &str = "{da63572a-f14f-4bda-bc6e-fad90679a426}";

    fn new_tracker() -> Arc<WindowTracker> {
        Arc::new(WindowTracker {
            state: Mutex::new(TrackerState::default()),
            changed: Condvar::new(),
        })
    }

    /// A tracker with a backend running as session `s`.
    fn running_tracker() -> Arc<WindowTracker> {
        let tracker = new_tracker();
        tracker.reset(true, String::from("s"));
        tracker
    }

    fn seq(number: u64) -> String {
        format!("s:{number}")
    }

    #[test]
    fn sessions_differ() {
        assert_ne!(new_session(), new_session());
    }

    #[test]
    fn remembers_the_last_foreign_window_only() {
        let mut state = TrackerState::default();
        state.window_activated("a", WindowKind::Foreign);
        state.window_activated("tyco", WindowKind::Own);
        state.window_activated("", WindowKind::Foreign);
        assert_eq!(state.last_foreign, None);
        assert_eq!(state.active, None);
        assert_eq!(state.active_kind, WindowKind::Other);
        state.window_activated("b", WindowKind::Foreign);
        assert_eq!(state.last_foreign.as_deref(), Some("b"));
        assert_eq!(state.active.as_deref(), Some("b"));
    }

    #[test]
    fn targets_the_focused_window_or_the_one_before_tyco() {
        let mut state = TrackerState::default();
        assert_eq!(state.target(), None);
        state.window_activated("a", WindowKind::Foreign);
        assert_eq!(state.target().as_deref(), Some("a"));
        state.window_activated("tyco", WindowKind::Own);
        assert_eq!(state.target().as_deref(), Some("a"));
        state.window_activated("desktop", WindowKind::Other);
        assert_eq!(state.target(), None);
        state.window_activated("tyco", WindowKind::Own);
        assert_eq!(state.target(), None);
    }

    #[test]
    fn reports_the_active_application_window() {
        let tracker = running_tracker();
        tracker.window_activated(&seq(1), "a", WindowKind::Foreign, "org.kde.konsole");
        assert_eq!(
            tracker.active_window(),
            Some(ActiveWindow {
                id: "a".into(),
                class: "org.kde.konsole".into()
            })
        );
        tracker.window_activated(&seq(2), "tyco", WindowKind::Own, "tyco");
        assert_eq!(tracker.active_window().unwrap().id, "tyco");
        tracker.window_activated(&seq(3), "desktop", WindowKind::Other, "plasmashell");
        assert_eq!(tracker.active_window(), None);
    }

    #[test]
    fn parses_window_kinds() {
        assert_eq!(WindowKind::parse("foreign"), WindowKind::Foreign);
        assert_eq!(WindowKind::parse("own"), WindowKind::Own);
        assert_eq!(WindowKind::parse("other"), WindowKind::Other);
        assert_eq!(WindowKind::parse("bogus"), WindowKind::Other);
    }

    #[test]
    fn forgets_a_closed_window() {
        let mut state = TrackerState::default();
        state.window_activated("a", WindowKind::Foreign);
        state.window_closed("other");
        assert_eq!(state.last_foreign.as_deref(), Some("a"));
        state.window_closed("a");
        assert_eq!(state.last_foreign, None);
        assert_eq!(state.active, None);
        assert_eq!(state.target(), None);
    }

    #[test]
    fn reports_windows_only_while_a_backend_runs() {
        let tracker = new_tracker();
        assert!(!tracker.window_activated(&seq(1), "a", WindowKind::Foreign, ""));
        assert_eq!(tracker.target(), None);
        tracker.reset(true, String::from("s"));
        assert!(tracker.is_running());
        assert!(tracker.window_activated(&seq(1), "a", WindowKind::Foreign, ""));
        assert_eq!(tracker.target().as_deref(), Some("a"));
        tracker.reset(false, String::new());
        assert_eq!(tracker.target(), None);
    }

    #[test]
    fn ignores_reports_that_arrive_out_of_order() {
        let tracker = running_tracker();
        assert!(tracker.window_activated(&seq(2), "b", WindowKind::Foreign, ""));
        // the null activation KWin sends before "b" must not clear it
        assert!(!tracker.window_activated(&seq(1), "", WindowKind::Other, ""));
        assert_eq!(tracker.target().as_deref(), Some("b"));
        assert!(!tracker.window_closed(&seq(2), "b"));
        assert_eq!(tracker.target().as_deref(), Some("b"));
        assert!(tracker.window_closed(&seq(3), "b"));
        assert_eq!(tracker.target(), None);
    }

    #[test]
    fn ignores_reports_of_an_earlier_backend_run() {
        let tracker = running_tracker();
        assert!(!tracker.window_activated("old:7", "a", WindowKind::Foreign, ""));
        assert!(!tracker.window_activated("7", "a", WindowKind::Foreign, ""));
        assert!(!tracker.window_activated("s:x", "a", WindowKind::Foreign, ""));
        assert_eq!(tracker.target(), None);
        // a late report of the old run must not block the new one
        assert!(tracker.window_activated(&seq(1), "a", WindowKind::Foreign, ""));
    }

    #[test]
    fn waits_for_the_first_report_of_the_backend() {
        let tracker = running_tracker();
        let error = tracker
            .wait_until_reported(Duration::from_millis(10))
            .unwrap_err();
        assert!(error.to_string().contains("does not report"));

        let reporter = Arc::clone(&tracker);
        let handle = thread::spawn(move || {
            thread::sleep(Duration::from_millis(20));
            reporter.window_activated(&seq(1), "", WindowKind::Other, "");
        });
        tracker.wait_until_reported(Duration::from_secs(2)).unwrap();
        handle.join().unwrap();
    }

    #[test]
    fn waits_for_the_activation_report() {
        let tracker = running_tracker();
        let reporter = Arc::clone(&tracker);
        let handle = thread::spawn(move || {
            thread::sleep(Duration::from_millis(20));
            reporter.window_activated(&seq(1), "other", WindowKind::Foreign, "");
            reporter.window_activated(&seq(2), WINDOW, WindowKind::Foreign, "");
        });
        tracker
            .wait_until_active(WINDOW, Duration::from_secs(2))
            .unwrap();
        handle.join().unwrap();
    }

    #[test]
    fn fails_fast_for_a_missing_window_and_times_out_otherwise() {
        let tracker = new_tracker();
        tracker.window_missing(WINDOW);
        let error = tracker
            .wait_until_active(WINDOW, Duration::from_secs(2))
            .unwrap_err();
        assert!(error.to_string().contains("closed"));

        let error = new_tracker()
            .wait_until_active(WINDOW, Duration::from_millis(10))
            .unwrap_err();
        assert!(error.to_string().contains("Timed out"));
    }
}
