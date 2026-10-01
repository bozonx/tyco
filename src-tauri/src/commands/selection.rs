use tauri::{AppHandle, State};

use crate::errors::AppError;
use crate::services::selection_replace::{self, FinishStatus};
use crate::services::status_overlay::{self, OverlayRequest};
use crate::state::AppState;

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
    crate::services::text_injector::SystemTextInjector::detect().check(&state.params().user_config)
}
