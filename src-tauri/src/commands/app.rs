use serde_json::Value;
use tauri::{AppHandle, State};

use crate::errors::AppError;
use crate::models::{InitParams, LocalState, StorageInfo};
use crate::services::{runtime, storage};
use crate::state::AppState;

#[tauri::command]
pub fn get_init_params(state: State<'_, AppState>) -> Result<InitParams, AppError> {
    Ok(state.params())
}

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
pub fn open_main_editor(
    app: AppHandle,
    text: Option<String>,
    source_text: Option<String>,
) -> Result<(), AppError> {
    runtime::open_main_editor(&app, text, source_text)
}

#[tauri::command]
pub fn save_user_config(
    app: AppHandle,
    state: State<'_, AppState>,
    user_config_json: String,
) -> Result<(), AppError> {
    let user_config: Value = serde_json::from_str(&user_config_json)?;
    storage::save_user_config(&app, &user_config)?;
    state.update_params(|params| {
        params.user_config = user_config;
    });
    runtime::emit_params(&app, &state)?;

    Ok(())
}

#[tauri::command]
pub fn get_storage_info(app: AppHandle) -> Result<StorageInfo, AppError> {
    storage::get_storage_info(&app)
}

#[tauri::command]
pub fn mark_activation_metric(app: AppHandle, id: u64, mark: String) {
    crate::services::activation_metrics::mark_from_frontend(&app, id, &mark);
}

#[tauri::command]
pub fn submit_activation_metric_value(app: AppHandle, id: u64, value: String) {
    crate::services::activation_metrics::submit_value(&app, id, value);
}
#[tauri::command]
pub fn save_local_state(
    app: AppHandle,
    state: State<'_, AppState>,
    local_state: LocalState,
) -> Result<(), AppError> {
    storage::save_local_state(&app, &local_state)?;
    state.update_params(|params| {
        params.local_state = local_state;
    });
    runtime::emit_params(&app, &state)?;

    Ok(())
}
