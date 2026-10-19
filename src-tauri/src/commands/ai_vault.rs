use std::path::PathBuf;
use tauri::{AppHandle, State};

use super::run_blocking;
use crate::{
    errors::AppError,
    services::ai_vault::{self, AiProfile, AiProject},
    services::storage,
    state::AppState,
};

fn vault_dir(app: &AppHandle, state: &AppState) -> Result<PathBuf, AppError> {
    ai_vault::resolve_vault_path(app, &state.user_config())
}

#[tauri::command]
pub fn get_ai_vault_path(app: AppHandle, state: State<'_, AppState>) -> Result<String, AppError> {
    let vault_dir = vault_dir(&app, &state)?;
    Ok(vault_dir.to_string_lossy().into_owned())
}

/// Shows the vault, or one profile folder in it, in the file manager. The
/// path is built here: the webview never names a folder to open.
#[tauri::command]
pub async fn open_ai_vault_dir(
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
pub async fn read_profile_soul(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<String, AppError> {
    let dir = vault_dir(&app, &state)?;
    run_blocking(move || ai_vault::read_profile_soul(&dir, &id)).await?
}

#[tauri::command]
pub async fn write_profile_soul(
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
