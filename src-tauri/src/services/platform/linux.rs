//! Linux backends. Which one serves a call depends on the session, see
//! `super::session`: X11 has the tools to find, activate and type into any
//! window, while on Wayland only KDE Plasma lets Tyco do that, via KWin scripts.

mod binary_paths;
pub mod clipboard_restore;
pub(crate) mod command;
pub mod dbus;
mod foreground_context;
pub(crate) mod hotkeys_portal;
pub mod kwin;
pub mod layer_shell;
pub mod primary_selection;
pub(crate) mod status_overlay;
pub mod text_injector;
pub mod x11;

use serde_json::Value;

use crate::errors::AppError;
use foreground_context::{ForegroundContext, SystemForegroundContext};

pub fn capture_foreground_target() -> Option<String> {
    SystemForegroundContext::detect().capture_foreground_target()
}

pub async fn capture_selection(target: Option<String>) -> Option<String> {
    SystemForegroundContext::detect()
        .capture_selection(target)
        .await
}

pub fn inject_paste(user_config: &Value, target_window_id: Option<&str>) -> Result<(), AppError> {
    text_injector::SystemTextInjector::detect().inject_paste(user_config, target_window_id)
}

/// How long the first activation waits for the window tracker. It normally
/// reports within a few dozen milliseconds.
const TRACKER_STARTUP_WAIT: std::time::Duration = std::time::Duration::from_millis(800);

pub fn start_session_services(
    app: &tauri::AppHandle,
    on_window_change: fn(&tauri::AppHandle, super::window_tracker::TrackerChange),
) -> Result<(), AppError> {
    use tauri::Manager;

    dbus::spawn_dbus_server(app.clone())?;
    let session = super::session::current();
    let services = app.state::<crate::services::background::BackgroundServices>();
    if session.is_x11() {
        // GTK puts the program name into WM_CLASS
        let own_class = gtk::glib::prgname().unwrap_or_default().to_string();
        let handle = app.clone();
        x11::spawn_tracker(&services, own_class, move |change| {
            on_window_change(&handle, change)
        })?;
    }
    if session.is_wayland() {
        primary_selection::spawn_watcher(&services)?;
    }
    if session.is_x11() || session.is_kde_wayland() {
        super::window_tracker::wait_for_startup(TRACKER_STARTUP_WAIT);
    }
    Ok(())
}

#[cfg(test)]
mod headless_tests;
