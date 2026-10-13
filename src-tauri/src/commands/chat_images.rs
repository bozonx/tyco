use super::blocking;
use crate::{
    errors::AppError,
    services::{
        chat_images::{ChatFileError, ChatFileErrorKind, ChatImageStore},
        storage,
    },
    state::AppState,
};
use tauri::{AppHandle, Manager, WebviewWindow};
pub const CHAT_IMAGE_NAME_HEADER: &str = "x-chat-image-name";
pub const CHAT_IMAGE_LEASE_HEADER: &str = "x-chat-image-lease";
fn chat_images(state: &AppState) -> std::sync::MutexGuard<'_, ChatImageStore> {
    state.chat_images.lock().expect("chat image lock poisoned")
}
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
    blocking(move || storage::get_chat_image(&app, &id).map(tauri::ipc::Response::new)).await?
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
    use crate::services::test_support::TestDir;

    #[test]
    fn dropped_files_are_bounded_and_directories_are_rejected() {
        let directory = TestDir::new("tyco-chat-file-test");
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
    }
}

#[tauri::command]
pub fn release_chat_image_undo(window: WebviewWindow, app: AppHandle, id: String) {
    chat_images(&app.state::<AppState>()).release_owner(&format!("{}/undo/{id}", window.label()));
}
