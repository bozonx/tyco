//! Creation and shutdown of application-owned runtime services.
use super::tray::setup_tray;
use super::warmup::spawn_quick_warmup;
use super::{ActivationCoordinator, RuntimeWindows, MAIN_WINDOW_LABEL};
#[cfg(target_os = "linux")]
use super::{LayerShell, PanelKeyboardMode, QUICK_WINDOW_LABEL};
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
        app.manage(LayerShell {
            supported,
            keyboard: PanelKeyboardMode::from_env(),
        });
    }
    setup_tray(app)?;
    spawn_quick_warmup(app.handle().clone());
    Ok(())
}

/// Gracefully shuts down background services, cancel active runs, and clean up trackers.
pub fn shutdown(app: &AppHandle) {
    log::info!("Initiating application graceful shutdown");
    crate::services::custom_actions::cancel_all_scripts();
    if let Some(state) = app.try_state::<AppState>() {
        crate::services::voice::stop_capture_on_shutdown(state.inner());
    }
    if let Some(net) = app.try_state::<crate::services::net::NetState>() {
        net.close_all();
    }
    #[cfg(target_os = "linux")]
    crate::services::platform::linux::kwin::stop_tracker();
    log::info!("Graceful shutdown complete");
}
