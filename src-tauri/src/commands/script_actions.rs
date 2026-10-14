use super::run_blocking;
use crate::{
    errors::AppError,
    services::{
        custom_actions::{self, ScriptExecutionResult, ScriptRequest},
        storage,
    },
};
use serde::Deserialize;
use std::time::Duration;
use tauri::AppHandle;
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptActionRequest {
    name: String,
    command: String,
    working_dir: Option<String>,
    text: String,
    capture_output: bool,
    /// How long the output is waited for, in seconds.
    timeout_sec: Option<u64>,
    log_output: bool,
    /// Lets `cancel_script_action` stop the command.
    run_id: Option<String>,
}

#[tauri::command]
pub async fn execute_script_action(
    app: AppHandle,
    request: ScriptActionRequest,
) -> Result<ScriptExecutionResult, AppError> {
    run_blocking(move || {
        let log_dir = storage::app_log_dir(&app).ok();
        custom_actions::execute_script(
            &ScriptRequest {
                name: &request.name,
                command: &request.command,
                working_dir: request.working_dir.as_deref(),
                text: &request.text,
                capture_output: request.capture_output,
                output_timeout: request.timeout_sec.map(Duration::from_secs),
                log_output: request.log_output,
                run_id: request.run_id.as_deref(),
            },
            log_dir.as_deref(),
        )
    })
    .await?
}

#[tauri::command]
pub fn cancel_script_action(run_id: String) -> bool {
    custom_actions::cancel_script(&run_id)
}

#[tauri::command]
pub async fn pick_script_file(app: AppHandle) -> Result<Option<String>, AppError> {
    run_blocking(move || custom_actions::pick_script_file(&app)).await
}

#[tauri::command]
pub async fn pick_directory(app: AppHandle) -> Result<Option<String>, AppError> {
    run_blocking(move || custom_actions::pick_directory(&app)).await
}
