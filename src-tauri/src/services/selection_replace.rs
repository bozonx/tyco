//! Replaces the selection in the focused window with what an action makes of
//! it: a correction, a translation or an AI task. No Tyco window is shown, so
//! the focus and the selection stay where they are. The text is copied out
//! with the copy keys, transformed by the webview of the quick window, and
//! pasted back over the selection, which the paste replaces.

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

/// The built-in selection action: the LLM correction of the text.
pub const CORRECTION_ACTION: &str = "correction";

/// Prefix of the selection action that runs a command of the library.
pub const COMMAND_ACTION_PREFIX: &str = "command:";

/// Actions that replace the selection in the focused window with their
/// result: `correction`, and `command:<id>`, a command of the library that
/// returns a text.
pub fn is_selection_action(value: &str) -> bool {
    if value == CORRECTION_ACTION {
        return true;
    }
    value
        .strip_prefix(COMMAND_ACTION_PREFIX)
        .is_some_and(|id| !id.trim().is_empty())
}

/// The portal reports the press of a hotkey; its keys are still down then.
const HOTKEY_RELEASE_TIMEOUT: Duration = Duration::from_millis(600);
/// How long a call made from a desktop shortcut waits before the capture:
/// the keys of that shortcut are still down, and nothing reports their release.
pub const SHORTCUT_RELEASE_DELAY: Duration = HOTKEY_RELEASE_TIMEOUT;
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
pub enum SelectionRunErrorCode {
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
pub struct SelectionRunError {
    code: SelectionRunErrorCode,
    message: String,
}

impl SelectionRunError {
    pub(crate) fn new(code: SelectionRunErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

/// Sent to the webview: the text to transform, or why there is none.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SelectionRunEvent {
    run_id: u64,
    action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<SelectionRunError>,
    /// The quick window does not receive config changes made elsewhere.
    user_config: Value,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SelectionFinishStatus {
    /// The result replaced the selection.
    Pasted,
    /// The focus moved to another window meanwhile; the result waits in the
    /// clipboard instead of going into the wrong place.
    #[serde(rename = "clipboard")]
    CopiedToClipboard,
    /// No result to insert; the clipboard got its old content back.
    Restored,
    /// The run was cancelled or replaced meanwhile.
    Stale,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SelectionTarget {
    pub id: String,
    pub is_terminal: bool,
}

pub(crate) struct SelectionRun {
    pub id: u64,
    pub is_external: bool,
    pub captured_text: Option<String>,
    pub target: SelectionTarget,
    pub started_at: Instant,
    #[cfg(target_os = "linux")]
    pub clipboard_snapshot: Option<super::platform::linux::clipboard_restore::ClipboardSnapshot>,
    #[cfg(target_os = "windows")]
    pub clipboard_snapshot: Option<super::platform::windows_clipboard::ClipboardSnapshot>,
}

/// The run a trigger found, see `SelectionRunCoordinator::take_active_at`.
enum SelectionRunTakeOutcome {
    Empty,
    Active(SelectionRun),
    Abandoned(SelectionRun),
}

#[derive(Default)]
pub struct SelectionRunCoordinator {
    next_id: AtomicU64,
    capturing: Arc<AtomicBool>,
    current: Mutex<Option<SelectionRun>>,
}

impl SelectionRunCoordinator {
    fn lock(&self) -> std::sync::MutexGuard<'_, Option<SelectionRun>> {
        self.current.lock().expect("selection run lock poisoned")
    }

    /// Takes the run in progress, telling one the webview abandoned.
    fn take_active_at(&self, now: Instant) -> SelectionRunTakeOutcome {
        let Some(run) = self.lock().take() else {
            return SelectionRunTakeOutcome::Empty;
        };
        if now.saturating_duration_since(run.started_at) < ABANDONED_RUN_AGE {
            SelectionRunTakeOutcome::Active(run)
        } else {
            log::warn!(
                "Dropping selection run {} the webview never finished",
                run.id
            );
            SelectionRunTakeOutcome::Abandoned(run)
        }
    }

    fn take_if(&self, id: u64) -> Option<SelectionRun> {
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
    fn can_run(&self) -> bool {
        true
    }
    fn user_config(&self) -> Value;
    fn wait(&self, wait: TriggerWait);
    fn capture(&self, config: &Value) -> Result<(String, SelectionRun), SelectionRunError>;
    fn restore(&self, run: SelectionRun);
    fn paste(
        &self,
        config: &Value,
        run: SelectionRun,
        text: String,
    ) -> Result<SelectionFinishStatus, AppError>;
    fn publish(&self, event: SelectionRunEvent) -> Result<(), AppError>;
    fn cancelled(&self, id: u64) -> Result<(), AppError>;
}

struct SystemSelectionBackend<'a>(&'a AppHandle);

impl SelectionBackend for SystemSelectionBackend<'_> {
    fn can_run(&self) -> bool {
        !self.0.state::<AppState>().is_quitting()
    }
    fn user_config(&self) -> Value {
        self.0.state::<AppState>().snapshot().settings.user_config
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
    fn capture(&self, config: &Value) -> Result<(String, SelectionRun), SelectionRunError> {
        capture(config)
    }
    fn restore(&self, run: SelectionRun) {
        restore_clipboard(run);
    }
    fn paste(
        &self,
        config: &Value,
        run: SelectionRun,
        text: String,
    ) -> Result<SelectionFinishStatus, AppError> {
        paste_result(config, run, text)
    }
    fn publish(&self, event: SelectionRunEvent) -> Result<(), AppError> {
        if !self.can_run() {
            return Err(AppError::ServiceUnavailable(
                "Selection service is stopping".into(),
            ));
        }
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
    Cancel(SelectionRun, CapturingGuard),
    /// With a run the webview abandoned, whose clipboard goes back first.
    Capture(CapturingGuard, Option<SelectionRun>),
}

impl SelectionRunCoordinator {
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
        if self.lock().as_ref().is_some_and(|run| run.is_external) {
            return Err(AppError::Message(
                "An external selection job is running".into(),
            ));
        }
        match self.take_active_at(now) {
            SelectionRunTakeOutcome::Active(run) => Ok(TriggerDecision::Cancel(run, guard)),
            SelectionRunTakeOutcome::Empty => Ok(TriggerDecision::Capture(guard, None)),
            SelectionRunTakeOutcome::Abandoned(run) => {
                Ok(TriggerDecision::Capture(guard, Some(run)))
            }
        }
    }

    fn capture_and_publish(
        &self,
        backend: &impl SelectionBackend,
        action: String,
        wait: TriggerWait,
        guard: CapturingGuard,
        abandoned: Option<SelectionRun>,
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
                self.lock().replace(SelectionRun {
                    id: run_id,
                    captured_text: Some(text.clone()),
                    ..run
                });
                SelectionRunEvent {
                    run_id,
                    action,
                    text: Some(text),
                    error: None,
                    user_config,
                }
            }
            Err(error) => {
                log::warn!("Could not capture the selection: {}", error.message);
                SelectionRunEvent {
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
        if !backend.can_run() {
            backend.restore(run);
            return Err(AppError::ServiceUnavailable(
                "Selection service is stopping".into(),
            ));
        }
        let id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        run.id = id;
        run.is_external = true;
        run.captured_text = Some(text.clone());
        self.lock().replace(run);
        Ok((id, text))
    }

    fn finish_with(
        &self,
        backend: &impl SelectionBackend,
        run_id: u64,
        text: Option<String>,
    ) -> Result<SelectionFinishStatus, AppError> {
        let Some(run) = self.take_if(run_id) else {
            return Ok(SelectionFinishStatus::Stale);
        };
        match text.filter(|_| backend.can_run()) {
            None => {
                backend.restore(run);
                Ok(SelectionFinishStatus::Restored)
            }
            Some(text) => backend.paste(&backend.user_config(), run, text),
        }
    }
}

fn cancel_with(backend: &impl SelectionBackend, run: SelectionRun) {
    let id = run.id;
    backend.restore(run);
    if let Err(error) = backend.cancelled(id) {
        log::warn!("Could not report the cancelled selection run: {error}");
    }
}

/// Starts an action, or cancels the current hotkey run on a second trigger.
pub fn trigger(app: &AppHandle, action: &str, wait: TriggerWait) -> Result<(), AppError> {
    if app.state::<AppState>().is_quitting() {
        return Err(AppError::ServiceUnavailable(
            "Selection service is stopping".into(),
        ));
    }
    let decision = app
        .state::<SelectionRunCoordinator>()
        .begin_trigger(action, Instant::now())?;
    match decision {
        TriggerDecision::Busy => {
            log::debug!("Ignoring the {action} trigger: a selection is being captured")
        }
        TriggerDecision::Cancel(run, _guard) => cancel_with(&SystemSelectionBackend(app), run),
        TriggerDecision::Capture(guard, abandoned) => {
            let app = app.clone();
            let action = action.to_owned();
            let services = app.state::<super::background::BackgroundServices>();
            let handle = app.clone();
            services.spawn_thread("selection-run", move |stop| {
                if stop.is_stopped() {
                    return;
                }
                let app = handle;
                app.state::<SelectionRunCoordinator>().capture_and_publish(
                    &SystemSelectionBackend(&app),
                    action,
                    wait,
                    guard,
                    abandoned,
                );
            })?;
        }
    }
    Ok(())
}

pub fn shutdown(app: &AppHandle) {
    let run = app.state::<SelectionRunCoordinator>().lock().take();
    if let Some(run) = run {
        cancel_with(&SystemSelectionBackend(app), run);
    }
}

pub fn prepare_external(app: &AppHandle) -> Result<(u64, String), AppError> {
    app.state::<SelectionRunCoordinator>()
        .prepare_external_with(&SystemSelectionBackend(app))
}

pub fn finish(
    app: &AppHandle,
    run_id: u64,
    text: Option<String>,
) -> Result<SelectionFinishStatus, AppError> {
    app.state::<SelectionRunCoordinator>()
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
        for valid in ["correction", "command:fix"] {
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

    fn run_at(id: u64, started_at: Instant) -> SelectionRun {
        SelectionRun {
            id,
            is_external: false,
            captured_text: None,
            target: SelectionTarget {
                id: String::from("window"),
                is_terminal: false,
            },
            started_at,
            #[cfg(any(target_os = "linux", target_os = "windows"))]
            clipboard_snapshot: None,
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
        let runs = SelectionRunCoordinator::default();
        runs.lock().replace(run_at(2, Instant::now()));
        assert!(runs.take_if(1).is_none());
        assert_eq!(runs.take_if(2).map(|run| run.id), Some(2));
        assert!(runs.take_if(2).is_none());
    }

    #[test]
    fn an_abandoned_run_is_not_cancelled_but_dropped() {
        let runs = SelectionRunCoordinator::default();
        let now = Instant::now();
        runs.lock().replace(run_at(1, now));
        assert!(matches!(
            runs.take_active_at(now + ABANDONED_RUN_AGE - Duration::from_nanos(1)),
            SelectionRunTakeOutcome::Active(SelectionRun { id: 1, .. })
        ));
        runs.lock().replace(run_at(2, now));
        assert!(matches!(
            runs.take_active_at(now + ABANDONED_RUN_AGE),
            SelectionRunTakeOutcome::Abandoned(SelectionRun { id: 2, .. })
        ));
        assert!(runs.lock().is_none());
    }

    #[test]
    fn an_abandoned_run_gets_its_clipboard_back_before_the_next_capture() {
        let runs = SelectionRunCoordinator::default();
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
        events: Mutex<Vec<SelectionRunEvent>>,
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
        fn capture(&self, config: &Value) -> Result<(String, SelectionRun), SelectionRunError> {
            assert_eq!(config, &self.user_config());
            self.operations.lock().unwrap().push("capture".into());
            if self.capture_error {
                Err(SelectionRunError::new(
                    SelectionRunErrorCode::NoSelection,
                    "no selection",
                ))
            } else {
                Ok(("selected".into(), run_at(0, Instant::now())))
            }
        }
        fn restore(&self, run: SelectionRun) {
            self.operations
                .lock()
                .unwrap()
                .push(format!("restore:{}", run.id));
        }
        fn paste(
            &self,
            _config: &Value,
            run: SelectionRun,
            text: String,
        ) -> Result<SelectionFinishStatus, AppError> {
            self.operations
                .lock()
                .unwrap()
                .push(format!("paste:{}:{text}", run.id));
            if self.paste_error {
                Err(AppError::Message("paste failed".into()))
            } else {
                Ok(SelectionFinishStatus::Pasted)
            }
        }
        fn publish(&self, event: SelectionRunEvent) -> Result<(), AppError> {
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

    fn start(runs: &SelectionRunCoordinator, backend: &Backend) -> u64 {
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
        let runs = SelectionRunCoordinator::default();
        let backend = Backend::default();
        let id = start(&runs, &backend);
        assert_eq!(
            backend.events.lock().unwrap()[0].text.as_deref(),
            Some("selected")
        );
        assert_eq!(
            runs.finish_with(&backend, id + 1, Some("wrong".into()))
                .unwrap(),
            SelectionFinishStatus::Stale
        );
        assert_eq!(
            runs.finish_with(&backend, id, Some("result".into()))
                .unwrap(),
            SelectionFinishStatus::Pasted
        );
        assert_eq!(
            runs.finish_with(&backend, id, None).unwrap(),
            SelectionFinishStatus::Stale
        );
        assert_eq!(
            *backend.operations.lock().unwrap(),
            ["wait", "capture", "publish", "paste:1:result"]
        );
    }

    #[test]
    fn failed_publication_restores_only_its_capture_and_releases_the_reservation() {
        let runs = SelectionRunCoordinator::default();
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
        let runs = SelectionRunCoordinator::default();
        let backend = Backend {
            capture_error: true,
            ..Backend::default()
        };
        start(&runs, &backend);
        assert!(runs.lock().is_none());
        let events = backend.events.lock().unwrap();
        assert_eq!(
            events[0].error.as_ref().unwrap().code,
            SelectionRunErrorCode::NoSelection
        );
        assert!(events[0].text.is_none());
        assert!(!runs.capturing.load(Ordering::SeqCst));
    }

    #[test]
    fn a_second_trigger_cancels_and_keeps_capture_reserved_until_restoration_finishes() {
        let runs = SelectionRunCoordinator::default();
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
        let runs = SelectionRunCoordinator::default();
        let backend = Backend::default();
        let (id, text) = runs.prepare_external_with(&backend).unwrap();
        assert_eq!(text, "selected");
        assert!(runs.begin_trigger("correction", Instant::now()).is_err());
        assert!(!runs.capturing.load(Ordering::SeqCst));
        assert_eq!(
            runs.finish_with(&backend, id, None).unwrap(),
            SelectionFinishStatus::Restored
        );
        assert!(runs.lock().is_none());
    }

    #[test]
    fn paste_failure_consumes_the_run_and_is_returned_to_the_caller() {
        let runs = SelectionRunCoordinator::default();
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
        let runs = SelectionRunCoordinator::default();
        assert!(runs.begin_trigger("invalid", Instant::now()).is_err());
        let result = std::panic::catch_unwind(|| {
            let _guard = runs.reserve().unwrap();
            panic!("capture panic");
        });
        assert!(result.is_err());
        assert!(runs.reserve().is_some());
    }
}
