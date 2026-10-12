use super::blocking;
use crate::{
    errors::AppError,
    models::{StorageInfo, StorageKind},
    services::storage,
};
use tauri::AppHandle;
#[tauri::command]
pub async fn get_storage_info(app: AppHandle) -> Result<StorageInfo, AppError> {
    blocking(move || storage::get_storage_info(&app)).await?
}

#[tauri::command]
pub async fn open_storage_location(app: AppHandle, kind: StorageKind) -> Result<(), AppError> {
    blocking(move || crate::services::platform::open_dir(&storage::storage_dir(&app, kind)?))
        .await?
}
