//! Creation and shutdown of application-owned runtime services.
use super::tray::setup_tray;
use super::warmup::spawn_quick_warmup;
use super::{ActivationCoordinator, RuntimeWindows, MAIN_WINDOW_LABEL};
#[cfg(target_os = "linux")]
use super::{LayerShellRuntimeState, PanelKeyboardMode, QUICK_WINDOW_LABEL};
use crate::errors::AppError;
use crate::state::AppState;
use tauri::{App, AppHandle, Manager};

/// Creates the windows of `tauri.conf.json`, which does not create them
/// itself: it cannot know where the webviews keep their storage, and would
/// put a development build's into the user's data directory.
pub fn create_windows(app: &App) -> Result<(), AppError> {
    let paths = crate::services::app_paths::AppPaths::resolve(app.handle())?;
    for config in &app.config().app.windows {
        let mut builder = tauri::WebviewWindowBuilder::from_config(app, config)?;
        if let Some(dir) = paths.webview_dir() {
            builder = builder.data_directory(dir.to_path_buf());
        }
        let window = builder.build()?;
        crate::services::platform::allow_clipboard_read(&window)?;
    }
    Ok(())
}

pub fn setup(app: &mut App) -> Result<(), AppError> {
    app.manage(super::settings_shutdown::SettingsShutdown::default());
    app.manage(ActivationCoordinator::default());
    app.manage(crate::services::selection_replace::SelectionRunCoordinator::default());
    app.manage(RuntimeWindows::default());
    let main_window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| AppError::Message("Main window not found".into()))?;
    crate::services::platform::enable_titlebar_buttons(&main_window)?;
    #[cfg(target_os = "linux")]
    {
        let supported = crate::services::platform::panel_surface_supported();
        if supported {
            let window = app
                .get_webview_window(QUICK_WINDOW_LABEL)
                .ok_or_else(|| AppError::Message("Quick window not found".into()))?;
            crate::services::platform::attach_panel_surface(&window)?;
            log::info!("Using gtk-layer-shell for the quick window");
        } else {
            log::info!("gtk-layer-shell is unavailable; using a regular window");
        }
        app.manage(LayerShellRuntimeState {
            supported,
            keyboard: PanelKeyboardMode::from_env(),
        });
    }
    setup_tray(app)?;
    spawn_quick_warmup(app.handle().clone())?;
    Ok(())
}

const SHUTDOWN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);

/// Drain services off the UI thread so queued window operations can complete.
pub fn request_exit(app: &AppHandle) {
    let state = app.state::<AppState>();
    if !state.begin_quitting() {
        return;
    }
    let handle = app.clone();
    let result = std::thread::Builder::new()
        .name("application-shutdown".into())
        .spawn(move || {
            shutdown(&handle);
            handle.exit(0);
        });
    if let Err(error) = result {
        log::error!("Could not start shutdown coordinator: {error}");
        app.exit(0);
    }
}

/// Cancellation is issued to every service before any bounded wait begins.
pub fn shutdown(app: &AppHandle) {
    let services = app.state::<crate::services::background::BackgroundServices>();
    if !services.begin_shutdown() {
        return;
    }
    app.state::<AppState>().begin_quitting();
    let deadline = std::time::Instant::now() + SHUTDOWN_TIMEOUT;
    log::info!("Initiating application graceful shutdown");
    let cleanup_app = app.clone();
    if let Err(error) = services.spawn_thread("selection-shutdown", move |_| {
        crate::services::selection_replace::shutdown(&cleanup_app)
    }) {
        log::warn!("Could not start selection shutdown: {error}");
    }
    services.stop();
    let scripts = app.state::<crate::services::custom_actions::ScriptRuns>();
    scripts.stop();
    if let Some(net) = app.try_state::<crate::services::net::NetState>() {
        net.close_all();
    }
    if let Some(state) = app.try_state::<AppState>() {
        crate::services::voice::stop_capture_on_shutdown(state.inner(), deadline);
    }
    if let Some(net) = app.try_state::<crate::services::net::NetState>() {
        if !net.wait_until(deadline) {
            log::warn!("Network shutdown deadline expired");
        }
    }
    let remaining = deadline.saturating_duration_since(std::time::Instant::now());
    let portal = tauri::async_runtime::block_on(async {
        tokio::time::timeout(remaining, crate::services::platform::hotkeys::shutdown(app)).await
    });
    if portal.is_err() {
        log::warn!("Hotkey portal shutdown deadline expired");
    }
    if !scripts.wait_until(deadline) {
        log::warn!("Script shutdown deadline expired");
    }
    if !services.wait_until(deadline) {
        log::warn!("Background service shutdown deadline expired");
    }
    log::info!("Application service shutdown finished");
}
