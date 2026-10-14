use super::run_blocking;
use crate::{
    errors::AppError,
    services::{
        custom_actions::{self, CommandRunRecord},
        storage,
    },
};
use tauri::AppHandle;
#[tauri::command]
pub async fn log_custom_action(
    app: AppHandle,
    name: String,
    action_type: String,
    details: String,
) -> Result<(), AppError> {
    run_blocking(move || {
        if let Ok(log_dir) = storage::app_log_dir(&app) {
            if let Err(error) =
                custom_actions::log_custom_action(&log_dir, &name, &action_type, &details)
            {
                log::warn!("Could not log the custom action: {error}");
            }
        }
    })
    .await
}

#[tauri::command]
pub async fn log_command_run(app: AppHandle, record: CommandRunRecord) -> Result<(), AppError> {
    run_blocking(move || {
        if let Ok(log_dir) = storage::app_log_dir(&app) {
            if let Err(error) = custom_actions::log_command_run(&log_dir, &record) {
                log::warn!("Could not log the command run: {error}");
            }
        }
    })
    .await
}

#[tauri::command]
pub async fn open_action_log(app: AppHandle) -> Result<bool, AppError> {
    run_blocking(move || {
        let path = custom_actions::action_log_path(&storage::app_log_dir(&app)?);
        if !path.is_file() {
            return Ok(false);
        }
        crate::services::platform::open_file(&path)?;
        Ok(true)
    })
    .await?
}

#[tauri::command(async)]
pub fn log_client_message(level: String, message: String, context: Option<String>) {
    let sanitized = crate::services::secret_detector::redact_secrets(&message);
    let ctx = context.map(|c| format!("[{c}] ")).unwrap_or_default();
    match level.as_str() {
        "error" => log::error!(target: "desktop_ui", "{ctx}{sanitized}"),
        "warn" => log::warn!(target: "desktop_ui", "{ctx}{sanitized}"),
        "debug" => log::debug!(target: "desktop_ui", "{ctx}{sanitized}"),
        _ => log::info!(target: "desktop_ui", "{ctx}{sanitized}"),
    }
}
