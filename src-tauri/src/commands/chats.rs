use super::blocking;
use crate::{
    errors::AppError,
    models::{Chat, ChatSummary},
    services::storage,
};
use tauri::{AppHandle, WebviewWindow};
#[tauri::command]
pub async fn list_chats(app: AppHandle) -> Result<Vec<ChatSummary>, AppError> {
    blocking(move || storage::list_chats(&app)).await?
}

#[tauri::command]
pub async fn get_chat(
    window: WebviewWindow,
    app: AppHandle,
    id: String,
    lease: Option<String>,
) -> Result<Option<Chat>, AppError> {
    let owner = lease.map(|lease| format!("{}/import/{lease}", window.label()));
    blocking(move || storage::get_chat(&app, id, owner)).await?
}

#[tauri::command]
pub async fn save_chat(app: AppHandle, chat: Chat) -> Result<(), AppError> {
    blocking(move || storage::save_chat(&app, chat)).await?
}

#[tauri::command]
pub async fn rename_chat(app: AppHandle, id: String, title: String) -> Result<(), AppError> {
    blocking(move || storage::rename_chat(&app, id, title)).await?
}

#[tauri::command]
pub async fn search_chats(app: AppHandle, query: String) -> Result<Vec<String>, AppError> {
    blocking(move || storage::search_chats(&app, query)).await?
}

#[tauri::command]
pub async fn delete_chat(
    window: WebviewWindow,
    app: AppHandle,
    id: String,
) -> Result<(), AppError> {
    let owner = format!("{}/undo/{id}", window.label());
    blocking(move || storage::delete_chat(&app, id, owner)).await?
}

#[tauri::command]
pub async fn clear_chats(app: AppHandle) -> Result<(), AppError> {
    blocking(move || storage::clear_chats(&app)).await?
}
