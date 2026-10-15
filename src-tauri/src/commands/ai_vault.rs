use std::path::PathBuf;
use tauri::{AppHandle, State};

use super::run_blocking;
use crate::{errors::AppError, services::ai_vault, state::AppState};

#[tauri::command]
pub fn get_ai_vault_path(app: AppHandle, state: State<'_, AppState>) -> Result<String, AppError> {
    let snapshot = state.snapshot();
    let vault_dir = ai_vault::resolve_vault_path(&app, &snapshot.settings.user_config)?;
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

#[cfg(test)]
mod tests {
    use super::open_folder_in_os;

    #[test]
    fn open_folder_in_os_rejects_non_existent_path() {
        let missing = "/path/that/definitely/does/not/exist/ai_vault_test";
        assert!(tauri::async_runtime::block_on(open_folder_in_os(missing.into())).is_err());
    }
}
