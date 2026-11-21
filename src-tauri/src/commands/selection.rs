use tauri::AppHandle;

use crate::errors::AppError;
use crate::services::platform::{self, TextInsertionStatus};
use crate::services::selection_replace::{self, SelectionFinishStatus};

/// Pastes the result of a selection run over the selection; `text` is `None`
/// when there is nothing to insert. Async so that waiting for the paste does
/// not hold the main thread.
#[tauri::command]
pub async fn finish_selection_run(
    app: AppHandle,
    run_id: u64,
    text: Option<String>,
) -> Result<SelectionFinishStatus, AppError> {
    super::run_blocking(move || selection_replace::finish(&app, run_id, text))
        .await?
        .inspect_err(|error| log::error!("Could not replace the selection: {error}"))
}

/// What text insertion into other windows can do now and what it lacks.
#[tauri::command]
pub async fn get_text_insertion_status() -> Result<TextInsertionStatus, AppError> {
    super::run_blocking(platform::text_insertion_status).await
}

/// Asks the user to allow keyboard control where the desktop shows a dialog
/// for it, and tells the status after.
#[tauri::command]
pub async fn request_text_insertion_permission() -> Result<TextInsertionStatus, AppError> {
    super::run_blocking(|| {
        if let Err(error) = platform::request_text_insertion_permission() {
            log::warn!("Keyboard control was not allowed: {error}");
        }
        platform::text_insertion_status()
    })
    .await
}
