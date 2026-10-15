#[cfg(test)]
mod tests;

pub mod operations;
pub mod types;

pub use operations::*;
pub use types::*;

use serde_json::Value;
use std::path::PathBuf;
use tauri::AppHandle;

use crate::errors::AppError;
use crate::services::atomic_file::create_private_dir;
use crate::services::storage::app_data_sub_dir;

/// Resolves the vault root directory given an optional configured path string and a fallback directory provider.
pub fn resolve_vault_path_from_config(
    configured_path: Option<&str>,
    fallback: impl FnOnce() -> Result<PathBuf, AppError>,
) -> Result<PathBuf, AppError> {
    if let Some(raw) = configured_path.map(str::trim).filter(|s| !s.is_empty()) {
        let path = PathBuf::from(raw);
        if path.is_absolute() && create_private_dir(&path).is_ok() {
            return Ok(path);
        }
    }
    fallback()
}

/// Resolves the AI vault root directory for the application.
/// If `vaultPath` is set in `user_config["aiProfiles"]["vaultPath"]` and is an absolute,
/// writable/creatable path, it is used. Otherwise, it defaults to `app_data_sub_dir(app, "ai-vault")`.
pub fn resolve_vault_path(app: &AppHandle, user_config: &Value) -> Result<PathBuf, AppError> {
    let configured = user_config
        .get("aiProfiles")
        .and_then(|p| p.get("vaultPath"))
        .and_then(Value::as_str);

    resolve_vault_path_from_config(configured, || app_data_sub_dir(app, "ai-vault"))
}
