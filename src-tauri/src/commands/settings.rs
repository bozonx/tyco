use super::run_blocking;
use crate::{
    errors::AppError,
    ipc::{SessionStatePatch, UserConfig},
    models::DesktopSnapshot,
    services::{runtime, settings},
};
use tauri::AppHandle;

/// Saves `user_config`, merged with what was saved since `base_config`, the
/// config it was edited from.
#[tauri::command]
pub async fn save_user_config(
    app: AppHandle,
    user_config: UserConfig,
    base_config: UserConfig,
) -> Result<DesktopSnapshot, AppError> {
    run_blocking(move || settings::save_user_config(&app, user_config.0, base_config.0)).await?
}

#[tauri::command]
pub async fn patch_session_state(
    app: AppHandle,
    patch: SessionStatePatch,
) -> Result<DesktopSnapshot, AppError> {
    run_blocking(move || settings::patch_session_state(&app, patch.0)).await?
}

#[tauri::command]
pub fn acknowledge_settings_shutdown(
    app: AppHandle,
    window: tauri::WebviewWindow,
    request_id: u64,
    saved: bool,
) {
    runtime::settings_shutdown::acknowledge(&app, request_id, window.label(), saved);
}
