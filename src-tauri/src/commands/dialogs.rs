use super::run_blocking;
use crate::{
    errors::AppError,
    models::{Dialog, DialogSummary},
    services::storage,
};
use tauri::AppHandle;

#[tauri::command]
pub async fn list_dialogs(app: AppHandle) -> Result<Vec<DialogSummary>, AppError> {
    run_blocking(move || storage::list_dialogs(&app)).await?
}

#[tauri::command]
pub async fn get_dialog(app: AppHandle, id: String) -> Result<Option<Dialog>, AppError> {
    run_blocking(move || storage::read_dialog(&app, id)).await?
}

#[tauri::command]
pub async fn save_dialog(app: AppHandle, dialog: Dialog) -> Result<(), AppError> {
    run_blocking(move || storage::save_dialog(&app, dialog)).await?
}

#[tauri::command]
pub async fn rename_dialog(app: AppHandle, id: String, title: String) -> Result<(), AppError> {
    run_blocking(move || storage::rename_dialog(&app, id, title)).await?
}

#[tauri::command]
pub async fn search_dialogs(app: AppHandle, query: String) -> Result<Vec<String>, AppError> {
    run_blocking(move || storage::search_dialogs(&app, query)).await?
}

#[tauri::command]
pub async fn delete_dialog(app: AppHandle, id: String) -> Result<Option<Dialog>, AppError> {
    run_blocking(move || storage::delete_dialog(&app, id)).await?
}

#[tauri::command]
pub async fn release_dialog_recordings(app: AppHandle, id: String) -> Result<(), AppError> {
    run_blocking(move || storage::release_dialog_recordings(&app, id)).await?
}

#[tauri::command]
pub async fn clear_dialogs(app: AppHandle) -> Result<(), AppError> {
    run_blocking(move || storage::clear_dialogs(&app)).await?
}
