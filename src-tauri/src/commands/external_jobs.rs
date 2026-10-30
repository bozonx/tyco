use super::run_blocking;
use crate::{
    errors::AppError,
    services::external::{
        access::AccessDecision,
        api::{self, JobCompletion},
        command_library::{self, ToolCatalogEntry, ToolCatalogState},
    },
};
use tauri::{AppHandle, State};
use tyco_activation_protocol::Job as ExternalJob;

#[tauri::command]
pub fn set_tool_catalog(state: State<'_, ToolCatalogState>, tools: Vec<ToolCatalogEntry>) {
    state.set(command_library::catalog_from(tools));
}

#[tauri::command]
pub fn claim_external_job(app: AppHandle, window: tauri::WebviewWindow, id: String) -> bool {
    api::claim_for_window(&app, window.label(), &id)
}

#[tauri::command]
pub async fn answer_external_access(
    app: AppHandle,
    window: tauri::WebviewWindow,
    job_id: String,
    decision: AccessDecision,
) -> Result<(), AppError> {
    let label = window.label().to_owned();
    run_blocking(move || api::answer_access_for_window(&app, &label, &job_id, decision)).await?
}

#[tauri::command]
pub async fn finish_external_job(
    app: AppHandle,
    window: tauri::WebviewWindow,
    id: String,
    completion: JobCompletion,
) -> Result<Option<ExternalJob>, AppError> {
    let label = window.label().to_owned();
    run_blocking(move || api::finish_for_window(&app, &label, &id, completion)).await?
}
