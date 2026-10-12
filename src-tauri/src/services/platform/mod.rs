//! Platform boundary for global activation and interaction with foreign windows.
//! Code outside this module asks it rather than checking the OS or the session
//! itself; backends for a single platform live in its submodule.

pub(crate) mod audio;
mod file_manager;
mod foreground_context;
#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
pub mod keychain;
mod panel_surface;
pub(crate) mod selection;
pub mod session;
pub mod shell;
mod shortcut_settings;
mod text_injector;
mod titlebar;
pub mod window_tracker;

#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
pub mod windows;
#[cfg(target_os = "windows")]
#[path = "windows-clipboard.rs"]
pub mod windows_clipboard;

pub use file_manager::{open_dir, open_file};
pub use foreground_context::{capture_selection, capture_source};
#[cfg(target_os = "linux")]
pub use panel_surface::settle_panel_keyboard;
pub use panel_surface::{
    apply_panel_surface, attach_panel_surface, disable_panel_keyboard, panel_surface_supported,
    set_panel_input_region, InputRegion, PanelKeyboard,
};
pub use shortcut_settings::{has_shortcut_settings, open_shortcut_settings};
pub use text_injector::check_text_injection;
pub(crate) use text_injector::{paste_after_focus, SystemTextInjector};
pub use titlebar::enable_titlebar_buttons;
