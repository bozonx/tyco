use std::collections::BTreeMap;

use tauri::{AppHandle, Manager};

use crate::errors::AppError;
use crate::services::secrets::{with_store, SecretStatus, SecretStore, VaultState};

// Each command may wait for the system keychain, e.g. on an unlock prompt,
// so all of them run off the main thread.

/// Which secrets exist and where each may be sent. Never the values.
#[tauri::command]
pub async fn get_secret_statuses(
    app: AppHandle,
) -> Result<BTreeMap<String, SecretStatus>, AppError> {
    with_store(&app, SecretStore::status).await
}

/// Whether keys can be saved, for the settings to warn when they cannot.
#[tauri::command]
pub async fn get_secret_vault_state(app: AppHandle) -> Result<VaultState, AppError> {
    with_store(&app, SecretStore::vault_state).await
}

/// Saves a secret that may be sent only to `origins`.
#[tauri::command]
pub async fn set_secret(
    app: AppHandle,
    id: String,
    value: String,
    origins: Option<Vec<String>>,
) -> Result<(), AppError> {
    with_store(&app, move |secrets| secrets.set(&id, &value, origins)).await?
}

/// Refuses while a saved setting still refers to the secret.
#[tauri::command]
pub async fn delete_secret(app: AppHandle, id: String) -> Result<(), AppError> {
    let handle = app.clone();
    with_store(&app, move |secrets| {
        let state = handle.state::<crate::state::AppState>();
        let _guard = state.lock_settings_update();
        crate::services::secrets::webhook::ensure_secret_not_referenced(&state.user_config(), &id)?;
        secrets.remove(&id)
    })
    .await?
}
