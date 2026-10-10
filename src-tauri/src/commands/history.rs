use tauri::{AppHandle, State};

use crate::errors::AppError;
use crate::models::{ChatHistoryItem, EditorHistoryEntry, EditorHistoryItem};
use crate::services::storage;
use crate::state::AppState;

#[tauri::command(async)]
pub fn get_editor_history(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<EditorHistoryItem>, AppError> {
    let mut memory = state.lock_history_storage();
    let params = state.params();
    storage::get_editor_history(&app, &params.user_config, &mut memory)
}

#[tauri::command(async)]
pub fn get_chat_history(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<ChatHistoryItem>, AppError> {
    let _guard = state.lock_history_storage();
    storage::get_chat_history(&app)
}

#[tauri::command(async)]
pub fn get_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<ChatHistoryItem>, AppError> {
    let _guard = state.lock_history_storage();
    let chat = storage::get_chat(&app, id)?;
    if let Some(chat) = &chat {
        let directory = storage::chat_image_directory(&app)?;
        let mut images = state.chat_images.lock().expect("chat image lock poisoned");
        for image in chat.messages.iter().flat_map(|message| &message.images) {
            // A broken image must not prevent the rest of the chat from opening.
            let _ = images.get(&directory, &image.id);
        }
    }
    Ok(chat)
}

#[tauri::command(async)]
pub fn save_editor_history(
    app: AppHandle,
    state: State<'_, AppState>,
    entry: EditorHistoryEntry,
) -> Result<Option<String>, AppError> {
    let mut memory = state.lock_history_storage();
    let params = state.params();
    storage::save_editor_history(&app, &params.user_config, &mut memory, entry)
}

#[tauri::command(async)]
pub fn set_editor_history_result(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    result: String,
) -> Result<(), AppError> {
    let mut memory = state.lock_history_storage();
    let params = state.params();
    storage::set_editor_history_result(&app, &params.user_config, &mut memory, id, result)
}

#[tauri::command(async)]
pub fn restore_editor_history_item(
    app: AppHandle,
    state: State<'_, AppState>,
    item: EditorHistoryItem,
) -> Result<(), AppError> {
    let mut memory = state.lock_history_storage();
    let params = state.params();
    storage::restore_editor_history_item(&app, &params.user_config, &mut memory, item)
}

#[tauri::command(async)]
pub fn save_chat_history(
    app: AppHandle,
    state: State<'_, AppState>,
    chat_history_item: ChatHistoryItem,
) -> Result<(), AppError> {
    let _guard = state.lock_history_storage();
    let params = state.params();
    storage::save_chat_history(&app, &params.user_config, chat_history_item)
}

#[tauri::command(async)]
pub fn rename_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    description: String,
) -> Result<(), AppError> {
    let _guard = state.lock_history_storage();
    storage::rename_chat(&app, id, description)
}

#[tauri::command(async)]
pub fn search_chat_history(
    app: AppHandle,
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<String>, AppError> {
    let _guard = state.lock_history_storage();
    storage::search_chat_history(&app, query)
}

#[tauri::command(async)]
pub fn remove_from_editor_history(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), AppError> {
    let mut memory = state.lock_history_storage();
    let params = state.params();
    storage::remove_from_editor_history(&app, &params.user_config, &mut memory, id)
}

#[tauri::command(async)]
pub fn remove_from_chat_history(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), AppError> {
    let _guard = state.lock_history_storage();
    storage::remove_from_chat_history(&app, id)
}

#[tauri::command(async)]
pub fn clear_editor_history(app: AppHandle, state: State<'_, AppState>) -> Result<(), AppError> {
    let mut memory = state.lock_history_storage();
    storage::clear_editor_history(&app, &mut memory)
}

#[tauri::command(async)]
pub fn clear_chat_history(app: AppHandle, state: State<'_, AppState>) -> Result<(), AppError> {
    let _guard = state.lock_history_storage();
    storage::clear_chat_history(&app)
}

/// Receives a normalized PNG; drafts never touch the filesystem.
#[tauri::command(async)]
pub fn store_chat_image(
    state: State<'_, AppState>,
    data: String,
    name: Option<String>,
) -> Result<crate::models::ChatImage, AppError> {
    use base64::Engine;
    if data.len() > (crate::services::chat_images::MAX_IMAGE_BYTES * 4 / 3 + 4) {
        return Err(AppError::Message("Image size limit exceeded".into()));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|_| AppError::Message("Invalid image encoding".into()))?;
    state
        .chat_images
        .lock()
        .expect("chat image lock poisoned")
        .insert(&bytes, name)
}

#[tauri::command(async)]
pub fn get_chat_image(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<tauri::ipc::Response, AppError> {
    let _guard = state.lock_history_storage();
    let bytes = state
        .chat_images
        .lock()
        .expect("chat image lock poisoned")
        .get(&storage::chat_image_directory(&app)?, &id)?;
    Ok(tauri::ipc::Response::new(bytes))
}
