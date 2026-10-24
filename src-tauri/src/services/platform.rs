//! Platform boundary for global activation and interaction with foreign windows.
//! Code outside this module asks it rather than checking the OS or the session
//! itself; backends for a single platform live in its submodule.

pub(crate) mod audio;
pub(crate) mod clipboard;
mod file_manager;
pub(crate) mod filesystem;
mod foreground_context;
pub(crate) mod hotkeys;
#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
pub mod keychain;
#[cfg(any(target_os = "windows", test))]
mod native_selection;
pub mod notifications;
mod panel_surface;
pub(crate) mod process;
pub(crate) mod selection;
pub mod session;
pub mod shell;
mod shortcut_settings;
mod text_injector;
mod titlebar;
mod webview;
pub mod window_tracker;

#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
pub mod windows;

pub(crate) use clipboard::ClipboardSnapshot;
pub use file_manager::{open_dir, open_file, open_web_url};
pub use foreground_context::{capture_foreground_target, capture_selection, ForegroundTarget};
pub use panel_surface::{
    apply_panel_surface, attach_panel_surface, disable_panel_keyboard, is_layer_shell_supported,
    set_panel_input_region, set_window_opacity, settle_panel_keyboard, InputRegion,
    PanelKeyboardMode,
};
pub use shortcut_settings::{has_shortcut_settings, open_shortcut_settings};
pub use text_injector::check_text_injection;
pub(crate) use text_injector::{SystemTextInjector, TextInjector};
pub use titlebar::enable_titlebar_buttons;
pub use webview::allow_clipboard_read;

/// Shows the status bubble as `request` says, or hides it for `None`; only
/// Linux has one so far. Runs on the main thread.
pub fn update_status_overlay(
    request: Option<crate::services::status_overlay::StatusOverlayRequest>,
) {
    #[cfg(target_os = "linux")]
    linux::status_overlay::update(request);
    #[cfg(not(target_os = "linux"))]
    let _ = request;
}

/// The directory of this user's runtime files that only they can reach,
/// `XDG_RUNTIME_DIR`; `None` where the session has none.
#[cfg(all(unix, feature = "activation-bench"))]
pub fn user_runtime_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("XDG_RUNTIME_DIR").map(std::path::PathBuf::from)
}

/// Starts what follows the desktop session: the D-Bus API, the window
/// tracker and the primary selection watcher on Linux, and waits briefly for
/// the tracker to report the window Tyco was started from. `on_window_change`
/// hears of each window the user turns to or closes.
pub fn start_session_services(
    app: &tauri::AppHandle,
    on_window_change: fn(&tauri::AppHandle, window_tracker::TrackerChange),
) -> Result<(), crate::errors::AppError> {
    #[cfg(target_os = "linux")]
    return linux::start_session_services(app, on_window_change);
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, on_window_change);
        Ok(())
    }
}
