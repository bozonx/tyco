use std::path::PathBuf;
use tauri::{AppHandle, State};

use super::run_blocking;
use crate::{
    errors::AppError,
    models::{Chat, ChatSummary},
    services::ai_vault::{self, AiProfile, AiProject},
    state::AppState,
};

fn vault_dir(app: &AppHandle, state: &AppState) -> Result<PathBuf, AppError> {
    let snapshot = state.snapshot();
    ai_vault::resolve_vault_path(app, &snapshot.settings.user_config)
}

#[tauri::command]
pub fn get_ai_vault_path(app: AppHandle, state: State<'_, AppState>) -> Result<String, AppError> {
    let vault_dir = vault_dir(&app, &state)?;
    Ok(vault_dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn open_folder_in_os(path: String) -> Result<(), AppError> {
    run_blocking(move || {
        let path_buf = PathBuf::from(&path);
        crate::services::platform::open_dir(&path_buf)
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
pub async fn save_ai_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: AiProfile,
) -> Result<(), AppError> {
    let dir = vault_dir(&app, &state)?;
    run_blocking(move || ai_vault::save_profile(&dir, profile)).await?
}

#[tauri::command]
pub async fn delete_ai_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), AppError> {
    let dir = vault_dir(&app, &state)?;
    run_blocking(move || ai_vault::delete_profile(&dir, &id)).await?
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

#[tauri::command]
pub async fn pick_external_project_folder(app: AppHandle) -> Result<Option<String>, AppError> {
    run_blocking(move || Ok(crate::services::custom_actions::pick_directory(&app))).await?
}

#[tauri::command]
pub async fn list_profile_chats(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<Vec<ChatSummary>, AppError> {
    let dir = vault_dir(&app, &state)?;
    run_blocking(move || ai_vault::list_profile_chats(&dir, &profile_id)).await?
}

#[tauri::command]
pub async fn get_profile_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    id: String,
) -> Result<Option<Chat>, AppError> {
    let dir = vault_dir(&app, &state)?;
    run_blocking(move || ai_vault::get_profile_chat(&dir, &profile_id, &id)).await?
}

#[tauri::command]
pub async fn save_profile_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    chat: Chat,
) -> Result<(), AppError> {
    let dir = vault_dir(&app, &state)?;
    run_blocking(move || ai_vault::save_profile_chat(&dir, &profile_id, chat)).await?
}

#[tauri::command]
pub async fn rename_profile_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    id: String,
    title: String,
) -> Result<(), AppError> {
    let dir = vault_dir(&app, &state)?;
    run_blocking(move || ai_vault::rename_profile_chat(&dir, &profile_id, &id, &title)).await?
}

#[tauri::command]
pub async fn delete_profile_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    id: String,
) -> Result<(), AppError> {
    let dir = vault_dir(&app, &state)?;
    run_blocking(move || ai_vault::delete_profile_chat(&dir, &profile_id, &id)).await?
}

#[tauri::command]
pub async fn clear_profile_chats(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<(), AppError> {
    let dir = vault_dir(&app, &state)?;
    run_blocking(move || ai_vault::clear_profile_chats(&dir, &profile_id)).await?
}

#[tauri::command]
pub async fn search_profile_chats(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    query: String,
) -> Result<Vec<String>, AppError> {
    let dir = vault_dir(&app, &state)?;
    run_blocking(move || ai_vault::search_profile_chats(&dir, &profile_id, &query)).await?
}

#[cfg(test)]
mod tests {
    use super::open_folder_in_os;

    #[test]
    fn open_folder_in_os_rejects_non_existent_path() {
        let missing = "/path/that/definitely/does/not/exist/ai_vault_test";
        assert!(tauri::async_runtime::block_on(open_folder_in_os(missing.into())).is_err());
    }
}
