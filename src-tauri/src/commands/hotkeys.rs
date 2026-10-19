use crate::errors::AppError;
use tauri::AppHandle;
#[tauri::command]
pub fn apply_hotkey(
    app: AppHandle,
    request: crate::services::hotkeys::ApplyHotkeyRequest,
) -> Result<crate::services::hotkeys::ApplyHotkeyResult, AppError> {
    crate::services::hotkeys::apply(&app, request)
}

#[tauri::command]
pub async fn configure_hotkeys(app: AppHandle) -> Result<(), AppError> {
    crate::services::hotkeys::configure(&app).await
}

#[tauri::command]
pub fn suspend_hotkeys(app: AppHandle, suspended: bool) {
    crate::services::hotkeys::set_suspended(&app, suspended);
}

#[tauri::command]
pub async fn rebind_hotkeys(app: AppHandle) -> Result<(), AppError> {
    crate::services::hotkeys::rebind(&app).await
}

#[tauri::command]
pub async fn get_hotkey_provider_info(
    app: AppHandle,
) -> crate::services::hotkeys::HotkeyProviderInfo {
    crate::services::hotkeys::provider_info(&app).await
}
