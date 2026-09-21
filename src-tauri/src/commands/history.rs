use tauri::{AppHandle, State};

use crate::errors::AppError;
use crate::models::{ChatHistoryItem, EditorHistoryEntry, EditorHistoryItem};
use crate::services::storage;
use crate::state::AppState;

#[tauri::command]
pub fn get_editor_history(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<EditorHistoryItem>, AppError> {
    let _guard = state.lock_history_storage();
    storage::get_editor_history(&app)
}

#[tauri::command]
pub fn get_chat_history(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<ChatHistoryItem>, AppError> {
    let _guard = state.lock_history_storage();
    storage::get_chat_history(&app)
}

#[tauri::command]
pub fn get_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<ChatHistoryItem>, AppError> {
    let _guard = state.lock_history_storage();
    storage::get_chat(&app, id)
}

#[tauri::command]
pub fn save_editor_history(
    app: AppHandle,
    state: State<'_, AppState>,
    entry: EditorHistoryEntry,
) -> Result<Option<String>, AppError> {
    let _guard = state.lock_history_storage();
    let params = state.params();
    storage::save_editor_history(&app, &params.user_config, entry)
}

#[tauri::command]
pub fn set_editor_history_result(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    result: String,
) -> Result<(), AppError> {
    let _guard = state.lock_history_storage();
    storage::set_editor_history_result(&app, id, result)
}

#[tauri::command]
pub fn restore_editor_history_item(
    app: AppHandle,
    state: State<'_, AppState>,
    item: EditorHistoryItem,
) -> Result<(), AppError> {
    let _guard = state.lock_history_storage();
    let params = state.params();
    storage::restore_editor_history_item(&app, &params.user_config, item)
}

#[tauri::command]
pub fn save_chat_history(
    app: AppHandle,
    state: State<'_, AppState>,
    chat_history_item: ChatHistoryItem,
) -> Result<(), AppError> {
    let _guard = state.lock_history_storage();
    let params = state.params();
    storage::save_chat_history(&app, &params.user_config, chat_history_item)
}

#[tauri::command]
pub fn remove_from_editor_history(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), AppError> {
    let _guard = state.lock_history_storage();
    storage::remove_from_editor_history(&app, id)
}

#[tauri::command]
pub fn remove_from_chat_history(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), AppError> {
    let _guard = state.lock_history_storage();
    storage::remove_from_chat_history(&app, id)
}

#[tauri::command]
pub fn clear_editor_history(app: AppHandle, state: State<'_, AppState>) -> Result<(), AppError> {
    let _guard = state.lock_history_storage();
    storage::clear_editor_history(&app)
}

#[tauri::command]
pub fn clear_chat_history(app: AppHandle, state: State<'_, AppState>) -> Result<(), AppError> {
    let _guard = state.lock_history_storage();
    storage::clear_chat_history(&app)
}
