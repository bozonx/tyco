//! The file tools of a conversation. The webview names the profile, if any,
//! the attachments of the conversation by name and id, and a path the model
//! gave; the folders and the permissions are read here, anew for every call,
//! since the user may change them by hand meanwhile. See
//! `dev_docs/chat-files.md`.

use tauri::{AppHandle, Manager};

use super::run_blocking;
use crate::{
    errors::AppError,
    services::ai_tools::files::{
        AiAttachedFile, AiFileChangePreview, AiFileRoot, AiFileToolOutput, AiFileToolRequest,
        Attachments, ConversationFiles,
    },
    services::{ai_vault, chat_images::ChatImages, storage, storage::ChatScope},
};

/// Runs `operation` on what the file tools of the conversation reach.
fn with_conversation_files<T>(
    app: &AppHandle,
    profile_id: Option<String>,
    attached: Vec<AiAttachedFile>,
    operation: impl FnOnce(&ConversationFiles<'_>) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let scope = ChatScope::from_profile_id(profile_id.clone());
    let attachments = if attached.is_empty() {
        Attachments::none()
    } else {
        let files_dir = storage::chat_files_dir(app, &scope)?;
        let images = app.state::<ChatImages>();
        Attachments::new(
            attached,
            Box::new(move |id| images.lock().get_file(&files_dir, id)),
        )?
    };
    match profile_id {
        None => operation(&ConversationFiles::general(attachments)),
        Some(profile_id) => ai_vault::with_projects(app, |dir, paths| {
            operation(&ConversationFiles::load(
                dir,
                paths,
                &profile_id,
                attachments,
            )?)
        }),
    }
}

/// The folders the conversation's file tools reach, with the permissions to each.
#[tauri::command]
pub async fn list_ai_file_roots(
    app: AppHandle,
    profile_id: Option<String>,
    attachments: Vec<AiAttachedFile>,
) -> Result<Vec<AiFileRoot>, AppError> {
    run_blocking(move || {
        with_conversation_files(&app, profile_id, attachments, |files| {
            Ok(files.roots().to_vec())
        })
    })
    .await?
}

#[tauri::command]
pub async fn run_ai_file_tool(
    app: AppHandle,
    profile_id: Option<String>,
    attachments: Vec<AiAttachedFile>,
    request: AiFileToolRequest,
) -> Result<AiFileToolOutput, AppError> {
    run_blocking(move || {
        with_conversation_files(&app, profile_id, attachments, |files| files.run(request))
    })
    .await?
}

/// What a write or an edit would change, for the user to decide on.
#[tauri::command]
pub async fn preview_ai_file_change(
    app: AppHandle,
    profile_id: Option<String>,
    attachments: Vec<AiAttachedFile>,
    request: AiFileToolRequest,
) -> Result<AiFileChangePreview, AppError> {
    run_blocking(move || {
        with_conversation_files(&app, profile_id, attachments, |files| {
            files.preview(request)
        })
    })
    .await?
}

/// The bytes of a document the model reads, for the webview to extract its text.
#[tauri::command]
pub async fn read_ai_file_bytes(
    app: AppHandle,
    profile_id: Option<String>,
    attachments: Vec<AiAttachedFile>,
    path: String,
) -> Result<tauri::ipc::Response, AppError> {
    run_blocking(move || {
        with_conversation_files(&app, profile_id, attachments, |files| {
            files.read_bytes(&path).map(tauri::ipc::Response::new)
        })
    })
    .await?
}

/// Copies a file attached to a chat of the profile into its `workspace/`,
/// where it stays when the chat goes. Returns the path the model reaches it by.
#[tauri::command]
pub async fn save_chat_file_to_workspace(
    app: AppHandle,
    profile_id: String,
    file_id: String,
    name: String,
) -> Result<String, AppError> {
    run_blocking(move || {
        let scope = ChatScope::from_profile_id(Some(profile_id.clone()));
        let bytes = storage::read_chat_file(&app, &scope, &file_id)?;
        ai_vault::with_projects(&app, |dir, _| {
            ConversationFiles::workspace(dir, &profile_id)?.save_copy(&name, &bytes)
        })
    })
    .await?
}
