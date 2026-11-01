use super::run_blocking;
use crate::{
    errors::AppError,
    models::{StorageInfo, StorageKind},
    services::storage,
};
use tauri::AppHandle;
#[tauri::command]
pub async fn get_storage_info(app: AppHandle) -> Result<StorageInfo, AppError> {
    run_blocking(move || storage::get_storage_info(&app)).await?
}

#[tauri::command]
pub async fn open_storage_location(app: AppHandle, kind: StorageKind) -> Result<(), AppError> {
    run_blocking(move || crate::services::platform::open_dir(&storage::storage_dir(&app, kind)?))
        .await?
}

/// What a folder holds, for the user to choose whether to move the data
/// there or connect it; `None` asks about the default folder.
#[tauri::command]
pub async fn inspect_user_data_target(
    app: AppHandle,
    path: Option<String>,
) -> Result<storage::user_data_relocation::UserDataTarget, AppError> {
    run_blocking(move || storage::user_data_relocation::inspect(&app, path.as_deref())).await?
}

/// Changes the user data folder as `mode` says, then restarts the app.
#[tauri::command]
pub async fn relocate_user_data(
    app: AppHandle,
    mode: crate::models::UserDataRelocationMode,
    path: Option<String>,
) -> Result<(), AppError> {
    run_blocking(move || storage::user_data_relocation::relocate(&app, mode, path.as_deref()))
        .await?
}
