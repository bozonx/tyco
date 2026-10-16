//! The file tools of profile chats. The webview names a profile and a path
//! the model gave; the folders and the permissions are read here, anew for
//! every call, since the user may change them by hand meanwhile.

use std::path::PathBuf;
use tauri::{AppHandle, State};

use super::run_blocking;
use crate::{
    errors::AppError,
    services::ai_tools::files::{
        FileChangePreview, FileRoot, FileToolOutput, FileToolRequest, ProfileFiles,
    },
    services::ai_vault,
    state::AppState,
};

pub const AI_UPLOAD_PROFILE_HEADER: &str = "x-ai-upload-profile";
pub const AI_UPLOAD_NAME_HEADER: &str = "x-ai-upload-name";

fn vault_dir(app: &AppHandle, state: &AppState) -> Result<PathBuf, AppError> {
    ai_vault::resolve_vault_path(app, &state.snapshot().settings.user_config)
}

/// The folders the profile's file tools reach, with its permissions to each.
#[tauri::command]
pub async fn list_ai_file_roots(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<Vec<FileRoot>, AppError> {
    let dir = vault_dir(&app, &state)?;
    run_blocking(move || Ok(ProfileFiles::load(&dir, &profile_id)?.roots().to_vec())).await?
}

#[tauri::command]
pub async fn run_ai_file_tool(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    request: FileToolRequest,
) -> Result<FileToolOutput, AppError> {
    let dir = vault_dir(&app, &state)?;
    run_blocking(move || ProfileFiles::load(&dir, &profile_id)?.run(request)).await?
}

/// What a write or an edit would change, for the user to decide on.
#[tauri::command]
pub async fn preview_ai_file_change(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    request: FileToolRequest,
) -> Result<FileChangePreview, AppError> {
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
    request: tauri::ipc::Request<'_>,
) -> Result<String, AppError> {
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(|value| percent_encoding::percent_decode_str(value).decode_utf8_lossy())
            .map(|value| value.into_owned())
    };
    let profile_id = header(AI_UPLOAD_PROFILE_HEADER)
        .ok_or_else(|| AppError::InvalidInput("Missing upload profile".into()))?;
    let name = header(AI_UPLOAD_NAME_HEADER).unwrap_or_default();
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::InvalidInput("Expected a raw binary body".into()));
    };
    let bytes = bytes.clone();
    let dir = vault_dir(&app, &state)?;
    run_blocking(move || ProfileFiles::load(&dir, &profile_id)?.save_upload(&name, &bytes)).await?
}
