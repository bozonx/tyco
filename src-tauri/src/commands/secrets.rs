use std::collections::BTreeMap;

use tauri::{AppHandle, Manager};

use crate::errors::AppError;
use crate::services::secrets::{with_store, SecretStatus, SecretStore, VaultState};

// Each command may wait for the system keychain, e.g. on an unlock prompt,
// so all of them run off the main thread.

/// Which secrets exist and where each may be sent. Never the values.
#[tauri::command]
pub async fn secrets_status(app: AppHandle) -> Result<BTreeMap<String, SecretStatus>, AppError> {
    with_store(&app, SecretStore::status).await
}

/// Whether keys can be saved, for the settings to warn when they cannot.
#[tauri::command]
pub async fn secrets_vault_state(app: AppHandle) -> Result<VaultState, AppError> {
    with_store(&app, SecretStore::vault_state).await
}

#[tauri::command]
pub async fn secrets_set(
    app: AppHandle,
    id: String,
    value: String,
    origins: Option<Vec<String>>,
) -> Result<(), AppError> {
    with_store(&app, move |secrets| secrets.set(&id, &value, origins)).await?
}

#[tauri::command]
pub async fn secrets_remove(app: AppHandle, id: String) -> Result<(), AppError> {
    let handle = app.clone();
    with_store(&app, move |secrets| {
        let state = handle.state::<crate::state::AppState>();
        let _guard = state.lock_config_storage();
        crate::services::webhook_secrets::ensure_secret_not_referenced(
            &state.snapshot().settings.user_config,
            &id,
        )?;
        secrets.remove(&id)
    })
    .await?
}
