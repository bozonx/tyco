use super::blocking;
use crate::{
    errors::AppError,
    models::{EditorHistoryEntry, EditorHistoryItem},
    services::storage,
};
use tauri::AppHandle;
#[tauri::command]
pub async fn get_editor_history(app: AppHandle) -> Result<Vec<EditorHistoryItem>, AppError> {
    blocking(move || storage::get_editor_history(&app)).await?
}

#[tauri::command]
pub async fn save_editor_history(
    app: AppHandle,
    entry: EditorHistoryEntry,
) -> Result<Option<String>, AppError> {
    blocking(move || storage::save_editor_history(&app, entry)).await?
}

#[tauri::command]
pub async fn set_editor_history_result(
    app: AppHandle,
    id: String,
    result: String,
) -> Result<(), AppError> {
    blocking(move || storage::set_editor_history_result(&app, id, result)).await?
}

#[tauri::command]
pub async fn restore_editor_history_item(
    app: AppHandle,
    item: EditorHistoryItem,
) -> Result<(), AppError> {
    blocking(move || storage::restore_editor_history_item(&app, item)).await?
}

#[tauri::command]
pub async fn remove_from_editor_history(app: AppHandle, id: String) -> Result<(), AppError> {
    blocking(move || storage::remove_from_editor_history(&app, id)).await?
}

#[tauri::command]
pub async fn clear_editor_history(app: AppHandle) -> Result<(), AppError> {
    blocking(move || storage::clear_editor_history(&app)).await?
}
