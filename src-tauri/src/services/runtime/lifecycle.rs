//! Creation and shutdown of application-owned runtime services.
use super::tray::setup_tray;
use super::warmup::spawn_quick_warmup;
use super::{ActivationCoordinator, RuntimeWindows, MAIN_WINDOW_LABEL};
use super::{PanelKeyboardMode, PanelLayerState, QUICK_WINDOW_LABEL};
use crate::errors::AppError;
use crate::services::background::StoppableService;
use crate::services::custom_actions::ScriptRuns;
use crate::services::net::NetState;
use crate::state::AppState;
use tauri::{App, AppHandle, Manager};

/// Creates the windows of `tauri.conf.json`, which does not create them
/// itself: it cannot know where the webviews keep their storage, and would
/// put a development build's into the user's data directory.
pub fn create_windows(app: &App) -> Result<(), AppError> {
    let paths = crate::services::storage::app_paths::AppPaths::resolve(app.handle())?;
    for config in &app.config().app.windows {
        let mut builder = tauri::WebviewWindowBuilder::from_config(app, config)?;
        if let Some(dir) = paths.webview_dir() {
            builder = builder.data_directory(dir);
        }
        let window = builder.build()?;
        crate::services::platform::allow_clipboard_read(&window)?;
    }
    Ok(())
}

/// The runtime state, which needs neither the config nor a window.
pub fn manage_state(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder
        .manage(super::settings_shutdown::SettingsShutdown::default())
        .manage(ActivationCoordinator::default())
        .manage(crate::services::selection_replace::SelectionRunCoordinator::default())
        .manage(RuntimeWindows::default())
}

pub fn setup(app: &mut App) -> Result<(), AppError> {
    let main_window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| AppError::ServiceUnavailable("Main window not found".into()))?;
    crate::services::platform::enable_titlebar_buttons(&main_window)?;
    let supported = crate::services::platform::is_layer_shell_supported();
    if supported {
        let window = app
            .get_webview_window(QUICK_WINDOW_LABEL)
            .ok_or_else(|| AppError::ServiceUnavailable("Quick window not found".into()))?;
        let handle = app.handle().clone();
        crate::services::platform::attach_panel_surface(&window, move || {
            let snapshot = handle.state::<AppState>().snapshot();
            super::is_quick_window_shown(
                handle.state::<RuntimeWindows>().active_label(),
                snapshot.window.is_window_shown,
            )
        })?;
        log::info!("The quick window is a layer-shell surface");
    } else {
        log::info!("The quick window is a regular window");
    }
    app.manage(PanelLayerState {
        supported,
        keyboard: PanelKeyboardMode::from_env(),
    });
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
    if !app.state::<AppState>().begin_shutdown() {
        return;
    }
    let services = app.state::<crate::services::background::BackgroundServices>();
    let deadline = std::time::Instant::now() + SHUTDOWN_TIMEOUT;
    log::info!("Initiating application graceful shutdown");
    let cleanup_app = app.clone();
    if let Err(error) = services.spawn_thread("selection-shutdown", move |_| {
        crate::services::selection_replace::shutdown(&cleanup_app)
    }) {
        log::warn!("Could not start selection shutdown: {error}");
    }
    // a start that failed halfway may not have managed every service
    let scripts = app.try_state::<ScriptRuns>();
    let net = app.try_state::<NetState>();
    let stoppable: Vec<(&str, &dyn StoppableService)> = [
        Some(("Background service", &*services as &dyn StoppableService)),
        scripts
            .as_ref()
            .map(|scripts| ("Script", &**scripts as &dyn StoppableService)),
        net.as_ref()
            .map(|net| ("Network", &**net as &dyn StoppableService)),
    ]
    .into_iter()
    .flatten()
    .collect();
    let expired = crate::services::background::stop_then_wait(&stoppable, deadline, || {
        if let Some(voice) = app.try_state::<crate::services::voice::session::VoiceSessionState>() {
            crate::services::voice::stop_capture_on_shutdown(&voice, deadline);
        }
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        let portal = tauri::async_runtime::block_on(async {
            tokio::time::timeout(remaining, crate::services::platform::hotkeys::shutdown(app)).await
        });
        if portal.is_err() {
            log::warn!("Hotkey portal shutdown deadline expired");
        }
    });
    for name in expired {
        log::warn!("{name} shutdown deadline expired");
    }
    log::info!("Application service shutdown finished");
}
