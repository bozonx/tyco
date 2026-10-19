use super::run_blocking;
use crate::{
    errors::AppError,
    models::{Chat, ChatSummary},
    services::storage::{self, ChatScope},
};
use tauri::{AppHandle, WebviewWindow};

// Without `profile_id` a command works on the chats of "Ask AI", with it on
// the chats of that profile. How chat images are held: see `chat_images`.

#[tauri::command]
pub async fn list_chats(
    app: AppHandle,
    profile_id: Option<String>,
) -> Result<Vec<ChatSummary>, AppError> {
    let scope = ChatScope::from_profile_id(profile_id);
    run_blocking(move || storage::list_chats(&app, &scope)).await?
}

#[tauri::command]
pub async fn get_chat(
    window: WebviewWindow,
    app: AppHandle,
    id: String,
    import_id: Option<String>,
    profile_id: Option<String>,
) -> Result<Option<Chat>, AppError> {
    let owner = import_id
        .map(|import_id| super::chat_images::import_owner(&window, &import_id))
        .transpose()?;
    let scope = ChatScope::from_profile_id(profile_id);
    run_blocking(move || storage::read_chat(&app, &scope, id, owner)).await?
}

#[tauri::command]
pub async fn save_chat(
    app: AppHandle,
    chat: Chat,
    profile_id: Option<String>,
) -> Result<(), AppError> {
    let scope = ChatScope::from_profile_id(profile_id);
    run_blocking(move || storage::save_chat(&app, &scope, chat)).await?
}

#[tauri::command]
pub async fn rename_chat(
    app: AppHandle,
    id: String,
    title: String,
    profile_id: Option<String>,
) -> Result<(), AppError> {
    let scope = ChatScope::from_profile_id(profile_id);
    run_blocking(move || storage::rename_chat(&app, &scope, id, title)).await?
}

#[tauri::command]
pub async fn search_chats(
    app: AppHandle,
    query: String,
    profile_id: Option<String>,
) -> Result<Vec<String>, AppError> {
    let scope = ChatScope::from_profile_id(profile_id);
    run_blocking(move || storage::search_chats(&app, &scope, query)).await?
}

#[tauri::command]
pub async fn delete_chat(
    window: WebviewWindow,
    app: AppHandle,
    id: String,
    profile_id: Option<String>,
) -> Result<(), AppError> {
    let owner = super::chat_images::deleted_chat_owner(&window, &id);
    let scope = ChatScope::from_profile_id(profile_id);
    run_blocking(move || storage::delete_chat(&app, &scope, id, owner)).await?
}

#[tauri::command]
pub async fn clear_chats(app: AppHandle, profile_id: Option<String>) -> Result<(), AppError> {
    let scope = ChatScope::from_profile_id(profile_id);
    run_blocking(move || storage::clear_chats(&app, &scope)).await?
}
