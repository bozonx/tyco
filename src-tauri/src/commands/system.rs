//! What the webview asks of the system rather than of a window.

use tauri::AppHandle;

use super::run_blocking;
use crate::errors::AppError;
use crate::services::platform::clipboard::copy_to_clipboard;
use crate::services::status_overlay::{self, StatusOverlayRequest};

/// Leaves the windows as they are: a command run in the background copies
/// its output while another Tyco window may be in use.
#[tauri::command]
pub async fn copy_text(text: String) -> Result<(), AppError> {
    run_blocking(move || copy_to_clipboard(&text)).await?
}

/// Opens a chat citation without hiding the conversation.
#[tauri::command]
pub async fn open_in_browser(url: String) -> Result<(), AppError> {
    run_blocking(move || open_url(&url)).await?
}

#[tauri::command]
pub async fn show_desktop_notification(summary: String, body: String) -> Result<(), AppError> {
    run_blocking(move || crate::services::platform::notifications::notify(&summary, &body)).await?
}

/// Shows the status bubble as `request` says, or hides it for `None`.
#[tauri::command]
pub fn show_status_overlay(
    app: AppHandle,
    request: Option<StatusOverlayRequest>,
) -> Result<(), AppError> {
    status_overlay::update(&app, request)
}

/// Only web pages are opened: the URL comes from the webview, and the system
/// opener would just as well run a local file or another URL handler.
fn web_url(value: &str) -> Result<url::Url, AppError> {
    let url = url::Url::parse(value.trim())
        .map_err(|error| AppError::InvalidInput(format!("Invalid URL \"{value}\": {error}")))?;
    match url.scheme() {
        "http" | "https" => Ok(url),
        scheme => Err(AppError::InvalidInput(format!(
            "Refusing to open a \"{scheme}:\" URL; only http and https are allowed"
        ))),
    }
}

pub(super) fn open_url(value: &str) -> Result<(), AppError> {
    let url = web_url(value)?;
    crate::services::platform::open_web_url(&url)
}

#[cfg(test)]
mod tests {
    use super::{open_in_browser, web_url};

    #[test]
    fn chat_opener_rejects_non_web_urls_without_launching_a_process() {
        for url in ["file:///etc/passwd", "javascript:alert(1)", "not a url"] {
            assert!(tauri::async_runtime::block_on(open_in_browser(url.to_string())).is_err());
        }
    }

    #[test]
    fn accepts_web_urls_only() {
        assert!(web_url("https://duckduckgo.com/?q=a%20b&hl=en").is_ok());
        assert!(web_url(" http://example.com ").is_ok());
        assert!(web_url("http://localhost:8080/path?key=val#hash").is_ok());
        assert!(web_url("file:///etc/passwd").is_err());
        assert!(web_url("javascript:alert(1)").is_err());
        assert!(web_url("data:text/html,<b>hi</b>").is_err());
        assert!(web_url("ftp://example.com/file").is_err());
        assert!(web_url("ws://example.com/socket").is_err());
        assert!(web_url("").is_err());
        assert!(web_url("   ").is_err());
        assert!(web_url("not a url").is_err());
    }
}
