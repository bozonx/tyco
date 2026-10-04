use serde_json::Value;
use tauri::{AppHandle, State};

use crate::errors::AppError;
use crate::models::{InitParams, LocalState, StorageInfo, StorageKind};
use crate::services::{config_migration, runtime, storage};
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
pub fn suspend_hotkeys(app: AppHandle, suspended: bool) -> Result<(), AppError> {
    crate::services::hotkeys::set_suspended(&app, suspended)
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

#[tauri::command]
pub fn open_main_chat(app: AppHandle, text: Option<String>) -> Result<(), AppError> {
    runtime::open_main_chat(&app, text)
}

#[tauri::command]
pub fn open_main_editor(
    app: AppHandle,
    text: Option<String>,
    source_text: Option<String>,
) -> Result<(), AppError> {
    runtime::open_main_editor(&app, text, source_text)
}

/// Off the main thread, as are the other commands that write files: a write
/// waits for the disk.
#[tauri::command(async)]
pub fn save_user_config(
    app: AppHandle,
    state: State<'_, AppState>,
    mut user_config: Value,
) -> Result<(), AppError> {
    if !user_config.is_object() {
        return Err(AppError::Message(String::from(
            "The user config must be an object",
        )));
    }
    let _guard = state.lock_config_storage();
    // the stored config came from a newer build; whatever the webview sends,
    // it is not written over
    if config_migration::is_newer_than_supported(&state.params().user_config) {
        return Err(storage::newer_config_error());
    }
    // a config sent without its version would be migrated again at the next
    // start
    if config_migration::config_version(&user_config) == 0 {
        config_migration::stamp_current_version(&mut user_config);
    }
    storage::save_user_config(&app, &user_config)?;
    let previous_config = state.params().user_config;
    {
        let mut memory = state.lock_history_storage();
        // the config is saved already; history that could not follow the new
        // settings yet does at the next start
        if let Err(error) = storage::apply_history_settings_change(
            &app,
            &previous_config,
            &user_config,
            &mut memory,
        ) {
            log::error!("Could not apply the history settings: {error}");
        }
        state.update_params(|params| {
            params.user_config = user_config;
        });
    }
    runtime::emit_params(&app, &state)?;

    Ok(())
}

#[tauri::command(async)]
pub fn get_storage_info(app: AppHandle) -> Result<StorageInfo, AppError> {
    storage::get_storage_info(&app)
}

/// Takes the kind, not a path: the webview only opens the app's own
/// directories.
#[tauri::command(async)]
pub fn open_storage_location(app: AppHandle, kind: StorageKind) -> Result<(), AppError> {
    crate::services::platform::open_dir(&storage::storage_dir(&app, kind)?)
}

#[tauri::command]
pub fn mark_activation_metric(app: AppHandle, id: u64, mark: String) {
    crate::services::activation_metrics::mark_from_frontend(&app, id, &mark);
}

#[tauri::command]
pub fn submit_activation_metric_value(app: AppHandle, id: u64, value: String) {
    crate::services::activation_metrics::submit_value(&app, id, value);
}
/// Merges `patch` into the stored local state. Merging here rather than in
/// a window keeps concurrent patches, also from both windows, from undoing
/// each other.
#[tauri::command(async)]
pub fn patch_local_state(
    app: AppHandle,
    state: State<'_, AppState>,
    patch: serde_json::Map<String, Value>,
) -> Result<LocalState, AppError> {
    let _guard = state.lock_config_storage();
    let local_state = storage::merge_local_state(&state.params().local_state, patch)?;
    storage::save_local_state(&app, &local_state)?;
    state.update_params(|params| {
        params.local_state = local_state.clone();
    });
    runtime::emit_params(&app, &state)?;

    Ok(local_state)
}

#[tauri::command]
pub fn activate_mode(app: AppHandle, mode: String, text: Option<String>) -> Result<(), AppError> {
    let parsed_mode = crate::services::activation::StartMode::parse(&mode)?;
    let mut activation = crate::services::activation::Activation::new(
        parsed_mode,
        crate::services::activation::ActivationSource::Ui,
    );
    activation.selected_text = text;
    runtime::activate(&app, activation)
}

#[cfg(test)]
mod tests {
    use crate::services::activation::StartMode;

    #[test]
    fn parses_valid_and_invalid_modes() {
        assert_eq!(StartMode::parse("write").unwrap(), StartMode::Write);
        assert_eq!(StartMode::parse("aiTasks").unwrap(), StartMode::AiTasks);
        assert_eq!(StartMode::parse("voice").unwrap(), StartMode::Voice);
        assert_eq!(StartMode::parse("select").unwrap(), StartMode::Select);
        assert!(StartMode::parse("invalidMode").is_err());
    }
}
