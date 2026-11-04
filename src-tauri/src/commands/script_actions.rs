use super::run_blocking;
use crate::{
    errors::AppError,
    models::ScriptActionRequest,
    services::{
        custom_actions::{self, SavedScriptRun, ScriptExecutionResult},
        storage,
    },
    state::AppState,
};
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub async fn execute_script_action(
    app: AppHandle,
    request: ScriptActionRequest,
) -> Result<ScriptExecutionResult, AppError> {
    run_blocking(move || {
        let config = app.state::<AppState>().user_config();
        let log_dir = storage::app_log_dir(&app).ok();
        let variables = storage::variable_values(&app, &config);
        custom_actions::execute_saved_script(
            &app.state::<custom_actions::ScriptRuns>(),
            &config,
            &variables,
            &SavedScriptRun {
                command_id: &request.command_id,
                text: &request.text,
                selection_text: request.selection_text.as_deref(),
                should_capture_output: request.should_capture_output,
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

/// A file the user picks, as its path, e.g. the value of a variable.
#[tauri::command]
pub async fn pick_file(app: AppHandle) -> Result<Option<String>, AppError> {
    run_blocking(move || custom_actions::pick_file(&app)).await
}
