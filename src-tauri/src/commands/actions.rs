use tauri::AppHandle;

use crate::errors::AppError;
use crate::services::custom_actions::{self, ScriptExecutionResult};
use crate::services::storage;

#[allow(clippy::too_many_arguments)]
#[tauri::command(async)]
pub fn execute_script_action(
    app: AppHandle,
    name: String,
    execution_type: Option<String>,
    command: String,
    args: Option<String>,
    working_dir: Option<String>,
    text: String,
    log_output: bool,
) -> Result<ScriptExecutionResult, AppError> {
    let log_dir = storage::app_log_dir(&app).ok();
    custom_actions::execute_script(
        &name,
        execution_type.as_deref(),
        &command,
        args.as_deref(),
        working_dir.as_deref(),
        &text,
        log_output,
        log_dir.as_deref(),
    )
}

#[tauri::command(async)]
pub fn pick_script_file() -> Result<Option<String>, AppError> {
    custom_actions::pick_script_file()
}

#[tauri::command(async)]
pub fn pick_directory() -> Result<Option<String>, AppError> {
    custom_actions::pick_directory()
}

#[tauri::command(async)]
pub fn log_custom_action(
    app: AppHandle,
    name: String,
    action_type: String,
    details: String,
) -> Result<(), AppError> {
    if let Ok(log_dir) = storage::app_log_dir(&app) {
        let _ = custom_actions::log_custom_action(&log_dir, &name, &action_type, &details);
    }
    Ok(())
}
