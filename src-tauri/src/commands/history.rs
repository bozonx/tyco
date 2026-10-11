use tauri::{AppHandle, State, WebviewWindow};

use crate::errors::AppError;
use crate::models::{ChatHistoryItem, EditorHistoryEntry, EditorHistoryItem};
use crate::services::chat_images::{ChatFileError, ChatFileErrorKind};
use crate::services::storage;
use crate::state::AppState;

#[tauri::command(async)]
pub fn get_editor_history(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<EditorHistoryItem>, AppError> {
    let mut memory = state.lock_history_storage();
    let params = state.params();
    storage::get_editor_history(&app, &params.user_config, &mut memory)
}

#[tauri::command(async)]
pub fn get_chat_history(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<ChatHistoryItem>, AppError> {
    let _guard = state.lock_history_storage();
    storage::get_chat_history(&app)
}

#[tauri::command(async)]
pub fn get_chat(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    lease: Option<String>,
) -> Result<Option<ChatHistoryItem>, AppError> {
    let _guard = state.lock_history_storage();
    let chat = storage::get_chat(&app, id)?;
    if let Some(chat) = &chat {
        let directory = storage::chat_image_directory(&app)?;
        let mut images = state.chat_images.lock().expect("chat image lock poisoned");
        for image in chat.messages.iter().flat_map(|message| &message.images) {
            // A broken image must not prevent the rest of the chat from opening.
            if let Some(lease) = &lease {
                images.hold(&format!("{}/import/{lease}", window.label()), &image.id);
            }
            let _ = images.get(&directory, &image.id);
        }
    }
    Ok(chat)
}

#[tauri::command(async)]
pub fn save_editor_history(
    app: AppHandle,
    state: State<'_, AppState>,
    entry: EditorHistoryEntry,
) -> Result<Option<String>, AppError> {
    let mut memory = state.lock_history_storage();
    let params = state.params();
    storage::save_editor_history(&app, &params.user_config, &mut memory, entry)
}

#[tauri::command(async)]
pub fn set_editor_history_result(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    result: String,
) -> Result<(), AppError> {
    let mut memory = state.lock_history_storage();
    let params = state.params();
    storage::set_editor_history_result(&app, &params.user_config, &mut memory, id, result)
}

#[tauri::command(async)]
pub fn restore_editor_history_item(
    app: AppHandle,
    state: State<'_, AppState>,
    item: EditorHistoryItem,
) -> Result<(), AppError> {
    let mut memory = state.lock_history_storage();
    let params = state.params();
    storage::restore_editor_history_item(&app, &params.user_config, &mut memory, item)
}

#[tauri::command(async)]
pub fn save_chat_history(
    app: AppHandle,
    state: State<'_, AppState>,
    chat_history_item: ChatHistoryItem,
) -> Result<(), AppError> {
    let _guard = state.lock_history_storage();
    let params = state.params();
    storage::save_chat_history(&app, &params.user_config, chat_history_item)
}

#[tauri::command(async)]
pub fn rename_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    description: String,
) -> Result<(), AppError> {
    let _guard = state.lock_history_storage();
    storage::rename_chat(&app, id, description)
}

#[tauri::command(async)]
pub fn search_chat_history(
    app: AppHandle,
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<String>, AppError> {
    let _guard = state.lock_history_storage();
    storage::search_chat_history(&app, query)
}

#[tauri::command(async)]
pub fn remove_from_editor_history(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), AppError> {
    let mut memory = state.lock_history_storage();
    let params = state.params();
    storage::remove_from_editor_history(&app, &params.user_config, &mut memory, id)
}

#[tauri::command(async)]
pub fn remove_from_chat_history(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), AppError> {
    let _guard = state.lock_history_storage();
    if let Some(chat) = storage::get_chat(&app, id.clone())? {
        let directory = storage::chat_image_directory(&app)?;
        let mut images = state.chat_images.lock().expect("chat image lock poisoned");
        let owner = format!("{}/undo/{id}", window.label());
        for image in chat.messages.iter().flat_map(|message| &message.images) {
            images.hold_undo(&owner, &image.id);
            if let Err(error) = images.get(&directory, &image.id) {
                log::warn!("Could not preserve chat image for undo: {error}");
            }
        }
    }
    storage::remove_from_chat_history(&app, id)
}

#[tauri::command(async)]
pub fn clear_editor_history(app: AppHandle, state: State<'_, AppState>) -> Result<(), AppError> {
    let mut memory = state.lock_history_storage();
    storage::clear_editor_history(&app, &mut memory)
}

#[tauri::command(async)]
pub fn clear_chat_history(app: AppHandle, state: State<'_, AppState>) -> Result<(), AppError> {
    let _guard = state.lock_history_storage();
    storage::clear_chat_history(&app)
}

pub const CHAT_IMAGE_NAME_HEADER: &str = "x-chat-image-name";
pub const CHAT_IMAGE_LEASE_HEADER: &str = "x-chat-image-lease";

/// Receives a scaled PNG as the raw IPC body and keeps it as a WebP; drafts
/// never touch the filesystem.
#[tauri::command(async)]
pub fn store_chat_image(
    window: WebviewWindow,
    state: State<'_, AppState>,
    request: tauri::ipc::Request<'_>,
) -> Result<crate::models::ChatImage, ChatFileError> {
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(|value| percent_encoding::percent_decode_str(value).decode_utf8_lossy())
            .map(|value| value.into_owned())
    };
    let lease = header(CHAT_IMAGE_LEASE_HEADER)
        .ok_or_else(|| ChatFileError::new(ChatFileErrorKind::Invalid, "Missing image lease"))?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(ChatFileError::new(
            ChatFileErrorKind::Invalid,
            "Expected a raw binary body",
        ));
    };
    let mut images = state.chat_images.lock().expect("chat image lock poisoned");
    let image = images.insert(bytes, header(CHAT_IMAGE_NAME_HEADER))?;
    images.hold(&format!("{}/import/{lease}", window.label()), &image.id);
    Ok(image)
}

#[tauri::command(async)]
pub fn get_chat_image(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<tauri::ipc::Response, AppError> {
    let _guard = state.lock_history_storage();
    let bytes = state
        .chat_images
        .lock()
        .expect("chat image lock poisoned")
        .get(&storage::chat_image_directory(&app)?, &id)?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command(async)]
pub fn sync_chat_images(
    window: WebviewWindow,
    state: State<'_, AppState>,
    ids: Vec<String>,
    leases: Vec<String>,
) -> Result<(), AppError> {
    let mut images = state.chat_images.lock().expect("chat image lock poisoned");
    images.sync(window.label(), &ids)?;
    for lease in leases {
        images.release_owner(&format!("{}/import/{lease}", window.label()));
    }
    Ok(())
}

/// Only bounded bytes are returned; a dropped path is never used as a webview URL.
#[tauri::command(async)]
pub fn read_chat_file(path: String) -> Result<tauri::ipc::Response, ChatFileError> {
    Ok(tauri::ipc::Response::new(read_chat_file_bytes(
        std::path::Path::new(&path),
    )?))
}

fn read_chat_file_bytes(path: &std::path::Path) -> Result<Vec<u8>, ChatFileError> {
    use std::io::Read;
    const MAX_BYTES: u64 = 10 * 1024 * 1024;
    let unreadable =
        |error: std::io::Error| ChatFileError::new(ChatFileErrorKind::Invalid, &error.to_string());
    let too_large = || ChatFileError::new(ChatFileErrorKind::Size, "File size limit exceeded");
    let metadata = std::fs::metadata(path).map_err(unreadable)?;
    if !metadata.is_file() {
        return Err(ChatFileError::new(
            ChatFileErrorKind::Invalid,
            "Not a regular file",
        ));
    }
    if metadata.len() > MAX_BYTES {
        return Err(too_large());
    }
    let file = std::fs::File::open(path).map_err(unreadable)?;
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(unreadable)?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err(too_large());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dropped_files_are_bounded_and_directories_are_rejected() {
        let directory =
            std::env::temp_dir().join(format!("tyco-chat-file-test-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("sample.txt");
        std::fs::write(&path, b"contents").unwrap();
        assert_eq!(read_chat_file_bytes(&path).unwrap(), b"contents");
        assert!(read_chat_file_bytes(&directory).is_err());
        std::fs::File::create(&path)
            .unwrap()
            .set_len(10 * 1024 * 1024 + 1)
            .unwrap();
        assert_eq!(
            read_chat_file_bytes(&path).unwrap_err().kind,
            ChatFileErrorKind::Size
        );
        std::fs::remove_dir_all(directory).unwrap();
    }
}

#[tauri::command(async)]
pub fn release_chat_image_undo(window: WebviewWindow, state: State<'_, AppState>, id: String) {
    state
        .chat_images
        .lock()
        .expect("chat image lock poisoned")
        .release_owner(&format!("{}/undo/{id}", window.label()));
}
