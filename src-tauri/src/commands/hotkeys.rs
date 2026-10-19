use crate::errors::AppError;
use tauri::AppHandle;
#[tauri::command]
pub fn apply_hotkey(
    app: AppHandle,
    request: crate::services::hotkeys::HotkeyApplyRequest,
) -> Result<crate::services::hotkeys::HotkeyApplyResult, AppError> {
    crate::services::hotkeys::apply(&app, request)
}

/// Lets the user change the portal shortcuts: in the portal's dialog, or in
/// the desktop settings where the portal has none.
#[tauri::command]
pub async fn open_system_hotkey_settings(app: AppHandle) -> Result<(), AppError> {
    crate::services::hotkeys::configure(&app).await
}

#[tauri::command]
pub fn suspend_hotkeys(app: AppHandle, suspended: bool) {
    crate::services::hotkeys::set_suspended(&app, suspended);
}

/// Binds the portal hotkeys again in a new session; see `hotkeys::rebind`.
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
