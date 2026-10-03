//! Platform boundary for global activation and interaction with foreign windows.
//! Code outside this module asks it rather than checking the OS or the session
//! itself; backends for a single platform live in its submodule.

mod foreground_context;
mod panel_surface;
pub mod session;
mod text_injector;
mod titlebar;
pub mod window_tracker;

#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

pub use foreground_context::{capture_selection, capture_source};
#[cfg(target_os = "linux")]
pub use panel_surface::settle_panel_keyboard;
pub use panel_surface::{
    apply_panel_surface, attach_panel_surface, disable_panel_keyboard, panel_surface_supported,
    set_panel_input_region, InputRegion, PanelKeyboard,
};
pub use text_injector::{check_text_injection, inject_paste};
pub use titlebar::enable_titlebar_buttons;
