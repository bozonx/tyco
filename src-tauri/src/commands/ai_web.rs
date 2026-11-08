//! The web search and fetch tools of profile chats.

use tauri::{AppHandle, State};

use crate::{
    errors::AppError,
    services::ai_tools::web::{self, AiWebToolOutput, AiWebToolRequest, WebRuns},
    services::ai_vault,
    services::secrets::{with_store, SecretStore},
};

#[tauri::command]
pub async fn run_ai_web_tool(
    app: AppHandle,
    runs: State<'_, WebRuns>,
    profile_id: String,
    request: AiWebToolRequest,
    run_id: Option<String>,
) -> Result<AiWebToolOutput, AppError> {
    let trimmed_id = profile_id.trim();
    if trimmed_id.is_empty() {
        return Err(AppError::InvalidInput("Profile ID cannot be empty".into()));
    }

    ai_vault::with_projects(&app, |dir, _| {
        let profile = ai_vault::get_profile(dir, trimmed_id)?;
        web::ensure_web_enabled(&profile)
    })?;

    let secret = with_store(&app, |store: &SecretStore| {
        store.snapshot().get("web.jina").map(|e| e.value.clone())
    })
    .await?;

    runs.run(run_id.as_deref(), web::run(secret.as_deref(), request))
        .await
}

#[tauri::command]
pub fn cancel_ai_web_tool(runs: State<'_, WebRuns>, run_id: String) -> bool {
    runs.cancel(&run_id)
}
