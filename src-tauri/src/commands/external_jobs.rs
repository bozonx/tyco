use super::run_blocking;
use crate::{
    errors::AppError,
    services::external::{
        access::AccessDecision,
        api::{self, JobCompletion},
        command_library::{self, OperationCatalogEntry, OperationCatalogState},
    },
};
use tauri::{AppHandle, State};
use tyco_activation_protocol::Job as ExternalJob;

/// Only the quick window, which runs external jobs, describes their tools.
#[tauri::command]
pub fn set_operation_catalog(
    state: State<'_, OperationCatalogState>,
    window: tauri::WebviewWindow,
    tools: Vec<OperationCatalogEntry>,
) -> Result<(), AppError> {
    if !api::is_job_window(window.label()) {
        return Err(AppError::InvalidInput(
            "Only the quick window sets the operation catalog".into(),
        ));
    }
    state.set(command_library::catalog_from(tools));
    Ok(())
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
