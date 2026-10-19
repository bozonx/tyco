//! The images of chats and the files dropped onto a chat.
//!
//! An image lives in session memory until a chat that shows it is saved. The
//! webview keeps it alive by holding it:
//!
//! - `store_chat_image` and `get_chat` hold what they hand out under an
//!   import id the webview picks, until the next `sync_chat_images` of the
//!   chat lists the images it shows and releases those import ids;
//! - `delete_chat` holds the images of the deleted chat for its undo, until
//!   `release_deleted_chat_images` or a short timeout.

use serde::Deserialize;
use tauri::{AppHandle, Manager, WebviewWindow};
use ts_rs::TS;

use super::run_blocking;
use crate::{
    errors::AppError,
    ipc::BinaryRequest,
    services::{
        chat_images::{ChatImageStore, ChatImages},
        dropped_files::DroppedFiles,
        storage::{self, ChatScope},
    },
};

const MAX_DROPPED_FILE_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(optional_fields = nullable)]
pub struct ChatImageMeta {
    /// Holds the image until a sync of the chat releases it.
    pub import_id: String,
    pub name: Option<String>,
}

/// The holder of the images a window imported under `import_id`.
pub fn import_owner(window: &WebviewWindow, import_id: &str) -> Result<String, AppError> {
    if import_id.is_empty()
        || import_id.len() > 64
        || !import_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err(AppError::InvalidInput("Invalid image import id".into()));
    }
    Ok(format!("{}/import/{import_id}", window.label()))
}

/// The holder of the images of a chat deleted in a window, for its undo.
pub fn deleted_chat_owner(window: &WebviewWindow, chat_id: &str) -> String {
    format!("{}/undo/{chat_id}", window.label())
}

/// The holder of the images a chat of a window shows: "Ask AI" under the
/// window label, a profile chat under a key of its own below it.
fn chat_owner(window: &WebviewWindow, profile_id: Option<&str>) -> Result<String, AppError> {
    match profile_id {
        None => Ok(window.label().to_string()),
        Some(id) => {
            crate::services::ai_vault::validate_id(id)?;
            Ok(format!("{}/profile/{id}", window.label()))
        }
    }
}

/// Normalizes an image the webview sends as the raw body; see the module.
#[tauri::command]
pub async fn store_chat_image(
    window: WebviewWindow,
    app: AppHandle,
    request: BinaryRequest<ChatImageMeta>,
) -> Result<crate::models::ChatImage, AppError> {
    let owner = import_owner(&window, &request.meta.import_id)?;
    run_blocking(move || {
        let (image, encoded) = ChatImageStore::prepare(&request.bytes, request.meta.name)?;
        let images = app.state::<ChatImages>();
        let mut images = images.lock();
        images.remember(image.clone(), encoded)?;
        images.hold(&owner, &image.id);
        Ok(image)
    })
    .await?
}

#[tauri::command]
pub async fn read_chat_image(
    app: AppHandle,
    id: String,
    profile_id: Option<String>,
) -> Result<tauri::ipc::Response, AppError> {
    let scope = ChatScope::from_profile_id(profile_id);
    run_blocking(move || storage::read_chat_image(&app, &scope, &id).map(tauri::ipc::Response::new))
        .await?
}

/// Holds the images the chat shows now and releases the given import ids.
#[tauri::command]
pub async fn sync_chat_images(
    window: WebviewWindow,
    app: AppHandle,
    ids: Vec<String>,
    import_ids: Vec<String>,
    profile_id: Option<String>,
) -> Result<(), AppError> {
    let owner = chat_owner(&window, profile_id.as_deref())?;
    let imports = import_ids
        .iter()
        .map(|import_id| import_owner(&window, import_id))
        .collect::<Result<Vec<_>, _>>()?;
    run_blocking(move || {
        let images = app.state::<ChatImages>();
        let mut images = images.lock();
        images.sync(&owner, &ids)?;
        for import in imports {
            images.release_owner(&import);
        }
        Ok(())
    })
    .await?
}

/// Ends the undo of `delete_chat` for the chat `id`.
#[tauri::command]
pub fn release_deleted_chat_images(window: WebviewWindow, app: AppHandle, id: String) {
    app.state::<ChatImages>()
        .lock()
        .release_owner(&deleted_chat_owner(&window, &id));
}

/// The bytes of a file dropped onto the window, up to a bound. Only the
/// paths of the last drop are read; see `DroppedFiles`.
#[tauri::command]
pub async fn read_dropped_file(
    window: WebviewWindow,
    app: AppHandle,
    path: String,
) -> Result<tauri::ipc::Response, AppError> {
    let path = std::path::PathBuf::from(path);
    if !app
        .state::<DroppedFiles>()
        .was_dropped(window.label(), &path)
    {
        return Err(AppError::InvalidInput(
            "The file was not dropped onto this window".into(),
        ));
    }
    run_blocking(move || read_bounded_file(&path))
        .await?
        .map(tauri::ipc::Response::new)
}

fn read_bounded_file(path: &std::path::Path) -> Result<Vec<u8>, AppError> {
    use std::io::Read;
    let too_large = || AppError::FileTooLarge("File size limit exceeded".into());
    let metadata = std::fs::metadata(path)?;
    if !metadata.is_file() {
        return Err(AppError::InvalidInput("Not a regular file".into()));
    }
    if metadata.len() > MAX_DROPPED_FILE_BYTES {
        return Err(too_large());
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path)?
        .take(MAX_DROPPED_FILE_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_DROPPED_FILE_BYTES {
        return Err(too_large());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::errors::ErrorCode;
    use crate::services::test_support::TestDir;

    #[test]
    fn dropped_files_are_bounded_and_directories_are_rejected() {
        let directory = TestDir::new("tyco-chat-file-test");
        let path = directory.join("sample.txt");
        std::fs::write(&path, b"contents").unwrap();
        assert_eq!(read_bounded_file(&path).unwrap(), b"contents");
        assert!(read_bounded_file(&directory).is_err());
        std::fs::File::create(&path)
            .unwrap()
            .set_len(MAX_DROPPED_FILE_BYTES + 1)
            .unwrap();
        assert_eq!(
            read_bounded_file(&path).unwrap_err().code(),
            ErrorCode::FileTooLarge
        );
    }
}
