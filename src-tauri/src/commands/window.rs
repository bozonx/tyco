use std::process::Command;
use std::time::Duration;
use tauri::{AppHandle, State};

use crate::errors::AppError;
use crate::services::clipboard::{copy_to_clipboard, hide_console_window};
use crate::services::platform::InputRegion;
use crate::services::runtime;
use crate::state::AppState;

#[tauri::command]
pub fn close_window(app: AppHandle) -> Result<(), AppError> {
    runtime::hide_active_window(&app)
}

/// Hides the quick window after it lost focus. Unlike `close_window`, it
/// leaves the main window alone when that one became active meanwhile.
#[tauri::command]
pub fn dismiss_quick_window(app: AppHandle) -> Result<(), AppError> {
    runtime::dismiss_quick_window(&app)
}

#[tauri::command]
pub fn set_quick_input_region(app: AppHandle, region: Option<InputRegion>) -> Result<(), AppError> {
    runtime::set_quick_input_region(&app, region)
}

/// Off the main thread: the opener and the clipboard tools are separate
/// processes, which must not stall the UI.
#[tauri::command(async)]
pub fn open_in_browser_and_close(app: AppHandle, url: String) -> Result<(), AppError> {
    open_url(&url)?;
    runtime::hide_active_window(&app)
}

const FOCUS_RELEASE_TIMEOUT: Duration = Duration::from_millis(300);

/// Async so it runs off the main thread: the GTK loop must be free to unmap
/// the window and let the compositor focus the target window before paste.
#[tauri::command]
pub async fn type_into_window_and_close(
    app: AppHandle,
    state: State<'_, AppState>,
    text: String,
) -> Result<(), AppError> {
    let params = state.params();
    #[cfg(target_os = "linux")]
    let previous_clipboard = crate::services::platform::linux::clipboard_restore::snapshot();
    copy_to_clipboard(&text)?;
    runtime::hide_active_window(&app)?;
    let focus_app = app.clone();
    // waits for the focus change, which must not hold an async worker
    tauri::async_runtime::spawn_blocking(move || {
        runtime::wait_until_unfocused(&focus_app, FOCUS_RELEASE_TIMEOUT);
        crate::services::platform::inject_paste(&params.user_config, params.window_id.as_deref())
    })
    .await
    .map_err(|error| AppError::Message(error.to_string()))?
    .inspect_err(|error| log::error!("Text insertion failed: {error}"))?;
    // after a failure the text stays in the clipboard to be pasted by hand
    #[cfg(target_os = "linux")]
    if let Some(snapshot) = previous_clipboard {
        crate::services::platform::linux::clipboard_restore::restore_later(snapshot, text);
    }
    Ok(())
}

/// Leaves the windows as they are: a command run in the background copies
/// its output while another Tyco window may be in use.
#[tauri::command(async)]
pub fn copy_text(text: String) -> Result<(), AppError> {
    copy_to_clipboard(&text)
}

#[tauri::command(async)]
pub fn put_into_clipboard_and_close(app: AppHandle, text: String) -> Result<(), AppError> {
    copy_to_clipboard(&text)?;
    runtime::hide_active_window(&app)
}

/// Only web pages are opened: the URL comes from the webview, and the system
/// opener would just as well run a local file or another URL handler.
fn web_url(value: &str) -> Result<url::Url, AppError> {
    let url = url::Url::parse(value.trim())
        .map_err(|error| AppError::Message(format!("Invalid URL \"{value}\": {error}")))?;
    match url.scheme() {
        "http" | "https" => Ok(url),
        scheme => Err(AppError::Message(format!(
            "Refusing to open a \"{scheme}:\" URL; only http and https are allowed"
        ))),
    }
}

fn open_url(value: &str) -> Result<(), AppError> {
    let url = web_url(value)?;
    let url = url.as_str();

    if cfg!(target_os = "macos") {
        return run_command("open", &[url]);
    }

    if cfg!(target_os = "windows") {
        // unlike `cmd /C start`, this does not parse `&` and the like in the URL
        return run_command("rundll32", &["url.dll,FileProtocolHandler", url]);
    }

    run_command("xdg-open", &[url])
}

fn run_command(binary: &str, args: &[&str]) -> Result<(), AppError> {
    let mut command = Command::new(binary);
    command.args(args);
    hide_console_window(&mut command);
    let status = command.status()?;

    if !status.success() {
        return Err(AppError::Message(format!(
            "Command `{binary}` failed with status {status}",
        )));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::web_url;

    #[test]
    fn accepts_web_urls_only() {
        assert!(web_url("https://duckduckgo.com/?q=a%20b&hl=en").is_ok());
        assert!(web_url(" http://example.com ").is_ok());
        assert!(web_url("file:///etc/passwd").is_err());
        assert!(web_url("javascript:alert(1)").is_err());
        assert!(web_url("not a url").is_err());
    }
}
