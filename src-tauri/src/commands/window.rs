use tauri::{AppHandle, WebviewWindow};

use super::run_blocking;
use crate::errors::AppError;
use crate::services::platform::InputRegion;
use crate::services::runtime;

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
pub fn hide_quick_window_on_blur(app: AppHandle, activation_id: u64) -> Result<(), AppError> {
    runtime::hide_quick_window_on_blur(&app, activation_id)
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
    run_blocking(move || {
        super::system::open_url(&url)?;
        runtime::hide_window(&app, window.label().into(), activation_id)
    })
    .await?
}

/// Async so it runs off the main thread: the GTK loop must be free to unmap
/// the window and let the compositor focus the target window before paste.
#[tauri::command]
pub async fn paste_into_target_and_hide(
    app: AppHandle,
    window: WebviewWindow,
    activation_id: u64,
    text: String,
) -> Result<(), AppError> {
    run_blocking(move || {
        runtime::paste_into_target(&app, window.label().into(), activation_id, text)
    })
    .await?
    .inspect_err(|error| log::error!("Text insertion failed: {error}"))
}

#[tauri::command]
pub fn set_tray_menu_labels(
    app: AppHandle,
    show_label: String,
    quit_label: String,
) -> Result<(), AppError> {
    runtime::set_tray_menu_labels(&app, &show_label, &quit_label)
}
