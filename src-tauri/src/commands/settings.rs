use super::run_blocking;
use crate::{
    errors::AppError,
    models::DesktopSnapshot,
    services::{config_version, runtime, storage},
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
    run_blocking(move || save_user_config_blocking(&app, user_config, base_config)).await?
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
    let _guard = state.lock_settings_update();
    // the stored config came from a newer build; whatever the webview sends,
    // it is not written over
    if config_version::is_newer_than_supported(&state.snapshot().settings.user_config) {
        return Err(storage::newer_config_error());
    }
    let mut user_config = crate::services::config_update::merge_config(
        &state.snapshot().settings.user_config,
        &base_config,
        &user_config,
    )?;
    // a config sent without its version would be migrated again at the next
    // start
    if config_version::config_version(&user_config) == 0 {
        config_version::stamp_current_version(&mut user_config);
    }
    crate::services::config_schema::validate_user_config(&user_config)?;
    let mut pending_secrets = Some(crate::services::webhook_secrets::protect_for_save(
        app,
        &mut user_config,
    )?);
    let previous_config = state.snapshot().settings.user_config;
    crate::services::hotkeys::with_config_changes(app, &previous_config, &user_config, || {
        if let Err(error) = storage::save_user_config(app, &user_config) {
            // A parent-directory sync can fail after the rename has succeeded.
            if let Err(rollback_error) = storage::save_user_config(app, &previous_config) {
                pending_secrets.take().unwrap().retain();
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
                pending_secrets.take().unwrap().retain();
                return Err(AppError::Message(format!(
                "Could not apply history settings: {error}; could not restore config: {rollback_error}"
            )));
            }
            return Err(error);
        }
        Ok(())
    })?;
    pending_secrets
        .unwrap()
        .commit(&previous_config, &user_config);
    let snapshot = commit_saved_config(&state, user_config);
    runtime::publish_state(app, &state);

    Ok(snapshot)
}

#[tauri::command]
pub async fn patch_session_state(
    app: AppHandle,
    patch: serde_json::Map<String, Value>,
) -> Result<DesktopSnapshot, AppError> {
    run_blocking(move || {
        let state = app.state::<AppState>();
        let _guard = state.lock_settings_update();
        let session_state = crate::services::session_state::merge_session_state(
            &state.snapshot().settings.session_state,
            patch,
        )?;
        state.update_snapshot(|params| {
            params.settings.session_state = session_state.clone();
        });
        runtime::publish_state(&app, &state);

        Ok(state.snapshot())
    })
    .await?
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

/// Only expose the new config after storage and dependent settings succeed.
fn commit_saved_config(state: &AppState, user_config: Value) -> DesktopSnapshot {
    state.update_snapshot(|snapshot| {
        snapshot.settings.user_config = user_config;
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{default_desktop_snapshot, SessionState};
    use serde_json::json;

    #[test]
    fn saved_config_is_visible_immediately_and_preserved_by_the_next_write() {
        let initial = json!({
            "appLanguage": "auto",
            "aiRules": { "chat": "" }
        });
        let state = AppState::new(default_desktop_snapshot(
            initial.clone(),
            SessionState::default(),
        ));
        let next = json!({
            "appLanguage": "ru_RU",
            "aiRules": { "chat": "Use concise answers" }
        });
        let saved = commit_saved_config(&state, next.clone());
        assert_eq!(saved.settings.user_config, next);
        assert_eq!(saved.revision, 1);
        assert_eq!(state.snapshot().settings.user_config, next);

        // A later write from a stale window must retain the committed language.
        let stale_edit = json!({
            "appLanguage": "auto",
            "aiRules": { "chat": "", "correction": "Preserve style" }
        });
        let merged = crate::services::config_update::merge_config(
            &state.snapshot().settings.user_config,
            &initial,
            &stale_edit,
        )
        .unwrap();
        let saved = commit_saved_config(&state, merged);
        assert_eq!(saved.revision, 2);
        assert_eq!(saved.settings.user_config["appLanguage"], "ru_RU");
        assert_eq!(
            saved.settings.user_config["aiRules"]["chat"],
            "Use concise answers"
        );
        assert_eq!(
            saved.settings.user_config["aiRules"]["correction"],
            "Preserve style"
        );
    }
}
