//! Platform boundary for global activation and interaction with foreign windows.

mod foreground_context;
mod panel_surface;
mod text_injector;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

pub use foreground_context::{capture_selection, capture_source};
pub use panel_surface::{
    apply_panel_surface, attach_panel_surface, disable_panel_keyboard, panel_surface_supported,
    set_panel_input_region, InputRegion,
};
pub use text_injector::inject_paste;
