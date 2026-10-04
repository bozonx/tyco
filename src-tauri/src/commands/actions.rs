use tauri::AppHandle;

use crate::errors::AppError;
use crate::services::custom_actions::{self, ScriptExecutionResult, ScriptRequest};
use crate::services::storage;

#[tauri::command(async)]
pub fn execute_script_action(
    app: AppHandle,
    name: String,
    command: String,
    working_dir: Option<String>,
    text: String,
    capture_output: bool,
    log_output: bool,
) -> Result<ScriptExecutionResult, AppError> {
    let log_dir = storage::app_log_dir(&app).ok();
    custom_actions::execute_script(
        &ScriptRequest {
            name: &name,
            command: &command,
            working_dir: working_dir.as_deref(),
            text: &text,
            capture_output,
            log_output,
        },
        log_dir.as_deref(),
    )
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
