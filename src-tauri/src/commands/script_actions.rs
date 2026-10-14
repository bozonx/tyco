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
    #[serde(rename = "captureOutput")]
    should_capture_output: bool,
    /// How long the output is waited for, in seconds.
    #[serde(rename = "timeoutSec")]
    execution_timeout_secs: Option<u64>,
    #[serde(rename = "logOutput")]
    should_log_output: bool,
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
                should_capture_output: request.should_capture_output,
                output_timeout: request.execution_timeout_secs.map(Duration::from_secs),
                should_log_output: request.should_log_output,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn script_request_preserves_the_timeout_wire_name() {
        let request: ScriptActionRequest = serde_json::from_value(serde_json::json!({
            "name": "Example",
            "command": "echo example",
            "text": "",
            "captureOutput": true,
            "timeoutSec": 45,
            "logOutput": false
        }))
        .unwrap();
        assert_eq!(request.execution_timeout_secs, Some(45));
    }
}
