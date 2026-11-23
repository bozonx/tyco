//! The file tools of a conversation. The webview names where the call comes
//! from (see `ToolCallContext`),
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
    services::ai_tools::permissions::ToolCallContext,
    services::{ai_vault, chat_images::ChatImages, storage, storage::ChatScope},
    state::AppState,
};

/// Runs `operation` on what the file tools of the conversation reach.
fn with_conversation_files<T>(
    app: &AppHandle,
    context: ToolCallContext,
    attached: Vec<AiAttachedFile>,
    operation: impl FnOnce(&ConversationFiles<'_>) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let profile_id = context.profile_id().map(str::to_owned);
    let config = app.state::<AppState>().user_config();
    // an AI command has no conversation, and so no attachments nor folders
    let attached = match context {
        ToolCallContext::AiCommand { .. } => Vec::new(),
        _ => attached,
    };
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
        None => operation(&ConversationFiles::general(attachments).with_config(config)),
        // a profile reaches the projects and files of its own vault only
        Some(profile_id) => {
            let (vault_id, profile_id) = ai_vault::split_ref(&profile_id);
            // the folders and permissions are read under the vault lock; the
            // tool itself, which may read or search much, runs without it
            ai_vault::with_projects_then(
                app,
                vault_id,
                |dir, paths| {
                    ConversationFiles::load(dir, paths, profile_id, attachments)
                        .map(|files| files.with_config(config))
                },
                |files| operation(&files),
            )
        }
    }
}

/// The folders the conversation's file tools reach, with the permissions to each.
#[tauri::command]
pub async fn list_ai_file_roots(
    app: AppHandle,
    context: ToolCallContext,
    attachments: Vec<AiAttachedFile>,
) -> Result<Vec<AiFileRoot>, AppError> {
    run_blocking(move || {
        with_conversation_files(&app, context, attachments, |files| {
            Ok(files.roots().to_vec())
        })
    })
    .await?
}

#[tauri::command]
pub async fn run_ai_file_tool(
    app: AppHandle,
    context: ToolCallContext,
    attachments: Vec<AiAttachedFile>,
    request: AiFileToolRequest,
    preview: Option<AiFileChangePreview>,
) -> Result<AiFileToolOutput, AppError> {
    run_blocking(move || {
        with_conversation_files(&app, context, attachments, |files| {
            files.run_reviewed(request, preview)
        })
    })
    .await?
}

/// What a write or an edit would change, for the user to decide on.
#[tauri::command]
pub async fn preview_ai_file_change(
    app: AppHandle,
    context: ToolCallContext,
    attachments: Vec<AiAttachedFile>,
    request: AiFileToolRequest,
) -> Result<AiFileChangePreview, AppError> {
    run_blocking(move || {
        with_conversation_files(&app, context, attachments, |files| files.preview(request))
    })
    .await?
}

/// The bytes of a document the model reads, for the webview to extract its text.
#[tauri::command]
pub async fn read_ai_file_bytes(
    app: AppHandle,
    context: ToolCallContext,
    attachments: Vec<AiAttachedFile>,
    path: String,
) -> Result<tauri::ipc::Response, AppError> {
    run_blocking(move || {
        with_conversation_files(&app, context, attachments, |files| {
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
        let (vault_id, profile_id) = ai_vault::split_ref(&profile_id);
        ai_vault::with_vault(&app, vault_id, |dir| {
            ConversationFiles::workspace(dir, profile_id)?.save_copy(&name, &bytes)
        })
    })
    .await?
}
