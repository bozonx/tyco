use tauri::{AppHandle, Manager, State, WebviewWindow};

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

#[tauri::command]
pub fn set_tray_recording(
    app: AppHandle,
    is_recording: bool,
    tooltip_label: Option<String>,
) -> Result<(), AppError> {
    runtime::set_tray_recording(&app, is_recording, tooltip_label.as_deref())
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

/// Takes a screenshot for the chat window, holding it until synced under `import_id`.
#[tauri::command]
pub async fn capture_chat_screenshot(
    window: WebviewWindow,
    app: AppHandle,
    import_id: String,
) -> Result<Option<crate::models::ChatImage>, AppError> {
    let services = app.state::<crate::services::background::BackgroundServices>();
    let handle = app.clone();
    let window_label = window.label().to_string();
    services
        .run_blocking(move || {
            runtime::screenshot::capture_for_chat(&handle, &window_label, &import_id)
        })
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
pub fn cancel_screenshot_crop(
    app: AppHandle,
    selection_id: u64,
    close_all: Option<bool>,
) -> Result<(), AppError> {
    runtime::screenshot::cancel_crop(&app, selection_id, close_all.unwrap_or(false))
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

/// Applies the saved sheet placement to the current quick activation.
#[tauri::command]
pub fn reposition_quick_window(app: AppHandle, activation_id: u64) -> Result<(), AppError> {
    runtime::reposition_quick_window(&app, activation_id)
}

/// Shows the subtitles of the dialog over every window, at `geometry` when
/// it was remembered, and minimizes the main window.
#[tauri::command]
pub async fn show_subtitles(
    app: AppHandle,
    geometry: Option<runtime::subtitles_window::WindowGeometry>,
) -> Result<(), AppError> {
    run_blocking(move || {
        let state = app.state::<runtime::subtitles_window::SubtitlesState>();
        let host = runtime::subtitles_window::TauriSubtitlesHost { app: &app };
        runtime::subtitles_window::show(&host, &state, geometry)
    })
    .await?
}

/// Hides the subtitles and gives the main window back; returns where the
/// strip was, to be remembered.
#[tauri::command]
pub async fn hide_subtitles(
    app: AppHandle,
) -> Result<Option<runtime::subtitles_window::WindowGeometry>, AppError> {
    run_blocking(move || {
        let state = app.state::<runtime::subtitles_window::SubtitlesState>();
        let host = runtime::subtitles_window::TauriSubtitlesHost { app: &app };
        runtime::subtitles_window::hide(&host, &state)
    })
    .await?
}

/// What the subtitles show from now on.
#[tauri::command]
pub fn publish_subtitles(
    app: AppHandle,
    view: runtime::subtitles_window::SubtitlesView,
) -> Result<(), AppError> {
    runtime::subtitles_window::publish(&app, view)
}

/// What the subtitles window shows when it loads.
#[tauri::command]
pub fn get_subtitles(
    state: State<'_, runtime::subtitles_window::SubtitlesState>,
) -> runtime::subtitles_window::SubtitlesSnapshot {
    state.snapshot()
}

/// A button of the subtitles, for the main window to do.
#[tauri::command]
pub fn request_subtitles_action(
    app: AppHandle,
    action: runtime::subtitles_window::SubtitlesAction,
) -> Result<(), AppError> {
    runtime::subtitles_window::request_action(&app, action)
}

/// The part of the anchored subtitles that takes the pointer, in logical
/// pixels; `None`: all of it. Clicks elsewhere reach the windows below.
#[tauri::command]
pub fn set_subtitles_input_region(
    window: WebviewWindow,
    region: Option<InputRegion>,
) -> Result<(), AppError> {
    crate::services::platform::set_panel_input_region(&window, region)
}
