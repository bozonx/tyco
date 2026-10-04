use serde::Deserialize;
use tauri::AppHandle;

use crate::errors::AppError;
use crate::services::custom_actions::{
    self, CommandRunRecord, ScriptExecutionResult, ScriptRequest,
};
use crate::services::storage;

/// A command to run, as the webview sends it; see `ScriptActionRequest` in
/// `packages/shared`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptActionRequest {
    name: String,
    command: String,
    working_dir: Option<String>,
    text: String,
    capture_output: bool,
    log_output: bool,
    /// Lets `cancel_script_action` stop the command.
    run_id: Option<String>,
}

#[tauri::command(async)]
pub fn execute_script_action(
    app: AppHandle,
    request: ScriptActionRequest,
) -> Result<ScriptExecutionResult, AppError> {
    let log_dir = storage::app_log_dir(&app).ok();
    custom_actions::execute_script(
        &ScriptRequest {
            name: &request.name,
            command: &request.command,
            working_dir: request.working_dir.as_deref(),
            text: &request.text,
            capture_output: request.capture_output,
            log_output: request.log_output,
            run_id: request.run_id.as_deref(),
        },
        log_dir.as_deref(),
    )
}

/// Stops a command started with `run_id` that is still waited for.
#[tauri::command]
pub fn cancel_script_action(run_id: String) -> bool {
    custom_actions::cancel_script(&run_id)
}

/// A script file picked by the user, as a shell command that runs it.
#[tauri::command(async)]
pub fn pick_script_file(app: AppHandle) -> Option<String> {
    custom_actions::pick_script_file(&app)
}

#[tauri::command(async)]
pub fn pick_directory(app: AppHandle) -> Option<String> {
    custom_actions::pick_directory(&app)
}

#[tauri::command(async)]
pub fn log_custom_action(app: AppHandle, name: String, action_type: String, details: String) {
    if let Ok(log_dir) = storage::app_log_dir(&app) {
        let _ = custom_actions::log_custom_action(&log_dir, &name, &action_type, &details);
    }
}

#[tauri::command(async)]
pub fn log_command_run(app: AppHandle, record: CommandRunRecord) {
    if let Ok(log_dir) = storage::app_log_dir(&app) {
        if let Err(error) = custom_actions::log_command_run(&log_dir, &record) {
            log::warn!("Could not log the command run: {error}");
        }
    }
}
