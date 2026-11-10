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
    profile_id: Option<String>,
    request: AiWebToolRequest,
    run_id: Option<String>,
) -> Result<AiWebToolOutput, AppError> {
    if let Some(profile_id) = profile_id {
        let trimmed_id = profile_id.trim();
        if trimmed_id.is_empty() {
            return Err(AppError::InvalidInput("Profile ID cannot be empty".into()));
        }

        let (vault_id, profile_id) = ai_vault::split_ref(trimmed_id);
        ai_vault::with_vault(&app, vault_id, |dir| {
            let profile = ai_vault::get_profile(dir, profile_id)?;
            web::ensure_web_enabled(&profile)
        })?;
    }

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
