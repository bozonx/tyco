use std::collections::BTreeMap;

use tauri::State;

use crate::errors::AppError;
use crate::services::secrets::{SecretStatus, SecretStorage, SecretStore};

/// Which secrets exist and where each may be sent. Never the values.
#[tauri::command]
pub fn secrets_status(secrets: State<'_, SecretStore>) -> BTreeMap<String, SecretStatus> {
    secrets.status()
}

/// Where new keys go, for the settings to warn when it is not the system store.
#[tauri::command]
pub fn secrets_storage(secrets: State<'_, SecretStore>) -> SecretStorage {
    secrets.open()
}

#[tauri::command]
pub fn secrets_set(
    secrets: State<'_, SecretStore>,
    id: String,
    value: String,
    origins: Option<Vec<String>>,
) -> Result<(), AppError> {
    secrets.set(&id, &value, origins)
}

#[tauri::command]
pub fn secrets_remove(secrets: State<'_, SecretStore>, id: String) -> Result<(), AppError> {
    secrets.remove(&id)
}
