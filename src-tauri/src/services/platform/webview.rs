use tauri::WebviewWindow;

use crate::errors::AppError;

/// WebKitGTK rejects `navigator.clipboard.read()` and `readText()` with
/// `NotAllowedError` unless the page may access the clipboard, so the editor's
/// "Paste" menu items and Ctrl+Shift+V could not read it. The webview only
/// runs the bundled app.
#[cfg(target_os = "linux")]
pub fn allow_clipboard_read(window: &WebviewWindow) -> Result<(), AppError> {
    use webkit2gtk::{SettingsExt, WebViewExt};

    window.with_webview(|webview| {
        if let Some(settings) = webview.inner().settings() {
            settings.set_javascript_can_access_clipboard(true);
        }
    })?;
    Ok(())
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub fn allow_clipboard_read(_window: &WebviewWindow) -> Result<(), AppError> {
    Ok(())
}
