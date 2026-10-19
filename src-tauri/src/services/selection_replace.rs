//! Replaces the selection in the focused window with what an action makes of
//! it: a correction, a translation or an AI task. No Tyco window is shown, so
//! the focus and the selection stay where they are. The text is copied out
//! with the copy keys, transformed by the webview of the quick window, and
//! pasted back over the selection, which the paste replaces.

mod coordinator;
mod hotkey_release;
#[cfg(test)]
mod tests;

pub use coordinator::SelectionRunCoordinator;
pub use hotkey_release::{hotkey_released, HotkeyPress};

use self::coordinator::{cancel_with, SelectionBackend, TriggerDecision};

use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

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
    pub(super) code: SelectionRunErrorCode,
    pub(super) message: String,
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
pub(super) struct SelectionRunEvent {
    pub(super) run_id: u64,
    pub(super) action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) error: Option<SelectionRunError>,
    /// The quick window does not receive config changes made elsewhere.
    pub(super) user_config: std::sync::Arc<Value>,
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
    /// What the clipboard held before the copy keys overwrote it.
    pub clipboard_snapshot: Option<super::platform::ClipboardSnapshot>,
}

struct SystemSelectionBackend<'a>(&'a AppHandle);

impl SelectionBackend for SystemSelectionBackend<'_> {
    fn can_run(&self) -> bool {
        !self.0.state::<AppState>().is_quitting()
    }
    fn user_config(&self) -> std::sync::Arc<Value> {
        self.0.state::<AppState>().user_config()
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

/// Ends the run without replacing the selection: the clipboard gets its
/// content back.
pub fn release(app: &AppHandle, run_id: u64) {
    if let Err(error) = finish(app, run_id, None) {
        log::warn!("Could not release the selection run: {error}");
    }
}

/// The selection of the focused window, read the way a replacement reads it
/// and released right away.
pub fn read_external(app: &AppHandle) -> Result<String, AppError> {
    let (run_id, text) = prepare_external(app)?;
    release(app, run_id);
    Ok(text)
}

fn emit_to_webview(
    app: &AppHandle,
    event: &str,
    payload: impl Serialize + Clone,
) -> Result<(), AppError> {
    let window = app
        .get_webview_window(super::runtime::QUICK_WINDOW_LABEL)
        .ok_or_else(|| AppError::Message(String::from("Quick window not found")))?;
    Ok(window.emit(event, payload)?)
}
