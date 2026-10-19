use super::run_blocking;
use crate::{
    errors::AppError,
    services::{
        custom_actions::{self, CommandRunRecord},
        storage,
    },
};
use serde::Deserialize;
use tauri::AppHandle;
use ts_rs::TS;

/// Writes a webhook call of the command `name` to the action log.
#[tauri::command]
pub async fn log_webhook_call(
    app: AppHandle,
    name: String,
    details: String,
) -> Result<(), AppError> {
    run_blocking(move || {
        if let Ok(log_dir) = storage::app_log_dir(&app) {
            if let Err(error) =
                custom_actions::log_custom_action(&log_dir, &name, "webhook", &details)
            {
                log::warn!("Could not log the webhook call: {error}");
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

#[derive(Debug, Clone, Copy, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum ClientLogLevel {
    Error,
    Warn,
    Info,
    Debug,
}

/// Writes a message of the webview to the app log, secrets masked.
#[tauri::command(async)]
pub fn log_client_message(level: ClientLogLevel, message: String, context: Option<String>) {
    let sanitized = crate::services::secrets::detector::redact_secrets(&message);
    let ctx = context.map(|c| format!("[{c}] ")).unwrap_or_default();
    match level {
        ClientLogLevel::Error => log::error!(target: "desktop_ui", "{ctx}{sanitized}"),
        ClientLogLevel::Warn => log::warn!(target: "desktop_ui", "{ctx}{sanitized}"),
        ClientLogLevel::Info => log::info!(target: "desktop_ui", "{ctx}{sanitized}"),
        ClientLogLevel::Debug => log::debug!(target: "desktop_ui", "{ctx}{sanitized}"),
    }
}
