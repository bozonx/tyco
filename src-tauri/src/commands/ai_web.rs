//! The web search and fetch tools of the chats and AI commands.

use tauri::{AppHandle, Manager, State};

use crate::{
    errors::AppError,
    services::ai_tools::permissions::{self, ToolCallContext},
    services::ai_tools::web::{self, AiWebToolOutput, AiWebToolRequest, WebRuns},
    services::ai_vault,
    services::secrets::{with_store, SecretStore},
    state::AppState,
};

#[tauri::command]
pub async fn run_ai_web_tool(
    app: AppHandle,
    runs: State<'_, WebRuns>,
    context: ToolCallContext,
    request: AiWebToolRequest,
    run_id: Option<String>,
) -> Result<AiWebToolOutput, AppError> {
    let config = app.state::<AppState>().user_config();
    let profile = match context.profile_id() {
        Some(profile_id) => {
            let trimmed_id = profile_id.trim();
            if trimmed_id.is_empty() {
                return Err(AppError::InvalidInput("Profile ID cannot be empty".into()));
            }
            let (vault_id, profile_id) = ai_vault::split_ref(trimmed_id);
            Some(ai_vault::with_vault(&app, vault_id, |dir| {
                ai_vault::get_profile(dir, profile_id)
            })?)
        }
        None => None,
    };
    permissions::ensure_web_tool_allowed(&context, request.tool_name(), &config, profile.as_ref())?;

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
