use tauri::{AppHandle, State};

use crate::errors::AppError;
use crate::models::{ChatHistoryItem, EditorHistoryEntry, EditorHistoryItem};
use crate::services::storage;
use crate::state::AppState;

#[tauri::command]
pub fn get_editor_history(app: AppHandle) -> Result<Vec<EditorHistoryItem>, AppError> {
    storage::get_editor_history(&app)
}

#[tauri::command]
pub fn get_chat_history(app: AppHandle) -> Result<Vec<ChatHistoryItem>, AppError> {
    storage::get_chat_history(&app)
}

#[tauri::command]
pub fn get_chat(app: AppHandle, id: String) -> Result<Option<ChatHistoryItem>, AppError> {
    storage::get_chat(&app, id)
}

#[tauri::command]
pub fn save_editor_history(
    app: AppHandle,
    state: State<'_, AppState>,
    entry: EditorHistoryEntry,
) -> Result<Option<String>, AppError> {
    let params = state.params();
    storage::save_editor_history(&app, &params.user_config, entry)
}

#[tauri::command]
pub fn set_editor_history_result(
    app: AppHandle,
    id: String,
    result: String,
) -> Result<(), AppError> {
    storage::set_editor_history_result(&app, id, result)
}

#[tauri::command]
pub fn restore_editor_history_item(
    app: AppHandle,
    state: State<'_, AppState>,
    item: EditorHistoryItem,
) -> Result<(), AppError> {
    let params = state.params();
    storage::restore_editor_history_item(&app, &params.user_config, item)
}

#[tauri::command]
pub fn save_chat_history(
    app: AppHandle,
    state: State<'_, AppState>,
    chat_history_item: ChatHistoryItem,
) -> Result<(), AppError> {
    let params = state.params();
    storage::save_chat_history(&app, &params.user_config, chat_history_item)
}

#[tauri::command]
pub fn remove_from_editor_history(app: AppHandle, id: String) -> Result<(), AppError> {
    storage::remove_from_editor_history(&app, id)
}

#[tauri::command]
pub fn remove_from_chat_history(app: AppHandle, id: String) -> Result<(), AppError> {
    storage::remove_from_chat_history(&app, id)
}

#[tauri::command]
pub fn clear_editor_history(app: AppHandle) -> Result<(), AppError> {
    storage::clear_editor_history(&app)
}

#[tauri::command]
pub fn clear_chat_history(app: AppHandle) -> Result<(), AppError> {
    storage::clear_chat_history(&app)
}
