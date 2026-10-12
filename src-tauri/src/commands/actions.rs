use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, State};

use super::blocking;
use crate::errors::AppError;
use crate::services::custom_actions::{
    self, CommandRunRecord, ScriptExecutionResult, ScriptRequest,
};
use crate::services::external_commands::{self, ToolCatalogEntry};
use crate::services::storage;
use crate::state::AppState;

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
    /// How long the output is waited for, in seconds.
    timeout_sec: Option<u64>,
    log_output: bool,
    /// Lets `cancel_script_action` stop the command.
    run_id: Option<String>,
}

/// Waits for the command, up to an hour, on the blocking pool.
#[tauri::command]
pub async fn execute_script_action(
    app: AppHandle,
    request: ScriptActionRequest,
) -> Result<ScriptExecutionResult, AppError> {
    blocking(move || {
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

/// Stops a command started with `run_id` that is still waited for.
#[tauri::command]
pub fn cancel_script_action(run_id: String) -> bool {
    custom_actions::cancel_script(&run_id)
}

/// A script file picked by the user, as a shell command that runs it. The
/// dialog waits for the user, so it waits on the blocking pool.
#[tauri::command]
pub async fn pick_script_file(app: AppHandle) -> Result<Option<String>, AppError> {
    blocking(move || custom_actions::pick_script_file(&app)).await
}

#[tauri::command]
pub async fn pick_directory(app: AppHandle) -> Result<Option<String>, AppError> {
    blocking(move || custom_actions::pick_directory(&app)).await
}

#[tauri::command]
pub async fn log_custom_action(
    app: AppHandle,
    name: String,
    action_type: String,
    details: String,
) -> Result<(), AppError> {
    blocking(move || {
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
    blocking(move || {
        if let Ok(log_dir) = storage::app_log_dir(&app) {
            if let Err(error) = custom_actions::log_command_run(&log_dir, &record) {
                log::warn!("Could not log the command run: {error}");
            }
        }
    })
    .await
}

/// Opens `actions.log` in the text viewer of the desktop; `false` while no
/// command has been logged yet.
#[tauri::command]
pub async fn open_action_log(app: AppHandle) -> Result<bool, AppError> {
    blocking(move || {
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

/// The tools of the webview registry, sent by the quick window whenever the
/// plugins load; external calls check the commands against it.
#[tauri::command]
pub fn set_tool_catalog(state: State<'_, AppState>, tools: Vec<ToolCatalogEntry>) {
    state.set_tool_catalog(external_commands::catalog_from(tools));
}

/// Only the always-present quick window executes external jobs.
#[tauri::command]
pub fn claim_external_job(app: AppHandle, window: tauri::WebviewWindow, id: String) -> bool {
    window.label() == crate::services::runtime::QUICK_WINDOW_LABEL
        && crate::services::external_api::claim(&app, &id)
}

/// The answer of the access prompt; only the quick window shows it. Async:
/// it waits for the focus to go back to the window of the selection.
#[tauri::command]
pub async fn answer_external_access(
    app: AppHandle,
    window: tauri::WebviewWindow,
    job_id: String,
    decision: crate::services::external_access::AccessDecision,
) -> Result<(), AppError> {
    if window.label() != crate::services::runtime::QUICK_WINDOW_LABEL {
        return Err(AppError::Message(String::from(
            "Only the quick window answers access requests",
        )));
    }
    tauri::async_runtime::spawn_blocking(move || {
        crate::services::external_access::answer(&app, &job_id, decision)
    })
    .await
    .map_err(|error| AppError::Message(error.to_string()))?
}

/// Completing may paste over the selection and wait for the focus, so it runs
/// on the blocking pool.
#[tauri::command]
pub async fn finish_external_job(
    app: AppHandle,
    window: tauri::WebviewWindow,
    id: String,
    completion: crate::services::external_api::JobCompletion,
) -> Result<Option<tyco_activation_protocol::Job>, AppError> {
    if window.label() != crate::services::runtime::QUICK_WINDOW_LABEL {
        return Ok(None);
    }
    blocking(move || {
        crate::services::external_api::complete(&app, &id, completion);
        use tauri::Manager;
        app.state::<crate::services::external_jobs::ExternalJobs>()
            .get(&id)
    })
    .await
}
