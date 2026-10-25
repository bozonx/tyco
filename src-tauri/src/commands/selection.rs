use tauri::AppHandle;

use crate::errors::AppError;
use crate::services::platform::{self, TextInsertionStatus};
use crate::services::runtime::{self, FOCUS_RELEASE_TIMEOUT};
use crate::services::selection_replace::{self, SelectionFinishStatus, COMMAND_ACTION_PREFIX};

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

/// The command overlay hands a command that replaces the selection over to a
/// selection run: once the overlay is hidden and the window under it has the
/// focus back, the selection is captured there and replaced with the output.
#[tauri::command]
pub async fn replace_selection_with_command(
    app: AppHandle,
    command_id: String,
) -> Result<(), AppError> {
    runtime::hide_active_window(&app)?;
    super::run_blocking(move || {
        runtime::wait_until_unfocused(&app, FOCUS_RELEASE_TIMEOUT);
        selection_replace::trigger(
            &app,
            &format!("{COMMAND_ACTION_PREFIX}{command_id}"),
            selection_replace::TriggerWait::Now,
            selection_replace::TriggerKind::Replace,
        )
    })
    .await?
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
