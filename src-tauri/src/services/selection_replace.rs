//! Replaces the selection in the focused window with what an action makes of
//! it: a correction, a translation or an AI task. No Tyco window is shown, so
//! the focus and the selection stay where they are. The text is copied out
//! with the copy keys, transformed by the webview of the quick window, and
//! pasted back over the selection, which the paste replaces.

#[path = "selection_replace/hotkey-release.rs"]
mod hotkey_release;
pub use hotkey_release::{hotkey_released, HotkeyPress};

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

#[cfg(test)]
use super::platform::selection::is_terminal_class;
use super::platform::selection::{capture, paste_result, restore_clipboard};
use crate::errors::AppError;
use crate::state::AppState;

pub const SELECTION_RUN_EVENT: &str = "app://selection-run";
pub const SELECTION_CANCEL_EVENT: &str = "app://selection-cancel";

/// Prefix of the selection action that runs a command of the library.
pub const COMMAND_ACTION_PREFIX: &str = "command:";

/// Actions that replace the selection in the focused window with their
/// result: `correction`, and `command:<id>`, a command of the library that
/// returns a text.
pub fn is_selection_action(value: &str) -> bool {
    if value == "correction" {
        return true;
    }
    value
        .strip_prefix(COMMAND_ACTION_PREFIX)
        .is_some_and(|id| !id.trim().is_empty())
}

/// The portal reports the press of a hotkey; its keys are still down then.
const HOTKEY_RELEASE_TIMEOUT: Duration = Duration::from_millis(600);
/// A tray menu has to close and give the focus back first.
pub const TRAY_MENU_DELAY: Duration = Duration::from_millis(300);
/// A run the webview never finished, e.g. because it was reloaded, must not
/// turn every later hotkey press into a cancellation.
const ABANDONED_RUN_AGE: Duration = Duration::from_secs(180);

/// When a trigger may start capturing the selection.
pub enum TriggerWait {
    Now,
    Delay(Duration),
    /// Once the keys of this hotkey press are released.
    HotkeyRelease(HotkeyPress),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RunErrorCode {
    /// No application window has the focus.
    NoTarget,
    /// Nothing is selected, or the selection is not text.
    NoSelection,
    /// The keys could not be pressed or the clipboard could not be used.
    Capture,
    #[cfg_attr(any(target_os = "linux", target_os = "windows"), allow(dead_code))]
    Unsupported,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunError {
    code: RunErrorCode,
    message: String,
}

impl RunError {
    pub(crate) fn new(code: RunErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

/// Sent to the webview: the text to transform, or why there is none.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunEvent {
    run_id: u64,
    action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<RunError>,
    /// The quick window does not receive config changes made elsewhere.
    user_config: Value,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FinishStatus {
    /// The result replaced the selection.
    Pasted,
    /// The focus moved to another window meanwhile; the result waits in the
    /// clipboard instead of going into the wrong place.
    Clipboard,
    /// No result to insert; the clipboard got its old content back.
    Restored,
    /// The run was cancelled or replaced meanwhile.
    Stale,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Target {
    pub id: String,
    pub terminal: bool,
}

pub(crate) struct Run {
    pub id: u64,
    pub external: bool,
    pub captured_text: Option<String>,
    pub target: Target,
    pub started: Instant,
    #[cfg(target_os = "linux")]
    pub snapshot: Option<super::platform::linux::clipboard_restore::ClipboardSnapshot>,
    #[cfg(target_os = "windows")]
    pub snapshot: Option<super::platform::windows_clipboard::Snapshot>,
}

/// The run a trigger found, see `SelectionRuns::take_active_at`.
enum Taken {
    Nothing,
    Active(Run),
    Abandoned(Run),
}

#[derive(Default)]
pub struct SelectionRuns {
    next_id: AtomicU64,
    capturing: Arc<AtomicBool>,
    current: Mutex<Option<Run>>,
}

impl SelectionRuns {
    fn lock(&self) -> std::sync::MutexGuard<'_, Option<Run>> {
        self.current.lock().expect("selection run lock poisoned")
    }

    /// Takes the run in progress, telling one the webview abandoned.
    fn take_active_at(&self, now: Instant) -> Taken {
        let Some(run) = self.lock().take() else {
            return Taken::Nothing;
        };
        if now.saturating_duration_since(run.started) < ABANDONED_RUN_AGE {
            Taken::Active(run)
        } else {
            log::warn!(
                "Dropping selection run {} the webview never finished",
                run.id
            );
            Taken::Abandoned(run)
        }
    }

    fn take_if(&self, id: u64) -> Option<Run> {
        let mut current = self.lock();
        if current.as_ref().is_some_and(|run| run.id == id) {
            current.take()
        } else {
            None
        }
    }
}

/// System effects of a selection run. The coordinator never needs a webview
/// or a real clipboard when these operations are substituted.
trait SelectionBackend {
    fn user_config(&self) -> Value;
    fn wait(&self, wait: TriggerWait);
    fn capture(&self, config: &Value) -> Result<(String, Run), RunError>;
    fn restore(&self, run: Run);
    fn paste(&self, config: &Value, run: Run, text: String) -> Result<FinishStatus, AppError>;
    fn publish(&self, event: RunEvent) -> Result<(), AppError>;
    fn cancelled(&self, id: u64) -> Result<(), AppError>;
}

struct SystemSelectionBackend<'a>(&'a AppHandle);

impl SelectionBackend for SystemSelectionBackend<'_> {
    fn user_config(&self) -> Value {
        self.0.state::<AppState>().params().user_config
    }
    fn wait(&self, wait: TriggerWait) {
        match wait {
            TriggerWait::Now => {}
            TriggerWait::Delay(delay) => thread::sleep(delay),
            TriggerWait::HotkeyRelease(press) => {
                press.wait(HOTKEY_RELEASE_TIMEOUT);
            }
        }
    }
    fn capture(&self, config: &Value) -> Result<(String, Run), RunError> {
        capture(config)
    }
    fn restore(&self, run: Run) {
        restore_clipboard(run);
    }
    fn paste(&self, config: &Value, run: Run, text: String) -> Result<FinishStatus, AppError> {
        paste_result(config, run, text)
    }
    fn publish(&self, event: RunEvent) -> Result<(), AppError> {
        emit_to_webview(self.0, SELECTION_RUN_EVENT, event)
    }
    fn cancelled(&self, id: u64) -> Result<(), AppError> {
        emit_to_webview(
            self.0,
            SELECTION_CANCEL_EVENT,
            serde_json::json!({ "runId": id }),
        )
    }
}

struct CapturingGuard(Arc<AtomicBool>);

impl Drop for CapturingGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

enum TriggerDecision {
    Busy,
    Cancel(Run, CapturingGuard),
    /// With a run the webview abandoned, whose clipboard goes back first.
    Capture(CapturingGuard, Option<Run>),
}

impl SelectionRuns {
    fn reserve(&self) -> Option<CapturingGuard> {
        (!self.capturing.swap(true, Ordering::SeqCst))
            .then(|| CapturingGuard(Arc::clone(&self.capturing)))
    }

    fn begin_trigger(&self, action: &str, now: Instant) -> Result<TriggerDecision, AppError> {
        if !is_selection_action(action) {
            return Err(AppError::Message(format!(
                "Unknown selection action: {action}"
            )));
        }
        // Reserve before inspecting runs: an external capture must not be cancelled.
        let Some(guard) = self.reserve() else {
            return Ok(TriggerDecision::Busy);
        };
        if self.lock().as_ref().is_some_and(|run| run.external) {
            return Err(AppError::Message(
                "An external selection job is running".into(),
            ));
        }
        match self.take_active_at(now) {
            Taken::Active(run) => Ok(TriggerDecision::Cancel(run, guard)),
            Taken::Nothing => Ok(TriggerDecision::Capture(guard, None)),
            Taken::Abandoned(run) => Ok(TriggerDecision::Capture(guard, Some(run))),
        }
    }

    fn capture_and_publish(
        &self,
        backend: &impl SelectionBackend,
        action: String,
        wait: TriggerWait,
        guard: CapturingGuard,
        abandoned: Option<Run>,
    ) {
        // the clipboard of the abandoned run would otherwise keep its
        // selection, and the new snapshot would take that for the user's
        if let Some(run) = abandoned {
            backend.restore(run);
        }
        backend.wait(wait);
        let run_id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        let user_config = backend.user_config();
        let event = match backend.capture(&user_config) {
            Ok((text, run)) => {
                self.lock().replace(Run {
                    id: run_id,
                    captured_text: Some(text.clone()),
                    ..run
                });
                RunEvent {
                    run_id,
                    action,
                    text: Some(text),
                    error: None,
                    user_config,
                }
            }
            Err(error) => {
                log::warn!("Could not capture the selection: {}", error.message);
                RunEvent {
                    run_id,
                    action,
                    text: None,
                    error: Some(error),
                    user_config,
                }
            }
        };
        drop(guard);
        if let Err(error) = backend.publish(event) {
            log::error!("Could not hand the selection over to the webview: {error}");
            if let Some(run) = self.take_if(run_id) {
                backend.restore(run);
            }
        }
    }

    fn prepare_external_with(
        &self,
        backend: &impl SelectionBackend,
    ) -> Result<(u64, String), AppError> {
        let _guard = self
            .reserve()
            .ok_or_else(|| AppError::Message("A selection is being captured".into()))?;
        if self.lock().is_some() {
            return Err(AppError::Message(
                "A selection run is already active".into(),
            ));
        }
        let (text, mut run) = backend
            .capture(&backend.user_config())
            .map_err(|error| AppError::Message(error.message))?;
        let id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        run.id = id;
        run.external = true;
        run.captured_text = Some(text.clone());
        self.lock().replace(run);
        Ok((id, text))
    }

    fn finish_with(
        &self,
        backend: &impl SelectionBackend,
        run_id: u64,
        text: Option<String>,
    ) -> Result<FinishStatus, AppError> {
        let Some(run) = self.take_if(run_id) else {
            return Ok(FinishStatus::Stale);
        };
        match text {
            None => {
                backend.restore(run);
                Ok(FinishStatus::Restored)
            }
            Some(text) => backend.paste(&backend.user_config(), run, text),
        }
    }
}

fn cancel_with(backend: &impl SelectionBackend, run: Run) {
    let id = run.id;
    backend.restore(run);
    if let Err(error) = backend.cancelled(id) {
        log::warn!("Could not report the cancelled selection run: {error}");
    }
}

/// Starts an action, or cancels the current hotkey run on a second trigger.
pub fn trigger(app: &AppHandle, action: &str, wait: TriggerWait) -> Result<(), AppError> {
    let decision = app
        .state::<SelectionRuns>()
        .begin_trigger(action, Instant::now())?;
    match decision {
        TriggerDecision::Busy => {
            log::debug!("Ignoring the {action} trigger: a selection is being captured")
        }
        TriggerDecision::Cancel(run, _guard) => cancel_with(&SystemSelectionBackend(app), run),
        TriggerDecision::Capture(guard, abandoned) => {
            let app = app.clone();
            let action = action.to_owned();
            thread::spawn(move || {
                app.state::<SelectionRuns>().capture_and_publish(
                    &SystemSelectionBackend(&app),
                    action,
                    wait,
                    guard,
                    abandoned,
                );
            });
        }
    }
    Ok(())
}

pub fn prepare_external(app: &AppHandle) -> Result<(u64, String), AppError> {
    app.state::<SelectionRuns>()
        .prepare_external_with(&SystemSelectionBackend(app))
}

pub fn finish(
    app: &AppHandle,
    run_id: u64,
    text: Option<String>,
) -> Result<FinishStatus, AppError> {
    app.state::<SelectionRuns>()
        .finish_with(&SystemSelectionBackend(app), run_id, text)
}

fn emit_to_webview(
    app: &AppHandle,
    event: &str,
    payload: impl Serialize + Clone,
) -> Result<(), AppError> {
    let window = app
        .get_webview_window(super::runtime::QUICK_WINDOW_LABEL)
        .ok_or_else(|| AppError::Message(String::from("Quick window not found")))?;
    window
        .emit(event, payload)
        .map_err(|error| AppError::Message(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_selection_actions() {
        for valid in ["correction", "command:default:core.correct:fix"] {
            assert!(is_selection_action(valid), "{valid}");
        }
        for invalid in [
            "",
            // slots of translation languages and AI tasks are not actions
            "translate.0",
            "aiTask.12",
            "other.1",
            "command:",
            "command: ",
        ] {
            assert!(!is_selection_action(invalid), "{invalid}");
        }
    }

    fn run_at(id: u64, started: Instant) -> Run {
        Run {
            id,
            external: false,
            captured_text: None,
            target: Target {
                id: String::from("window"),
                terminal: false,
            },
            started,
            #[cfg(any(target_os = "linux", target_os = "windows"))]
            snapshot: None,
        }
    }

    #[test]
    fn recognizes_terminals_by_application_id() {
        for class in [
            "org.kde.konsole",
            "Alacritty",
            "kitty",
            "org.gnome.Ptyxis",
            "xfce4-terminal",
        ] {
            assert!(is_terminal_class(class), "{class}");
        }
        for class in ["firefox", "org.kde.kate", "telegramdesktop", ""] {
            assert!(!is_terminal_class(class), "{class}");
        }
    }

    #[test]
    fn finishes_only_the_current_run() {
        let runs = SelectionRuns::default();
        runs.lock().replace(run_at(2, Instant::now()));
        assert!(runs.take_if(1).is_none());
        assert_eq!(runs.take_if(2).map(|run| run.id), Some(2));
        assert!(runs.take_if(2).is_none());
    }

    #[test]
    fn an_abandoned_run_is_not_cancelled_but_dropped() {
        let runs = SelectionRuns::default();
        let now = Instant::now();
        runs.lock().replace(run_at(1, now));
        assert!(matches!(
            runs.take_active_at(now + ABANDONED_RUN_AGE - Duration::from_nanos(1)),
            Taken::Active(Run { id: 1, .. })
        ));
        runs.lock().replace(run_at(2, now));
        assert!(matches!(
            runs.take_active_at(now + ABANDONED_RUN_AGE),
            Taken::Abandoned(Run { id: 2, .. })
        ));
        assert!(runs.lock().is_none());
    }

    #[test]
    fn an_abandoned_run_gets_its_clipboard_back_before_the_next_capture() {
        let runs = SelectionRuns::default();
        let backend = Backend::default();
        let guard = runs.reserve().unwrap();
        runs.capture_and_publish(
            &backend,
            "correction".into(),
            TriggerWait::Now,
            guard,
            Some(run_at(9, Instant::now())),
        );
        assert_eq!(
            backend.operations.lock().unwrap()[..3],
            ["restore:9", "wait", "capture"]
        );
    }

    #[derive(Default)]
    struct Backend {
        operations: Mutex<Vec<String>>,
        events: Mutex<Vec<RunEvent>>,
        capture_error: bool,
        publish_error: bool,
        paste_error: bool,
    }

    impl SelectionBackend for Backend {
        fn user_config(&self) -> Value {
            serde_json::json!({"setting": true})
        }
        fn wait(&self, _wait: TriggerWait) {
            self.operations.lock().unwrap().push("wait".into());
        }
        fn capture(&self, config: &Value) -> Result<(String, Run), RunError> {
            assert_eq!(config, &self.user_config());
            self.operations.lock().unwrap().push("capture".into());
            if self.capture_error {
                Err(RunError::new(RunErrorCode::NoSelection, "no selection"))
            } else {
                Ok(("selected".into(), run_at(0, Instant::now())))
            }
        }
        fn restore(&self, run: Run) {
            self.operations
                .lock()
                .unwrap()
                .push(format!("restore:{}", run.id));
        }
        fn paste(&self, _config: &Value, run: Run, text: String) -> Result<FinishStatus, AppError> {
            self.operations
                .lock()
                .unwrap()
                .push(format!("paste:{}:{text}", run.id));
            if self.paste_error {
                Err(AppError::Message("paste failed".into()))
            } else {
                Ok(FinishStatus::Pasted)
            }
        }
        fn publish(&self, event: RunEvent) -> Result<(), AppError> {
            self.operations.lock().unwrap().push("publish".into());
            self.events.lock().unwrap().push(event);
            if self.publish_error {
                Err(AppError::Message("webview gone".into()))
            } else {
                Ok(())
            }
        }
        fn cancelled(&self, id: u64) -> Result<(), AppError> {
            self.operations.lock().unwrap().push(format!("cancel:{id}"));
            Ok(())
        }
    }

    fn start(runs: &SelectionRuns, backend: &Backend) -> u64 {
        let TriggerDecision::Capture(guard, None) =
            runs.begin_trigger("correction", Instant::now()).unwrap()
        else {
            panic!("capture expected");
        };
        runs.capture_and_publish(backend, "correction".into(), TriggerWait::Now, guard, None);
        backend.events.lock().unwrap().last().unwrap().run_id
    }

    #[test]
    fn capture_publish_finish_and_stale_results_have_no_system_dependencies() {
        let runs = SelectionRuns::default();
        let backend = Backend::default();
        let id = start(&runs, &backend);
        assert_eq!(
            backend.events.lock().unwrap()[0].text.as_deref(),
            Some("selected")
        );
        assert_eq!(
            runs.finish_with(&backend, id + 1, Some("wrong".into()))
                .unwrap(),
            FinishStatus::Stale
        );
        assert_eq!(
            runs.finish_with(&backend, id, Some("result".into()))
                .unwrap(),
            FinishStatus::Pasted
        );
        assert_eq!(
            runs.finish_with(&backend, id, None).unwrap(),
            FinishStatus::Stale
        );
        assert_eq!(
            *backend.operations.lock().unwrap(),
            ["wait", "capture", "publish", "paste:1:result"]
        );
    }

    #[test]
    fn failed_publication_restores_only_its_capture_and_releases_the_reservation() {
        let runs = SelectionRuns::default();
        let backend = Backend {
            publish_error: true,
            ..Backend::default()
        };
        start(&runs, &backend);
        assert!(runs.lock().is_none());
        assert_eq!(
            *backend.operations.lock().unwrap(),
            ["wait", "capture", "publish", "restore:1"]
        );
        assert!(matches!(
            runs.begin_trigger("correction", Instant::now()).unwrap(),
            TriggerDecision::Capture(..)
        ));
    }

    #[test]
    fn capture_failure_is_published_without_creating_a_run() {
        let runs = SelectionRuns::default();
        let backend = Backend {
            capture_error: true,
            ..Backend::default()
        };
        start(&runs, &backend);
        assert!(runs.lock().is_none());
        let events = backend.events.lock().unwrap();
        assert_eq!(
            events[0].error.as_ref().unwrap().code,
            RunErrorCode::NoSelection
        );
        assert!(events[0].text.is_none());
        assert!(!runs.capturing.load(Ordering::SeqCst));
    }

    #[test]
    fn a_second_trigger_cancels_and_keeps_capture_reserved_until_restoration_finishes() {
        let runs = SelectionRuns::default();
        let backend = Backend::default();
        start(&runs, &backend);
        let TriggerDecision::Cancel(run, guard) =
            runs.begin_trigger("correction", Instant::now()).unwrap()
        else {
            panic!("cancel expected");
        };
        assert!(matches!(
            runs.begin_trigger("correction", Instant::now()).unwrap(),
            TriggerDecision::Busy
        ));
        assert!(runs.prepare_external_with(&backend).is_err());
        cancel_with(&backend, run);
        drop(guard);
        assert_eq!(
            &backend.operations.lock().unwrap()[3..],
            ["restore:1", "cancel:1"]
        );
        assert!(runs.prepare_external_with(&backend).is_ok());
    }

    #[test]
    fn external_capture_is_never_cancelled_and_empty_results_restore_the_clipboard() {
        let runs = SelectionRuns::default();
        let backend = Backend::default();
        let (id, text) = runs.prepare_external_with(&backend).unwrap();
        assert_eq!(text, "selected");
        assert!(runs.begin_trigger("correction", Instant::now()).is_err());
        assert!(!runs.capturing.load(Ordering::SeqCst));
        assert_eq!(
            runs.finish_with(&backend, id, None).unwrap(),
            FinishStatus::Restored
        );
        assert!(runs.lock().is_none());
    }

    #[test]
    fn paste_failure_consumes_the_run_and_is_returned_to_the_caller() {
        let runs = SelectionRuns::default();
        let backend = Backend {
            paste_error: true,
            ..Backend::default()
        };
        let id = start(&runs, &backend);
        assert!(runs
            .finish_with(&backend, id, Some("result".into()))
            .is_err());
        assert!(runs.lock().is_none());
    }

    #[test]
    fn unwinding_releases_capture_and_invalid_actions_do_not_reserve_it() {
        let runs = SelectionRuns::default();
        assert!(runs.begin_trigger("invalid", Instant::now()).is_err());
        let result = std::panic::catch_unwind(|| {
            let _guard = runs.reserve().unwrap();
            panic!("capture panic");
        });
        assert!(result.is_err());
        assert!(runs.reserve().is_some());
    }
}
