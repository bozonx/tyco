use super::run_blocking;
use crate::{
    errors::AppError,
    models::DesktopSnapshot,
    services::{runtime, settings},
    state::AppState,
};
use serde_json::Value;
use tauri::{AppHandle, State};
#[tauri::command]
pub fn get_user_config(state: State<'_, AppState>) -> serde_json::Value {
    state.snapshot().settings.user_config
}

#[tauri::command]
pub async fn save_user_config(
    app: AppHandle,
    user_config: Value,
    base_config: Value,
) -> Result<DesktopSnapshot, AppError> {
    run_blocking(move || settings::save_user_config(&app, user_config, base_config)).await?
}

#[tauri::command]
pub async fn patch_session_state(
    app: AppHandle,
    patch: serde_json::Map<String, Value>,
) -> Result<DesktopSnapshot, AppError> {
    run_blocking(move || settings::patch_session_state(&app, patch)).await?
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
