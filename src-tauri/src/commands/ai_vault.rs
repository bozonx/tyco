use std::path::PathBuf;
use tauri::{AppHandle, State};

use super::run_blocking;
use crate::{
    errors::AppError,
    services::ai_vault::{
        self,
        relocation::{self, VaultTarget, VaultTargetKind},
        AiProfile, AiProject,
    },
    services::{settings, storage},
    state::AppState,
};

fn vault_dir(app: &AppHandle, state: &AppState) -> Result<PathBuf, AppError> {
    ai_vault::resolve_vault_path(app, &state.user_config())
}

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

/// What the folder the vault may go to holds; `None` is the default folder.
#[tauri::command]
pub async fn inspect_ai_vault_target(
    app: AppHandle,
    state: State<'_, AppState>,
    path: Option<String>,
) -> Result<VaultTarget, AppError> {
    let current = configured_vault_dir(&app, &state)?;
    let (target, is_default) = target_dir(&app, path.as_deref())?;
    run_blocking(move || {
        Ok(VaultTarget {
            contents: relocation::inspect_target(&current, &target)?,
            path: target.to_string_lossy().into_owned(),
            is_default,
        })
    })
    .await?
}

/// Points the vault at another folder, `None` for the default one. With
/// `move_data` the current vault moves there first; the folder must be empty.
/// Without it the folder must be empty or hold a vault already.
#[tauri::command]
pub async fn relocate_ai_vault(
    app: AppHandle,
    state: State<'_, AppState>,
    path: Option<String>,
    move_data: bool,
) -> Result<(), AppError> {
    let current = configured_vault_dir(&app, &state)?;
    let (target, is_default) = target_dir(&app, path.as_deref())?;
    let configured_path = if is_default {
        String::new()
    } else {
        target.to_string_lossy().into_owned()
    };
    run_blocking(move || {
        let kind = relocation::inspect_target(&current, &target)?;
        let moves = match kind {
            VaultTargetKind::Current => false,
            VaultTargetKind::Empty => move_data,
            VaultTargetKind::Vault { .. } if !move_data => false,
            _ => {
                return Err(AppError::InvalidInput(format!(
                    "The AI vault cannot go to {}",
                    target.display()
                )))
            }
        };
        // the settings save takes the chat lock itself: the move holds it alone
        if moves {
            storage::while_chats_locked(&app, || relocation::move_vault(&current, &target))?;
        }
        let saved = settings::update_user_config(&app, |config| {
            config["aiVault"] = serde_json::json!({ "path": configured_path });
        });
        if let Err(error) = saved {
            if moves {
                let back =
                    storage::while_chats_locked(&app, || relocation::move_vault(&target, &current));
                if let Err(back) = back {
                    log::error!("Could not move the AI vault back: {back}");
                }
            }
            return Err(error);
        }
        Ok(())
    })
    .await?
}

#[tauri::command]
pub fn get_ai_vault_path(app: AppHandle, state: State<'_, AppState>) -> Result<String, AppError> {
    let vault_dir = vault_dir(&app, &state)?;
    Ok(vault_dir.to_string_lossy().into_owned())
}

/// Shows the vault, or one profile folder in it, in the file manager. The
/// path is built here: the webview never names a folder to open.
#[tauri::command]
pub async fn open_ai_vault_location(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: Option<String>,
) -> Result<(), AppError> {
    let dir = vault_dir(&app, &state)?;
    run_blocking(move || {
        let target = ai_vault::vault_dir_to_open(&dir, profile_id.as_deref())?;
        crate::services::platform::open_dir(&target)
    })
    .await?
}

#[tauri::command]
pub async fn list_ai_profiles(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<AiProfile>, AppError> {
    let dir = vault_dir(&app, &state)?;
    run_blocking(move || ai_vault::list_profiles(&dir)).await?
}

#[tauri::command]
pub async fn get_ai_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<AiProfile, AppError> {
    let dir = vault_dir(&app, &state)?;
    run_blocking(move || ai_vault::get_profile(&dir, &id)).await?
}

#[tauri::command]
pub async fn create_ai_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: AiProfile,
    soul: String,
) -> Result<(), AppError> {
    let dir = vault_dir(&app, &state)?;
    run_blocking(move || ai_vault::create_profile(&dir, profile, &soul)).await?
}

#[tauri::command]
pub async fn save_ai_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: AiProfile,
) -> Result<(), AppError> {
    let dir = vault_dir(&app, &state)?;
    run_blocking(move || ai_vault::save_profile(&dir, profile)).await?
}

/// The profile goes with its chats, so no chat of it is being written meanwhile.
#[tauri::command]
pub async fn delete_ai_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), AppError> {
    let dir = vault_dir(&app, &state)?;
    run_blocking(move || storage::while_chats_locked(&app, || ai_vault::delete_profile(&dir, &id)))
        .await?
}

#[tauri::command]
pub async fn read_ai_profile_soul(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<String, AppError> {
    let dir = vault_dir(&app, &state)?;
    run_blocking(move || ai_vault::read_profile_soul(&dir, &id)).await?
}

#[tauri::command]
pub async fn write_ai_profile_soul(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    content: String,
) -> Result<(), AppError> {
    let dir = vault_dir(&app, &state)?;
    run_blocking(move || ai_vault::write_profile_soul(&dir, &id, &content)).await?
}

#[tauri::command]
pub async fn list_ai_projects(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<AiProject>, AppError> {
    let dir = vault_dir(&app, &state)?;
    run_blocking(move || ai_vault::list_projects(&dir)).await?
}

#[tauri::command]
pub async fn create_ai_project(
    app: AppHandle,
    state: State<'_, AppState>,
    project: AiProject,
) -> Result<(), AppError> {
    let dir = vault_dir(&app, &state)?;
    run_blocking(move || ai_vault::create_project(&dir, project)).await?
}

#[tauri::command]
pub async fn save_ai_project(
    app: AppHandle,
    state: State<'_, AppState>,
    project: AiProject,
) -> Result<(), AppError> {
    let dir = vault_dir(&app, &state)?;
    run_blocking(move || ai_vault::save_project(&dir, project)).await?
}

#[tauri::command]
pub async fn delete_ai_project(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), AppError> {
    let dir = vault_dir(&app, &state)?;
    run_blocking(move || ai_vault::delete_project(&dir, &id)).await?
}
