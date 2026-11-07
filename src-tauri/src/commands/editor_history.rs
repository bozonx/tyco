use super::run_blocking;
use crate::{
    errors::AppError,
    models::{EditorHistoryEntry, EditorHistoryItem},
    services::storage,
};
use tauri::AppHandle;
#[tauri::command]
pub async fn get_editor_history(app: AppHandle) -> Result<Vec<EditorHistoryItem>, AppError> {
    run_blocking(move || storage::read_editor_history(&app)).await?
}

/// Adds a text, or replaces the draft it supersedes; returns the id of the
/// item, or nothing while the history is off.
#[tauri::command]
pub async fn add_editor_history_item(
    app: AppHandle,
    entry: EditorHistoryEntry,
) -> Result<Option<String>, AppError> {
    run_blocking(move || storage::add_editor_history_item(&app, entry)).await?
}

/// Keeps what the AI turned the `source` item `id` into.
#[tauri::command]
pub async fn set_editor_history_item_result(
    app: AppHandle,
    id: String,
    result: String,
) -> Result<(), AppError> {
    run_blocking(move || storage::set_editor_history_result(&app, id, result)).await?
}

/// Puts back an item deleted with `delete_editor_history_item`.
#[tauri::command]
pub async fn restore_editor_history_item(
    app: AppHandle,
    item: EditorHistoryItem,
) -> Result<(), AppError> {
    run_blocking(move || storage::restore_editor_history_item(&app, item)).await?
}

#[tauri::command]
pub async fn delete_editor_history_item(app: AppHandle, id: String) -> Result<(), AppError> {
    run_blocking(move || storage::delete_editor_history_item(&app, id)).await?
}

#[tauri::command]
pub async fn clear_editor_history(app: AppHandle) -> Result<(), AppError> {
    run_blocking(move || storage::clear_editor_history(&app)).await?
}
