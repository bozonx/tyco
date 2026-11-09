use tauri::{AppHandle, Manager, WebviewWindow};

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

/// Switches the shown quick window between voice input and listening in
/// place, keeping where the user moved it.
#[tauri::command]
pub fn switch_quick_mode(
    app: AppHandle,
    activation_id: u64,
    mode: crate::services::activation::ActivationMode,
) -> Result<(), AppError> {
    runtime::switch_quick_mode(&app, activation_id, mode)
}

#[tauri::command]
pub fn reveal_quick_window(app: AppHandle, activation_id: u64) -> Result<(), AppError> {
    runtime::reveal_quick_window(&app, activation_id)
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
        crate::services::platform::open_web_page(&url)?;
        runtime::hide_window_without_refocus(&app, window.label().into(), activation_id)
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
    tooltip_label: Option<String>,
) -> Result<(), AppError> {
    runtime::set_tray_menu_labels(&app, &show_label, &quit_label, tooltip_label.as_deref())
}

/// Adds another screenshot while retaining the quick request activation and draft.
#[tauri::command]
pub async fn add_screenshot(
    app: AppHandle,
    activation_id: u64,
) -> Result<Option<crate::models::ChatImage>, AppError> {
    let services = app.state::<crate::services::background::BackgroundServices>();
    let handle = app.clone();
    services
        .run_blocking(move || runtime::screenshot::add(&handle, activation_id))
        .await?
}

#[tauri::command]
pub fn confirm_screenshot_crop(
    app: AppHandle,
    selection_id: u64,
    crop: crate::models::CropRect,
) -> Result<(), AppError> {
    runtime::screenshot::confirm_crop(&app, selection_id, crop)
}

#[tauri::command]
pub fn cancel_screenshot_crop(app: AppHandle, selection_id: u64) -> Result<(), AppError> {
    runtime::screenshot::cancel_crop(&app, selection_id)
}

#[tauri::command]
pub fn remove_screenshot(
    app: AppHandle,
    activation_id: u64,
    image_id: Option<String>,
) -> Result<(), AppError> {
    runtime::screenshot::remove(&app, activation_id, image_id)
}

#[tauri::command]
pub fn open_transferred_chat(
    app: AppHandle,
    transfer: crate::models::ChatTransfer,
    activation_id: u64,
) -> Result<(), AppError> {
    runtime::screenshot::open_chat(&app, transfer, activation_id)
}
