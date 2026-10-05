use tauri::{AppHandle, State};

use std::time::Duration;

use tyco_activation_protocol::COMMAND_ACTION_PREFIX;

use crate::errors::AppError;
use crate::services::runtime;
use crate::services::selection_replace::{self, FinishStatus};
use crate::services::status_overlay::{self, OverlayRequest};
use crate::state::AppState;

const FOCUS_RELEASE_TIMEOUT: Duration = Duration::from_millis(300);

/// Pastes the result of a selection run over the selection; `text` is `None`
/// when there is nothing to insert. Async so that waiting for the paste does
/// not hold the main thread.
#[tauri::command]
pub async fn finish_selection_run(
    app: AppHandle,
    run_id: u64,
    text: Option<String>,
) -> Result<FinishStatus, AppError> {
    tauri::async_runtime::spawn_blocking(move || selection_replace::finish(&app, run_id, text))
        .await
        .map_err(|error| AppError::Message(error.to_string()))?
        .inspect_err(|error| log::error!("Could not replace the selection: {error}"))
}

/// The command overlay hands a command that replaces the selection over to a
/// selection run: once the overlay is hidden and the window under it has the
/// focus back, the selection is captured there and replaced with the output.
#[tauri::command]
pub async fn replace_selection_with_command(
    app: AppHandle,
    command_id: String,
) -> Result<(), AppError> {
    runtime::hide_active_window(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        runtime::wait_until_unfocused(&app, FOCUS_RELEASE_TIMEOUT);
        selection_replace::trigger(
            &app,
            &format!("{COMMAND_ACTION_PREFIX}{command_id}"),
            selection_replace::TriggerWait::Now,
        )
    })
    .await
    .map_err(|error| AppError::Message(error.to_string()))?
}

#[tauri::command]
pub fn show_status_overlay(
    app: AppHandle,
    request: Option<OverlayRequest>,
) -> Result<(), AppError> {
    status_overlay::update(&app, request)
}

#[tauri::command]
pub async fn notify_desktop(summary: String, body: String) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::services::desktop_notifications::notify(&summary, &body)
    })
    .await
    .map_err(|error| AppError::Message(error.to_string()))?
}

/// Fails with what is missing for pressing keys in other windows.
#[tauri::command]
pub fn check_text_injection(state: State<'_, AppState>) -> Result<(), AppError> {
    crate::services::platform::check_text_injection(&state.params().user_config)
}
