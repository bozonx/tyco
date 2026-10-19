#[cfg(test)]
mod tests;

pub mod operations;
pub mod types;

pub use operations::*;
pub use types::*;

use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

use crate::errors::AppError;
use crate::services::storage::app_data_sub_dir;

/// Resolves the vault root directory given an optional configured path string and a fallback directory provider.
/// A configured path that cannot be used is an error: falling back would quietly
/// show another, usually empty, vault in its place.
pub fn resolve_vault_path_from_config(
    configured_path: Option<&str>,
    fallback: impl FnOnce() -> Result<PathBuf, AppError>,
) -> Result<PathBuf, AppError> {
    let Some(raw) = configured_path.map(str::trim).filter(|s| !s.is_empty()) else {
        return fallback();
    };
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err(AppError::InvalidInput(format!(
            "The AI vault path is not absolute: {raw}"
        )));
    }
    // The folder is the user's own: its permissions are left as they are.
    fs::create_dir_all(&path).map_err(|error| {
        AppError::Failed(format!("The AI vault folder {raw} is unavailable: {error}"))
    })?;
    Ok(path)
}

/// Resolves the AI vault root directory for the application.
/// If `aiVault.path` is set in the user config, it is used.
/// Otherwise, it defaults to `app_data_sub_dir(app, "ai-vault")`.
pub fn resolve_vault_path(app: &AppHandle, user_config: &Value) -> Result<PathBuf, AppError> {
    let configured = crate::models::user_config::ai_vault(user_config).path;

    resolve_vault_path_from_config(Some(&configured), || app_data_sub_dir(app, "ai-vault"))
}
