use std::time::Duration;
use tauri::{AppHandle, State, WebviewWindow};

use super::blocking;
use crate::errors::AppError;
use crate::services::clipboard::copy_to_clipboard;
use crate::services::platform::InputRegion;
use crate::services::runtime;
use crate::state::AppState;

#[tauri::command]
pub fn hide_window(
    app: AppHandle,
    window: WebviewWindow,
    activation_id: u64,
) -> Result<(), AppError> {
    runtime::hide_window(&app, window.label().into(), activation_id)
}

/// Hides the quick window after it lost focus. Unlike `hide_window`, it
/// leaves the main window alone when that one became active meanwhile.
#[tauri::command]
pub fn dismiss_quick_window(app: AppHandle, activation_id: u64) -> Result<(), AppError> {
    runtime::dismiss_quick_window(&app, activation_id)
}

#[tauri::command]
pub fn set_quick_input_region(
    app: AppHandle,
    region: Option<InputRegion>,
    activation_id: u64,
) -> Result<(), AppError> {
    runtime::set_quick_input_region(&app, region, activation_id)
}

/// On the blocking pool: the opener and the clipboard tools are separate
/// processes, which must stall neither the UI nor an async worker.
#[tauri::command]
pub async fn open_in_browser_and_hide(
    app: AppHandle,
    window: WebviewWindow,
    url: String,
    activation_id: u64,
) -> Result<(), AppError> {
    blocking(move || {
        open_url(&url)?;
        runtime::hide_window(&app, window.label().into(), activation_id)
    })
    .await?
}

/// Opens a chat citation without hiding the conversation.
#[tauri::command]
pub async fn open_in_browser(url: String) -> Result<(), AppError> {
    blocking(move || open_url(&url)).await?
}

const FOCUS_RELEASE_TIMEOUT: Duration = Duration::from_millis(300);

/// Async so it runs off the main thread: the GTK loop must be free to unmap
/// the window and let the compositor focus the target window before paste.
#[tauri::command]
pub async fn paste_into_target_and_hide(
    app: AppHandle,
    window: WebviewWindow,
    activation_id: u64,
    state: State<'_, AppState>,
    text: String,
) -> Result<(), AppError> {
    let params = state.snapshot();
    if params.activation.activation_id != activation_id {
        return Err(AppError::InvalidInput(
            "The insertion activation is no longer current".into(),
        ));
    }
    let focus_app = app.clone();
    // The clipboard tools, waiting for focus and insertion must not hold an
    // async worker.
    blocking(move || {
        #[cfg(target_os = "linux")]
        let previous_clipboard = crate::services::platform::linux::clipboard_restore::snapshot();
        runtime::hide_window(&focus_app, window.label().into(), activation_id)?;
        copy_to_clipboard(&text)?;
        if state_activation_changed(&focus_app, activation_id) {
            return Err(AppError::InvalidInput(
                "The insertion activation changed".into(),
            ));
        }
        crate::services::platform::paste_after_focus(
            &ActivationTextInjector {
                app: &focus_app,
                activation_id,
            },
            &params.settings.user_config,
            params.activation.window_id.as_deref(),
            || runtime::wait_until_unfocused(&focus_app, FOCUS_RELEASE_TIMEOUT),
            || {
                #[cfg(target_os = "linux")]
                if let Some(snapshot) = previous_clipboard {
                    crate::services::platform::linux::clipboard_restore::restore_later(
                        snapshot, text,
                    );
                }
            },
        )
    })
    .await?
    .inspect_err(|error| log::error!("Text insertion failed: {error}"))?;
    Ok(())
}

/// Leaves the windows as they are: a command run in the background copies
/// its output while another Tyco window may be in use.
#[tauri::command]
pub async fn copy_text(text: String) -> Result<(), AppError> {
    blocking(move || copy_to_clipboard(&text)).await?
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

fn open_url(value: &str) -> Result<(), AppError> {
    let url = web_url(value)?;
    crate::services::platform::open_web_url(&url)
}

fn state_activation_changed(app: &AppHandle, activation_id: u64) -> bool {
    use tauri::Manager;
    app.state::<AppState>().snapshot().activation.activation_id != activation_id
}

struct ActivationTextInjector<'a> {
    app: &'a AppHandle,
    activation_id: u64,
}

impl crate::services::platform::TextInjector for ActivationTextInjector<'_> {
    fn inject(&self, config: &serde_json::Value, target: Option<&str>) -> Result<(), AppError> {
        if state_activation_changed(self.app, self.activation_id) {
            return Err(AppError::InvalidInput(
                "The insertion activation changed while waiting for focus".into(),
            ));
        }
        crate::services::platform::SystemTextInjector.inject(config, target)
    }
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
        assert!(web_url("file:///etc/passwd").is_err());
        assert!(web_url("javascript:alert(1)").is_err());
        assert!(web_url("not a url").is_err());
    }
}
