use super::blocking;
use crate::{
    errors::AppError,
    models::DesktopSnapshot,
    services::{config_migration, runtime, storage},
    state::AppState,
};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};
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
    blocking(move || save_user_config_blocking(&app, user_config, base_config)).await?
}

fn save_user_config_blocking(
    app: &AppHandle,
    user_config: Value,
    base_config: Value,
) -> Result<DesktopSnapshot, AppError> {
    if !user_config.is_object() {
        return Err(AppError::InvalidInput(String::from(
            "The user config must be an object",
        )));
    }
    let state = app.state::<AppState>();
    let _guard = state.lock_config_storage();
    // the stored config came from a newer build; whatever the webview sends,
    // it is not written over
    if config_migration::is_newer_than_supported(&state.snapshot().settings.user_config) {
        return Err(storage::newer_config_error());
    }
    let mut user_config = crate::services::config_update::merge_config(
        &state.snapshot().settings.user_config,
        &base_config,
        &user_config,
    )?;
    // a config sent without its version would be migrated again at the next
    // start
    if config_migration::config_version(&user_config) == 0 {
        config_migration::stamp_current_version(&mut user_config);
    }
    crate::services::config_schema::validate_user_config(&user_config)?;
    let pending_secrets =
        crate::services::webhook_secrets::protect_for_save(app, &mut user_config)?;
    let previous_config = state.snapshot().settings.user_config;
    if let Err(error) = storage::save_user_config(app, &user_config) {
        // A parent-directory sync can fail after the rename has succeeded.
        if let Err(rollback_error) = storage::save_user_config(app, &previous_config) {
            pending_secrets.retain();
            return Err(AppError::Message(format!(
                "Could not save config: {error}; could not restore config: {rollback_error}"
            )));
        }
        return Err(error);
    }
    if let Err(error) = state
        .history
        .apply_settings(app, &previous_config, &user_config)
    {
        if let Err(rollback_error) = storage::save_user_config(app, &previous_config) {
            pending_secrets.retain();
            return Err(AppError::Message(format!(
                "Could not apply history settings: {error}; could not restore config: {rollback_error}"
            )));
        }
        return Err(error);
    }
    pending_secrets.commit(&previous_config, &user_config);
    runtime::publish_state(app, &state);

    Ok(state.snapshot())
}

#[tauri::command]
pub async fn patch_session_state(
    app: AppHandle,
    patch: serde_json::Map<String, Value>,
) -> Result<DesktopSnapshot, AppError> {
    blocking(move || {
        let state = app.state::<AppState>();
        let _guard = state.lock_config_storage();
        let session_state = crate::services::session_state::merge_session_state(
            &state.snapshot().settings.session_state,
            patch,
        )?;
        state.update_state(|params| {
            params.settings.session_state = session_state.clone();
        });
        runtime::publish_state(&app, &state);

        Ok(state.snapshot())
    })
    .await?
}
