//! What the webview asks of the system rather than of a window.

use tauri::{AppHandle, Manager};

use super::run_blocking;
use crate::errors::AppError;
use crate::services::platform::clipboard::copy_for_user;
use crate::services::platform::open_web_page;
use crate::services::status_overlay::{self, StatusOverlayRequest};

/// Leaves the windows as they are: a command run in the background copies
/// its output while another Tyco window may be in use.
#[tauri::command]
pub async fn copy_text(text: String) -> Result<(), AppError> {
    run_blocking(move || copy_for_user(&text)).await?
}

/// Starts the app again, e.g. to look for a data folder that was missing.
#[tauri::command]
pub fn restart_app(app: AppHandle) {
    crate::services::runtime::request_restart(&app);
}

/// Opens a chat citation without hiding the conversation.
#[tauri::command]
pub async fn open_in_browser(url: String) -> Result<(), AppError> {
    run_blocking(move || open_web_page(&url)).await?
}

#[tauri::command]
pub async fn show_desktop_notification(
    app: AppHandle,
    summary: String,
    body: String,
) -> Result<(), AppError> {
    let service = app
        .state::<std::sync::Arc<crate::services::platform::notifications::NotificationService>>()
        .inner()
        .clone();
    run_blocking(move || service.notify(&summary, &body)).await?
}

/// Shows the status bubble as `request` says, or hides it for `None`.
#[tauri::command]
pub fn show_status_overlay(
    app: AppHandle,
    request: Option<StatusOverlayRequest>,
) -> Result<(), AppError> {
    status_overlay::update(&app, request)
}
