use tauri::{AppHandle, Manager, WebviewWindow};

use super::blocking;
use crate::errors::AppError;
use crate::models::{ChatHistoryItem, EditorHistoryEntry, EditorHistoryItem};
use crate::services::chat_images::{ChatFileError, ChatFileErrorKind, ChatImageStore};
use crate::services::storage;
use crate::state::AppState;

// Every command here reads or writes files under a lock, so all of them run on
// the blocking pool, see `blocking`.

fn chat_images(state: &AppState) -> std::sync::MutexGuard<'_, ChatImageStore> {
    state.chat_images.lock().expect("chat image lock poisoned")
}

#[tauri::command]
pub async fn get_editor_history(app: AppHandle) -> Result<Vec<EditorHistoryItem>, AppError> {
    blocking(move || {
        let state = app.state::<AppState>();
        let mut memory = state.lock_history_storage();
        let params = state.params();
        storage::get_editor_history(&app, &params.user_config, &mut memory)
    })
    .await?
}

#[tauri::command]
pub async fn get_chat_history(app: AppHandle) -> Result<Vec<ChatHistoryItem>, AppError> {
    blocking(move || {
        let state = app.state::<AppState>();
        let _guard = state.lock_history_storage();
        storage::get_chat_history(&app)
    })
    .await?
}

#[tauri::command]
pub async fn get_chat(
    window: WebviewWindow,
    app: AppHandle,
    id: String,
    lease: Option<String>,
) -> Result<Option<ChatHistoryItem>, AppError> {
    blocking(move || {
        let state = app.state::<AppState>();
        let _guard = state.lock_history_storage();
        let chat = storage::get_chat(&app, id)?;
        if let Some(chat) = &chat {
            let directory = storage::chat_image_directory(&app)?;
            let mut images = chat_images(&state);
            for image in chat.messages.iter().flat_map(|message| &message.images) {
                // A broken image must not prevent the rest of the chat from opening.
                if let Some(lease) = &lease {
                    images.hold(&format!("{}/import/{lease}", window.label()), &image.id);
                }
                let _ = images.get(&directory, &image.id);
            }
        }
        Ok(chat)
    })
    .await?
}

#[tauri::command]
pub async fn save_editor_history(
    app: AppHandle,
    entry: EditorHistoryEntry,
) -> Result<Option<String>, AppError> {
    blocking(move || {
        let state = app.state::<AppState>();
        let mut memory = state.lock_history_storage();
        let params = state.params();
        storage::save_editor_history(&app, &params.user_config, &mut memory, entry)
    })
    .await?
}

#[tauri::command]
pub async fn set_editor_history_result(
    app: AppHandle,
    id: String,
    result: String,
) -> Result<(), AppError> {
    blocking(move || {
        let state = app.state::<AppState>();
        let mut memory = state.lock_history_storage();
        let params = state.params();
        storage::set_editor_history_result(&app, &params.user_config, &mut memory, id, result)
    })
    .await?
}

#[tauri::command]
pub async fn restore_editor_history_item(
    app: AppHandle,
    item: EditorHistoryItem,
) -> Result<(), AppError> {
    blocking(move || {
        let state = app.state::<AppState>();
        let mut memory = state.lock_history_storage();
        let params = state.params();
        storage::restore_editor_history_item(&app, &params.user_config, &mut memory, item)
    })
    .await?
}

#[tauri::command]
pub async fn save_chat_history(
    app: AppHandle,
    chat_history_item: ChatHistoryItem,
) -> Result<(), AppError> {
    blocking(move || {
        let state = app.state::<AppState>();
        let _guard = state.lock_history_storage();
        let params = state.params();
        storage::save_chat_history(&app, &params.user_config, chat_history_item)
    })
    .await?
}

#[tauri::command]
pub async fn rename_chat(app: AppHandle, id: String, description: String) -> Result<(), AppError> {
    blocking(move || {
        let state = app.state::<AppState>();
        let _guard = state.lock_history_storage();
        storage::rename_chat(&app, id, description)
    })
    .await?
}

#[tauri::command]
pub async fn search_chat_history(app: AppHandle, query: String) -> Result<Vec<String>, AppError> {
    blocking(move || {
        let state = app.state::<AppState>();
        let _guard = state.lock_history_storage();
        storage::search_chat_history(&app, query)
    })
    .await?
}

#[tauri::command]
pub async fn remove_from_editor_history(app: AppHandle, id: String) -> Result<(), AppError> {
    blocking(move || {
        let state = app.state::<AppState>();
        let mut memory = state.lock_history_storage();
        let params = state.params();
        storage::remove_from_editor_history(&app, &params.user_config, &mut memory, id)
    })
    .await?
}

#[tauri::command]
pub async fn remove_from_chat_history(
    window: WebviewWindow,
    app: AppHandle,
    id: String,
) -> Result<(), AppError> {
    blocking(move || {
        let state = app.state::<AppState>();
        let _guard = state.lock_history_storage();
        // the images are kept for the undo; a chat that cannot be read has
        // none to keep, and must still be removable
        match storage::get_chat(&app, id.clone()) {
            Ok(Some(chat)) => {
                let directory = storage::chat_image_directory(&app)?;
                let mut images = chat_images(&state);
                let owner = format!("{}/undo/{id}", window.label());
                for image in chat.messages.iter().flat_map(|message| &message.images) {
                    images.hold_undo(&owner, &image.id);
                    if let Err(error) = images.get(&directory, &image.id) {
                        log::warn!("Could not preserve chat image for undo: {error}");
                    }
                }
            }
            Ok(None) => {}
            Err(error) => log::warn!("Removing chat {id}, which cannot be read: {error}"),
        }
        storage::remove_from_chat_history(&app, id)
    })
    .await?
}

#[tauri::command]
pub async fn clear_editor_history(app: AppHandle) -> Result<(), AppError> {
    blocking(move || {
        let state = app.state::<AppState>();
        let mut memory = state.lock_history_storage();
        storage::clear_editor_history(&app, &mut memory)
    })
    .await?
}

#[tauri::command]
pub async fn clear_chat_history(app: AppHandle) -> Result<(), AppError> {
    blocking(move || {
        let state = app.state::<AppState>();
        let _guard = state.lock_history_storage();
        storage::clear_chat_history(&app)
    })
    .await?
}

pub const CHAT_IMAGE_NAME_HEADER: &str = "x-chat-image-name";
pub const CHAT_IMAGE_LEASE_HEADER: &str = "x-chat-image-lease";

/// Receives a scaled PNG as the raw IPC body and keeps it as a WebP; drafts
/// never touch the filesystem. The image is encoded before the store is
/// locked: encoding takes a while, and closing a window waits for the lock.
#[tauri::command]
pub async fn store_chat_image(
    window: WebviewWindow,
    app: AppHandle,
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
    let name = header(CHAT_IMAGE_NAME_HEADER);
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(ChatFileError::new(
            ChatFileErrorKind::Invalid,
            "Expected a raw binary body",
        ));
    };
    let bytes = bytes.clone();
    blocking(move || {
        let (image, encoded) = ChatImageStore::prepare(&bytes, name)?;
        let state = app.state::<AppState>();
        let mut images = chat_images(&state);
        images.remember(image.clone(), encoded)?;
        images.hold(&format!("{}/import/{lease}", window.label()), &image.id);
        Ok(image)
    })
    .await
    .map_err(|error| ChatFileError::new(ChatFileErrorKind::Invalid, &error.to_string()))?
}

#[tauri::command]
pub async fn get_chat_image(app: AppHandle, id: String) -> Result<tauri::ipc::Response, AppError> {
    blocking(move || {
        let state = app.state::<AppState>();
        let _guard = state.lock_history_storage();
        let bytes = chat_images(&state).get(&storage::chat_image_directory(&app)?, &id)?;
        Ok(tauri::ipc::Response::new(bytes))
    })
    .await?
}

#[tauri::command]
pub async fn sync_chat_images(
    window: WebviewWindow,
    app: AppHandle,
    ids: Vec<String>,
    leases: Vec<String>,
) -> Result<(), AppError> {
    blocking(move || {
        let state = app.state::<AppState>();
        let mut images = chat_images(&state);
        images.sync(window.label(), &ids)?;
        for lease in leases {
            images.release_owner(&format!("{}/import/{lease}", window.label()));
        }
        Ok(())
    })
    .await?
}

/// Only bounded bytes are returned; a dropped path is never used as a webview URL.
#[tauri::command]
pub async fn read_chat_file(path: String) -> Result<tauri::ipc::Response, ChatFileError> {
    blocking(move || read_chat_file_bytes(std::path::Path::new(&path)))
        .await
        .map_err(|error| ChatFileError::new(ChatFileErrorKind::Invalid, &error.to_string()))?
        .map(tauri::ipc::Response::new)
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

#[tauri::command]
pub fn release_chat_image_undo(window: WebviewWindow, app: AppHandle, id: String) {
    chat_images(&app.state::<AppState>()).release_owner(&format!("{}/undo/{id}", window.label()));
}
