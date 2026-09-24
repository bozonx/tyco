use tauri::{PhysicalPosition, Position, WebviewWindow};

#[cfg(target_os = "linux")]
use gtk::prelude::*;

use crate::errors::AppError;
use crate::services::activation::{ActivationIntent, WindowProfile};

pub(crate) trait PanelSurface {
    fn supported(&self) -> bool;
}

struct SystemPanelSurface;

impl PanelSurface for SystemPanelSurface {
    fn supported(&self) -> bool {
        panel_surface_supported_impl()
    }
}

pub fn panel_surface_supported() -> bool {
    SystemPanelSurface.supported()
}

#[cfg(target_os = "linux")]
fn panel_surface_supported_impl() -> bool {
    crate::services::layer_shell::is_supported()
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn panel_surface_supported_impl() -> bool {
    true
}

#[cfg(target_os = "linux")]
pub fn attach_panel_surface(window: &WebviewWindow) -> Result<(), AppError> {
    crate::services::layer_shell::attach(&window.gtk_window()?);
    Ok(())
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub fn attach_panel_surface(_window: &WebviewWindow) -> Result<(), AppError> {
    Ok(())
}

#[cfg(target_os = "linux")]
pub fn disable_panel_keyboard(window: &WebviewWindow) -> Result<(), AppError> {
    crate::services::layer_shell::set_keyboard(&window.gtk_window()?, false);
    Ok(())
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub fn disable_panel_keyboard(_window: &WebviewWindow) -> Result<(), AppError> {
    Ok(())
}

#[cfg(target_os = "linux")]
pub fn apply_panel_surface(
    window: &WebviewWindow,
    profile: WindowProfile,
    intent: ActivationIntent,
    enabled: bool,
) -> Result<(), AppError> {
    if !enabled {
        return position_regular_panel(window, profile);
    }
    let gtk_window = window.gtk_window()?;
    let (width, height) = profile.size();
    // Layer-shell remaps use the default size; resize alone can retain the
    // previous allocation while the surface is hidden.
    gtk_window.set_default_size(width as i32, height as i32);
    gtk_window.resize(width as i32, height as i32);
    match profile {
        WindowProfile::Panel => crate::services::layer_shell::set_panel_profile(&gtk_window, 48),
        WindowProfile::Sheet => {
            let margin_top = window
                .current_monitor()
                .ok()
                .flatten()
                .map(|m| {
                    let scale = m.scale_factor();
                    let screen_h = m.size().height as f64 / scale;
                    ((screen_h - 560.0) / 2.0).max(40.0) as i32
                })
                .unwrap_or(200);
            crate::services::layer_shell::set_sheet_profile(&gtk_window, margin_top);
        }
    }
    crate::services::layer_shell::set_keyboard(
        &gtk_window,
        intent == ActivationIntent::KeyboardFirst,
    );
    gtk_window.queue_resize();
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn apply_panel_surface(
    window: &WebviewWindow,
    profile: WindowProfile,
    intent: ActivationIntent,
    _enabled: bool,
) -> Result<(), AppError> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongW, SetWindowLongW, GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOPMOST,
    };

    let handle = window.hwnd()?.0 as windows_sys::Win32::Foundation::HWND;
    let mut style = unsafe { GetWindowLongW(handle, GWL_EXSTYLE) } as u32;
    style |= WS_EX_TOPMOST;
    if intent == ActivationIntent::ContextFirst {
        style |= WS_EX_NOACTIVATE;
    } else {
        style &= !WS_EX_NOACTIVATE;
    }
    unsafe { SetWindowLongW(handle, GWL_EXSTYLE, style as i32) };
    position_regular_panel(window, profile)
}

#[cfg(target_os = "macos")]
pub fn apply_panel_surface(
    window: &WebviewWindow,
    profile: WindowProfile,
    _intent: ActivationIntent,
    _enabled: bool,
) -> Result<(), AppError> {
    window.set_always_on_top(true)?;
    position_regular_panel(window, profile)?;
    Ok(())
}

fn position_regular_panel(window: &WebviewWindow, profile: WindowProfile) -> Result<(), AppError> {
    let Some(monitor) = window.current_monitor()? else {
        window.center()?;
        return Ok(());
    };

    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let window_size = window.outer_size()?;
    let x =
        monitor_position.x + ((monitor_size.width.saturating_sub(window_size.width)) / 2) as i32;
    let y = match profile {
        WindowProfile::Panel => {
            let bottom_gap = (24.0 * monitor.scale_factor()).round() as i32;
            monitor_position.y + monitor_size.height.saturating_sub(window_size.height) as i32
                - bottom_gap
        }
        WindowProfile::Sheet => {
            monitor_position.y
                + ((monitor_size.height.saturating_sub(window_size.height)) / 2) as i32
        }
    };

    window.set_position(Position::Physical(PhysicalPosition::new(x, y)))?;
    Ok(())
}
