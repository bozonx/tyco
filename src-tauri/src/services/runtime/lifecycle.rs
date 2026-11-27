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
/// put a development build's into the user's data directory. The subtitles
/// window waits until it is first shown.
pub fn create_windows(app: &App) -> Result<(), AppError> {
    for config in &app.config().app.windows {
        if config.label == super::subtitles_window::SUBTITLES_WINDOW_LABEL {
            continue;
        }
        let window = window_builder(app.handle(), config)?.build()?;
        crate::services::platform::allow_clipboard_read(&window)?;
    }
    Ok(())
}

/// A window of `tauri.conf.json` with the storage of the app's webviews.
pub(super) fn window_builder<'a>(
    app: &'a AppHandle,
    config: &tauri::utils::config::WindowConfig,
) -> Result<tauri::WebviewWindowBuilder<'a, tauri::Wry, AppHandle>, AppError> {
    let paths = crate::services::storage::app_paths::AppPaths::resolve(app)?;
    let mut builder = tauri::WebviewWindowBuilder::from_config(app, config)?;
    if let Some(dir) = paths.webview_dir() {
        builder = builder.data_directory(dir);
    }
    Ok(builder)
}

/// The runtime state, which needs neither the config nor a window.
pub fn manage_state(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder
        .manage(super::settings_shutdown::SettingsShutdown::default())
        .manage(ActivationCoordinator::default())
        .manage(crate::services::selection_replace::SelectionRunCoordinator::default())
        .manage(RuntimeWindows::default())
        .manage(std::sync::Arc::new(
            crate::services::platform::notifications::NotificationService::default(),
        ))
        .manage(super::screenshot::ScreenshotCropCoordinator::default())
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
    app.state::<AppState>().update_snapshot(|snapshot| {
        snapshot.window.can_move_overlay = super::can_move_overlay(supported);
    });
    spawn_listen_probe(app.handle().clone())?;
    #[cfg(target_os = "linux")]
    if let Err(error) = setup_tray(app) {
        log::warn!("Could not register the tray icon: {error}");
    }
    #[cfg(not(target_os = "linux"))]
    setup_tray(app)?;
    #[cfg(target_os = "linux")]
    crate::services::status_overlay::quiet::probe_tray_host(app.handle());
    spawn_quick_warmup(app.handle().clone())?;
    Ok(())
}

/// Asks the sound server whether the computer sound can be recorded off the
/// UI thread: connecting to it may take a moment.
fn spawn_listen_probe(app: AppHandle) -> Result<(), AppError> {
    let handle = app.clone();
    app.state::<crate::services::background::BackgroundServices>()
        .spawn_thread("listening-capabilities", move |stop| {
            let app = handle;
            while !stop.is_stopped() {
                let can_listen = crate::services::platform::audio::can_capture_playback();
                let can_listen_to_apps =
                    can_listen && crate::services::platform::audio::can_capture_apps();
                if stop.is_stopped() {
                    break;
                }
                let state = app.state::<AppState>();
                let snapshot = state.snapshot();
                if snapshot.window.can_listen != can_listen
                    || snapshot.window.can_listen_to_apps != can_listen_to_apps
                {
                    state.update_snapshot(|snapshot| {
                        snapshot.window.can_listen = can_listen;
                        snapshot.window.can_listen_to_apps = can_listen_to_apps;
                    });
                    super::publish_state(&app, &state);
                }
                if stop.wait(std::time::Duration::from_secs(5)) {
                    break;
                }
            }
        })
}

const SHUTDOWN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);

/// Drain services off the UI thread so queued window operations can complete.
pub fn request_exit(app: &AppHandle) {
    end(app, false);
}

/// Shuts down like `request_exit` and starts the app again, e.g. after the
/// user data folder changed: the folders are not switched in a running app.
pub fn request_restart(app: &AppHandle) {
    end(app, true);
}

fn end(app: &AppHandle, restarts: bool) {
    let state = app.state::<AppState>();
    if !state.begin_quitting() {
        return;
    }
    let handle = app.clone();
    let result = std::thread::Builder::new()
        .name("application-shutdown".into())
        .spawn(move || {
            shutdown(&handle);
            if restarts {
                handle.restart();
            }
            handle.exit(0);
        });
    if let Err(error) = result {
        log::error!("Could not start shutdown coordinator: {error}");
        app.exit(0);
    }
}

/// Cancellation is issued to every service before any bounded wait begins.
pub fn shutdown(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    if !state.begin_shutdown() {
        return;
    }
    let services = app.try_state::<crate::services::background::BackgroundServices>();
    let deadline = std::time::Instant::now() + SHUTDOWN_TIMEOUT;
    log::info!("Initiating application graceful shutdown");
    crate::services::external::api::cancel_quiet_on_shutdown(app);
    if let Some(services) = services.as_ref() {
        let cleanup_app = app.clone();
        if let Err(error) = services.spawn_thread("selection-shutdown", move |_| {
            crate::services::selection_replace::shutdown(&cleanup_app)
        }) {
            log::warn!("Could not start selection shutdown: {error}");
        }
    }
    // a start that failed halfway may not have managed every service
    let scripts = app.try_state::<ScriptRuns>();
    let net = app.try_state::<NetState>();
    let notifications = app
        .try_state::<std::sync::Arc<crate::services::platform::notifications::NotificationService>>(
        );
    let watches = app.try_state::<crate::services::voice::apps::AudioAppsWatches>();
    let hotkey_queue = app.try_state::<crate::services::hotkeys::HotkeyQueue>();
    let stoppable: Vec<(&str, &dyn StoppableService)> = [
        notifications
            .as_ref()
            .map(|service| ("Notifications", &***service as &dyn StoppableService)),
        services
            .as_ref()
            .map(|services| ("Background service", &**services as &dyn StoppableService)),
        scripts
            .as_ref()
            .map(|scripts| ("Script", &**scripts as &dyn StoppableService)),
        net.as_ref()
            .map(|net| ("Network", &**net as &dyn StoppableService)),
        watches
            .as_ref()
            .map(|watches| ("Audio apps watch", &**watches as &dyn StoppableService)),
        hotkey_queue
            .as_ref()
            .map(|queue| ("Hotkey queue", &**queue as &dyn StoppableService)),
    ]
    .into_iter()
    .flatten()
    .collect();
    let expired = crate::services::background::stop_then_wait(&stoppable, deadline, || {
        if let Some(voice) = app.try_state::<crate::services::voice::session::VoiceSessionState>() {
            crate::services::voice::stop_capture_on_shutdown(&voice, deadline);
        }
        crate::services::platform::shutdown_session_services();
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
    // nothing of the memory-only histories outlives the run, also no file
    crate::services::storage::clear_session_files(app);
    log::info!("Application service shutdown finished");
}
