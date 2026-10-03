use crate::errors::AppError;
use crate::services::custom_actions::{self, ScriptExecutionResult};

#[tauri::command(async)]
pub fn execute_script_action(
    name: String,
    command: String,
    text: String,
    log_output: bool,
) -> Result<ScriptExecutionResult, AppError> {
    custom_actions::execute_script(&name, &command, &text, log_output)
}

#[tauri::command(async)]
pub fn pick_script_file() -> Result<Option<String>, AppError> {
    custom_actions::pick_script_file()
}
