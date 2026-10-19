//! The file tools of profile chats. The webview names a profile and a path
//! the model gave; the folders and the permissions are read here, anew for
//! every call, since the user may change them by hand meanwhile.

use serde::Deserialize;
use std::path::PathBuf;
use tauri::{AppHandle, State};
use ts_rs::TS;

use super::run_blocking;
use crate::{
    errors::AppError,
    ipc::BinaryRequest,
    services::ai_tools::files::{
        AiFileChangePreview, AiFileRoot, AiFileToolOutput, AiFileToolRequest, ProfileFiles,
    },
    services::ai_vault,
    state::AppState,
};

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AiUploadMeta {
    pub profile_id: String,
    /// The name of the dropped file.
    pub name: String,
}

fn vault_dir(app: &AppHandle, state: &AppState) -> Result<PathBuf, AppError> {
    ai_vault::resolve_vault_path(app, &state.user_config())
}

/// The folders the profile's file tools reach, with its permissions to each.
#[tauri::command]
pub async fn list_ai_file_roots(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<Vec<AiFileRoot>, AppError> {
    let dir = vault_dir(&app, &state)?;
    run_blocking(move || Ok(ProfileFiles::load(&dir, &profile_id)?.roots().to_vec())).await?
}

#[tauri::command]
pub async fn run_ai_file_tool(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    request: AiFileToolRequest,
) -> Result<AiFileToolOutput, AppError> {
    let dir = vault_dir(&app, &state)?;
    run_blocking(move || ProfileFiles::load(&dir, &profile_id)?.run(request)).await?
}

/// What a write or an edit would change, for the user to decide on.
#[tauri::command]
pub async fn preview_ai_file_change(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    request: AiFileToolRequest,
) -> Result<AiFileChangePreview, AppError> {
    let dir = vault_dir(&app, &state)?;
    run_blocking(move || ProfileFiles::load(&dir, &profile_id)?.preview(request)).await?
}

/// The bytes of a document the model reads, for the webview to extract its text.
#[tauri::command]
pub async fn read_ai_file_bytes(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    path: String,
) -> Result<tauri::ipc::Response, AppError> {
    let dir = vault_dir(&app, &state)?;
    run_blocking(move || {
        ProfileFiles::load(&dir, &profile_id)?
            .read_bytes(&path)
            .map(tauri::ipc::Response::new)
    })
    .await?
}

/// Keeps a file dropped into a profile chat in its `workspace/uploads/`; the
/// bytes come as the raw body. Returns the path the model reaches it by.
#[tauri::command]
pub async fn save_ai_upload(
    app: AppHandle,
    state: State<'_, AppState>,
    request: BinaryRequest<AiUploadMeta>,
) -> Result<String, AppError> {
    let dir = vault_dir(&app, &state)?;
    let BinaryRequest { bytes, meta } = request;
    run_blocking(move || {
        ProfileFiles::load(&dir, &meta.profile_id)?.save_upload(&meta.name, &bytes)
    })
    .await?
}
