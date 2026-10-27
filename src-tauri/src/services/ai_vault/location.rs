//! Application boundary for vault location changes.
use super::relocation::{self, VaultTarget};
use crate::services::{settings, storage};
use crate::{errors::AppError, state::AppState};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// The folder the vault is configured to be in, whether it is usable or not.
fn configured_vault_dir(app: &AppHandle, state: &AppState) -> Result<PathBuf, AppError> {
    let configured = crate::models::user_config::ai_vault(&state.user_config()).path;
    match configured.trim() {
        "" => storage::app_data_sub_dir(app, "ai-vault"),
        path => Ok(PathBuf::from(path)),
    }
}

/// A chosen folder, or the default one for `None`, and whether it is the default.
fn target_dir(app: &AppHandle, path: Option<&str>) -> Result<(PathBuf, bool), AppError> {
    let default = storage::app_data_sub_dir(app, "ai-vault")?;
    match path.map(str::trim).filter(|path| !path.is_empty()) {
        Some(path) => {
            let path = PathBuf::from(path);
            let is_default = path == default;
            Ok((path, is_default))
        }
        None => Ok((default, true)),
    }
}

pub fn inspect(app: &AppHandle, path: Option<&str>) -> Result<VaultTarget, AppError> {
    let state = app.state::<AppState>();
    let _access = state.read_vault();
    let (target, is_default) = target_dir(app, path)?;
    let current = configured_vault_dir(app, &state)?;
    Ok(VaultTarget {
        contents: relocation::inspect_target(&current, &target)?,
        path: target.to_string_lossy().into_owned(),
        is_default,
    })
}

pub fn relocate(app: &AppHandle, path: Option<&str>, move_data: bool) -> Result<(), AppError> {
    let state = app.state::<AppState>();
    let _access = state.write_vault();
    let (target, is_default) = target_dir(app, path)?;
    let configured_path = if is_default {
        String::new()
    } else {
        target.to_string_lossy().into_owned()
    };
    let current = configured_vault_dir(app, &state)?;
    relocation::relocate_with(&current, &target, move_data, || {
        let base = state.user_config().as_ref().clone();
        let mut next = base.clone();
        next["aiVault"]["path"] = serde_json::json!(configured_path);
        settings::save_user_config_in_vault(app, next, base).map(|_| ())
    })
}
