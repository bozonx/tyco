use super::run_blocking;
use crate::{
    errors::AppError,
    models::user_config,
    services::{
        custom_actions::{self, ScriptExecutionResult, ScriptRequest},
        storage,
    },
    state::AppState,
};
use serde::Deserialize;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptActionRequest {
    /// The saved command to run; its shell command, working directory and
    /// timeout are read from the config, see `user_config::script_command`.
    command_id: String,
    text: String,
    #[serde(rename = "captureOutput")]
    should_capture_output: bool,
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
    let config = app.state::<AppState>().user_config();
    let command = user_config::script_command(&config, &request.command_id).ok_or_else(|| {
        AppError::InvalidInput(format!(
            "No saved script command with the id `{}`",
            request.command_id
        ))
    })?;
    run_blocking(move || {
        let log_dir = storage::app_log_dir(&app).ok();
        let tool_config = &command.tool_config;
        custom_actions::execute_script(
            &app.state::<custom_actions::ScriptRuns>(),
            &ScriptRequest {
                name: &command.label,
                command: &tool_config.command,
                working_dir: Some(tool_config.working_directory.as_str())
                    .filter(|dir| !dir.trim().is_empty()),
                text: &request.text,
                should_capture_output: request.should_capture_output,
                output_timeout: tool_config.timeout_sec.map(Duration::from_secs),
                should_log_output: request.should_log_output,
                run_id: request.run_id.as_deref(),
            },
            log_dir.as_deref(),
        )
    })
    .await?
}

#[tauri::command]
pub fn cancel_script_action(runs: State<'_, custom_actions::ScriptRuns>, run_id: String) -> bool {
    runs.cancel(&run_id)
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
    fn script_request_names_a_saved_command_only() {
        let request: ScriptActionRequest = serde_json::from_value(serde_json::json!({
            "commandId": "notes",
            "text": "",
            "captureOutput": true,
            "logOutput": false
        }))
        .unwrap();
        assert_eq!(request.command_id, "notes");
        assert!(
            serde_json::from_value::<ScriptActionRequest>(serde_json::json!({
                "command": "rm -rf ~",
                "text": "",
                "captureOutput": true,
                "logOutput": false
            }))
            .is_err()
        );
    }
}
