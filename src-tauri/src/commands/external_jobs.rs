use super::run_blocking;
use crate::{
    errors::AppError,
    services::external::command_library::{self, ToolCatalogEntry, ToolCatalogState},
};
use tauri::{AppHandle, State};
use tyco_activation_protocol::Job as ExternalJob;
#[tauri::command]
pub fn set_tool_catalog(state: State<'_, ToolCatalogState>, tools: Vec<ToolCatalogEntry>) {
    state.set(command_library::catalog_from(tools));
}

#[tauri::command]
pub fn claim_external_job(app: AppHandle, window: tauri::WebviewWindow, id: String) -> bool {
    window.label() == crate::services::runtime::QUICK_WINDOW_LABEL
        && crate::services::external::api::claim(&app, &id)
}

#[tauri::command]
pub async fn answer_external_access(
    app: AppHandle,
    window: tauri::WebviewWindow,
    job_id: String,
    decision: crate::services::external::access::AccessDecision,
) -> Result<(), AppError> {
    if window.label() != crate::services::runtime::QUICK_WINDOW_LABEL {
        return Err(AppError::InvalidInput(String::from(
            "Only the quick window answers access requests",
        )));
    }
    super::run_blocking(move || crate::services::external::access::answer(&app, &job_id, decision))
        .await?
}

#[tauri::command]
pub async fn finish_external_job(
    app: AppHandle,
    window: tauri::WebviewWindow,
    id: String,
    completion: crate::services::external::api::JobCompletion,
) -> Result<Option<ExternalJob>, AppError> {
    if window.label() != crate::services::runtime::QUICK_WINDOW_LABEL {
        return Ok(None);
    }
    run_blocking(move || {
        crate::services::external::api::complete(&app, &id, completion);
        use tauri::Manager;
        app.state::<crate::services::external::jobs::ExternalJobs>()
            .get(&id)
    })
    .await
}
