//! Foreign windows on KDE Plasma under Wayland. No Wayland protocol lets a
//! regular client learn or activate another client's window, but KWin scripts
//! can do both: a long-lived tracker script reports every window activation
//! back to Tyco over D-Bus, and a one-shot script activates a window by its id.

use std::path::PathBuf;
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::errors::AppError;

const KWIN_SERVICE: &str = "org.kde.KWin";
const SCRIPTING_PATH: &str = "/Scripting";
const SCRIPTING_INTERFACE: &str = "org.kde.kwin.Scripting";
const SCRIPT_INTERFACE: &str = "org.kde.kwin.Script";
const TRACKER_SCRIPT_NAME: &str = "tyco-window-tracker";
const ACTIVATOR_SCRIPT_NAME: &str = "tyco-window-activator";
const ACTIVATION_TIMEOUT: Duration = Duration::from_secs(2);
/// The tracker reports the active window right away; silence means the
/// script failed, e.g. on Plasma 5 whose scripting API differs.
const TRACKER_START_TIMEOUT: Duration = Duration::from_secs(2);

const TRACKER_SCRIPT: &str = r#"
const TYCO_PID = __PID__;
function tycoSend(method, a, b, c) {
    if (b === undefined) {
        callDBus("org.tyco.Service", "/org/tyco/Object", "org.tyco.Interface", method, a);
    } else if (c === undefined) {
        callDBus("org.tyco.Service", "/org/tyco/Object", "org.tyco.Interface", method, a, b);
    } else {
        callDBus("org.tyco.Service", "/org/tyco/Object", "org.tyco.Interface", method, a, b, c);
    }
}
function tycoKind(window) {
    if (window.pid === TYCO_PID) {
        return "own";
    }
    return window.normalWindow || window.dialog ? "foreign" : "other";
}
function tycoReport(window) {
    if (window) {
        tycoSend("KwinWindowActivated", window.internalId.toString(), tycoKind(window),
            String(window.resourceClass || ""));
    } else {
        tycoSend("KwinWindowActivated", "", "other", "");
    }
}
workspace.windowActivated.connect(tycoReport);
workspace.windowRemoved.connect(function (window) {
    tycoSend("KwinWindowClosed", window.internalId.toString());
});
tycoReport(workspace.activeWindow);
"#;

const ACTIVATOR_SCRIPT: &str = r#"
(function () {
    const target = "__ID__";
    const windows = workspace.windowList();
    for (let i = 0; i < windows.length; i++) {
        if (windows[i].internalId.toString() === target) {
            workspace.activeWindow = windows[i];
            return;
        }
    }
    callDBus("org.tyco.Service", "/org/tyco/Object", "org.tyco.Interface", "KwinWindowMissing", target);
})();
"#;

/// What the tracker script tells about an activated window.
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
    /// Set by the first report of the script.
    reported: bool,
    active: Option<String>,
    active_kind: WindowKind,
    /// The resource class (application id) of the active window.
    active_class: String,
    last_foreign: Option<String>,
    missing: Option<String>,
}

impl TrackerState {
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
    fn update(&self, update: impl FnOnce(&mut TrackerState)) {
        update(&mut self.state.lock().expect("kwin tracker lock poisoned"));
        self.changed.notify_all();
    }

    pub fn window_activated(&self, id: &str, kind: WindowKind, class: &str) {
        self.update(|state| {
            state.window_activated(id, kind);
            class.clone_into(&mut state.active_class);
        });
    }

    pub fn window_closed(&self, id: &str) {
        self.update(|state| state.window_closed(id));
    }

    pub fn window_missing(&self, id: &str) {
        self.update(|state| {
            state.window_closed(id);
            state.missing = Some(id.to_owned());
        });
    }

    /// The window to insert text into, see `TrackerState::target`, if the
    /// tracker script runs.
    pub fn target(&self) -> Option<String> {
        let state = self.state.lock().expect("kwin tracker lock poisoned");
        state.running.then(|| state.target()).flatten()
    }

    /// The window that has the keyboard focus now, a Tyco one included, if
    /// it is an application window and the tracker script runs.
    pub fn active_window(&self) -> Option<ActiveWindow> {
        let state = self.state.lock().expect("kwin tracker lock poisoned");
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
            .expect("kwin tracker lock poisoned")
            .running
    }

    fn set_running(&self, running: bool) {
        self.update(|state| {
            *state = TrackerState {
                running,
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
        let mut state = self.state.lock().expect("kwin tracker lock poisoned");
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
                .expect("kwin tracker lock poisoned")
                .0;
        }
    }

    fn wait_until_active(&self, id: &str, timeout: Duration) -> Result<(), AppError> {
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

    fn wait_until_reported(&self, timeout: Duration) -> Result<(), AppError> {
        self.wait_for(
            timeout,
            "The KWin window tracker script does not report; KDE Plasma 6 is required",
            |state| state.reported.then_some(Ok(())),
        )
    }
}

pub fn is_kde_wayland_session() -> bool {
    let is_wayland = std::env::var("XDG_SESSION_TYPE")
        .map(|value| value.eq_ignore_ascii_case("wayland"))
        .unwrap_or(false)
        || std::env::var_os("WAYLAND_DISPLAY").is_some();
    let is_kde = std::env::var("XDG_CURRENT_DESKTOP")
        .map(|value| {
            value
                .split(':')
                .any(|desktop| desktop.eq_ignore_ascii_case("kde"))
        })
        .unwrap_or(false);
    is_wayland && is_kde
}

/// Loads the tracker script and waits for its first report. Must run once
/// Tyco owns its D-Bus name, otherwise the reports of the script get lost.
pub fn start_tracker() -> Result<(), AppError> {
    let source = TRACKER_SCRIPT.replace("__PID__", &std::process::id().to_string());
    // before the script runs: resetting the state later could drop its report
    tracker().set_running(true);
    let started = run_script(TRACKER_SCRIPT_NAME, &source)
        .and_then(|()| tracker().wait_until_reported(TRACKER_START_TIMEOUT));
    if started.is_err() {
        stop_tracker();
    }
    started
}

pub fn stop_tracker() {
    if !tracker().state.lock().is_ok_and(|state| state.running) {
        return;
    }
    tracker().set_running(false);
    if let Err(error) =
        session().and_then(|connection| unload_script(&connection, TRACKER_SCRIPT_NAME))
    {
        log::warn!("Could not unload the KWin window tracker: {error}");
    }
}

/// Activates the window and waits until KWin reports it focused.
pub fn activate_window(id: &str) -> Result<(), AppError> {
    if !is_window_id(id) {
        return Err(AppError::Message(format!("Invalid KWin window id: {id}")));
    }
    tracker().update(|state| state.missing = None);
    run_script(
        ACTIVATOR_SCRIPT_NAME,
        &ACTIVATOR_SCRIPT.replace("__ID__", id),
    )?;
    let result = tracker().wait_until_active(id, ACTIVATION_TIMEOUT);
    if let Err(error) =
        session().and_then(|connection| unload_script(&connection, ACTIVATOR_SCRIPT_NAME))
    {
        log::warn!("Could not unload the KWin window activator: {error}");
    }
    result
}

/// KWin window ids are UUIDs in braces; anything else must not reach a script.
fn is_window_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|char| char.is_ascii_hexdigit() || matches!(char, '{' | '}' | '-'))
}

fn session() -> Result<zbus::blocking::Connection, AppError> {
    zbus::blocking::Connection::session().map_err(dbus_error)
}

fn dbus_error(error: zbus::Error) -> AppError {
    AppError::Message(format!("KWin D-Bus call failed: {error}"))
}

fn scripts_dir() -> PathBuf {
    std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("tyco")
}

fn unload_script(connection: &zbus::blocking::Connection, name: &str) -> Result<(), AppError> {
    connection
        .call_method(
            Some(KWIN_SERVICE),
            SCRIPTING_PATH,
            Some(SCRIPTING_INTERFACE),
            "unloadScript",
            &(name,),
        )
        .map_err(dbus_error)?;
    Ok(())
}

/// KWin reads the file asynchronously after `run`, so it is left in place.
fn run_script(name: &str, source: &str) -> Result<(), AppError> {
    let directory = scripts_dir();
    std::fs::create_dir_all(&directory)?;
    let path = directory.join(format!("{name}.js"));
    std::fs::write(&path, source)?;
    let path = path
        .to_str()
        .ok_or_else(|| AppError::Message(String::from("Script path is not valid UTF-8")))?;

    let connection = session()?;
    // a script of a previous run or a crashed instance keeps its name taken
    unload_script(&connection, name)?;
    let id: i32 = connection
        .call_method(
            Some(KWIN_SERVICE),
            SCRIPTING_PATH,
            Some(SCRIPTING_INTERFACE),
            "loadScript",
            &(path, name),
        )
        .map_err(dbus_error)?
        .body()
        .deserialize()
        .map_err(dbus_error)?;
    if id < 0 {
        return Err(AppError::Message(format!(
            "KWin refused to load the script {name}"
        )));
    }
    connection
        .call_method(
            Some(KWIN_SERVICE),
            format!("{SCRIPTING_PATH}/Script{id}").as_str(),
            Some(SCRIPT_INTERFACE),
            "run",
            &(),
        )
        .map_err(dbus_error)?;
    Ok(())
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

    #[test]
    fn remembers_the_last_foreign_window_only() {
        let mut state = TrackerState::default();
        state.window_activated("a", WindowKind::Foreign);
        state.window_activated("tyco", WindowKind::Own);
        state.window_activated("", WindowKind::Foreign);
        assert_eq!(state.last_foreign.as_deref(), Some("a"));
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
        assert_eq!(state.target().as_deref(), Some("a"));
    }

    #[test]
    fn reports_the_active_application_window() {
        let tracker = new_tracker();
        tracker.set_running(true);
        tracker.window_activated("a", WindowKind::Foreign, "org.kde.konsole");
        assert_eq!(
            tracker.active_window(),
            Some(ActiveWindow {
                id: "a".into(),
                class: "org.kde.konsole".into()
            })
        );
        tracker.window_activated("tyco", WindowKind::Own, "tyco");
        assert_eq!(tracker.active_window().unwrap().id, "tyco");
        tracker.window_activated("desktop", WindowKind::Other, "plasmashell");
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
    fn reports_windows_only_while_the_script_runs() {
        let tracker = new_tracker();
        tracker.window_activated("a", WindowKind::Foreign, "");
        assert_eq!(tracker.target(), None);
        tracker.set_running(true);
        assert!(tracker.is_running());
        tracker.window_activated("a", WindowKind::Foreign, "");
        assert_eq!(tracker.target().as_deref(), Some("a"));
        tracker.set_running(false);
        assert_eq!(tracker.target(), None);
    }

    #[test]
    fn waits_for_the_first_report_of_the_script() {
        let tracker = new_tracker();
        tracker.set_running(true);
        let error = tracker
            .wait_until_reported(Duration::from_millis(10))
            .unwrap_err();
        assert!(error.to_string().contains("Plasma 6"));

        let reporter = Arc::clone(&tracker);
        let handle = thread::spawn(move || {
            thread::sleep(Duration::from_millis(20));
            reporter.window_activated("", WindowKind::Other, "");
        });
        tracker.wait_until_reported(Duration::from_secs(2)).unwrap();
        handle.join().unwrap();
    }

    #[test]
    fn waits_for_the_activation_report() {
        let tracker = new_tracker();
        let reporter = Arc::clone(&tracker);
        let handle = thread::spawn(move || {
            thread::sleep(Duration::from_millis(20));
            reporter.window_activated("other", WindowKind::Foreign, "");
            reporter.window_activated(WINDOW, WindowKind::Foreign, "");
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

    #[test]
    fn accepts_only_kwin_window_ids() {
        assert!(is_window_id(WINDOW));
        assert!(!is_window_id(""));
        assert!(!is_window_id("\"); workspace.activeWindow = null; (\""));
        assert!(!is_window_id("12345 abc"));
    }

    #[test]
    fn scripts_have_their_placeholders_filled() {
        assert!(!TRACKER_SCRIPT.replace("__PID__", "1").contains("__"));
        assert!(!ACTIVATOR_SCRIPT
            .replace("__ID__", WINDOW)
            .contains("__ID__"));
    }
}
