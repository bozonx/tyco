use serde::Deserialize;
use tauri::{PhysicalPosition, Position, WebviewWindow};

#[cfg(target_os = "linux")]
use gtk::prelude::*;

use crate::errors::AppError;
use crate::services::activation::{WindowProfile, WINDOW_SIZE};

/// Part of the window, in logical pixels from its top left corner, that takes
/// pointer input.
#[derive(Clone, Copy, Debug, PartialEq, Deserialize)]
pub struct InputRegion {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl InputRegion {
    /// Whole pixels covering the region: it may grow by a fraction of a
    /// pixel, never shrink, so its edges always stay clickable.
    pub fn to_pixels(self) -> (i32, i32, i32, i32) {
        let left = self.x.floor().max(0.0);
        let top = self.y.floor().max(0.0);
        let right = (self.x + self.width).ceil().max(left);
        let bottom = (self.y + self.height).ceil().max(top);
        (
            left as i32,
            top as i32,
            (right - left) as i32,
            (bottom - top) as i32,
        )
    }
}

const PANEL_KEYBOARD_ENV: &str = "TYCO_PANEL_KEYBOARD";

/// How the layer-shell panel takes the keyboard when it is shown.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum PanelKeyboard {
    /// The compositor decides whether the mapped panel gets the focus.
    #[default]
    OnDemand,
    /// The panel grabs the keyboard when mapped, as in the input-loss lab, and
    /// returns to on-demand once the focus has arrived, so a click elsewhere
    /// still takes the focus away.
    ExclusiveUntilFocused,
}

impl PanelKeyboard {
    pub fn from_env() -> Self {
        let value = std::env::var(PANEL_KEYBOARD_ENV).ok();
        Self::parse(value.as_deref())
    }

    fn parse(value: Option<&str>) -> Self {
        match value.map(str::trim) {
            None | Some("") | Some("on-demand") => Self::OnDemand,
            Some("exclusive-until-focused") => Self::ExclusiveUntilFocused,
            Some(other) => {
                log::warn!("Unknown {PANEL_KEYBOARD_ENV} value `{other}`; using on-demand");
                Self::OnDemand
            }
        }
    }
}

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
    crate::services::platform::linux::layer_shell::is_supported()
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn panel_surface_supported_impl() -> bool {
    true
}

#[cfg(target_os = "linux")]
pub fn attach_panel_surface(window: &WebviewWindow) -> Result<(), AppError> {
    crate::services::platform::linux::layer_shell::attach(&window.gtk_window()?);
    Ok(())
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub fn attach_panel_surface(_window: &WebviewWindow) -> Result<(), AppError> {
    Ok(())
}

#[cfg(target_os = "linux")]
pub fn disable_panel_keyboard(window: &WebviewWindow) -> Result<(), AppError> {
    crate::services::platform::linux::layer_shell::set_keyboard(
        &window.gtk_window()?,
        crate::services::platform::linux::layer_shell::Keyboard::None,
    );
    Ok(())
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub fn disable_panel_keyboard(_window: &WebviewWindow) -> Result<(), AppError> {
    Ok(())
}

/// The shown panel got the focus: an exclusive grab is not needed any more.
#[cfg(target_os = "linux")]
pub fn settle_panel_keyboard(
    window: &WebviewWindow,
    keyboard: PanelKeyboard,
) -> Result<(), AppError> {
    if keyboard == PanelKeyboard::ExclusiveUntilFocused {
        crate::services::platform::linux::layer_shell::set_keyboard(
            &window.gtk_window()?,
            crate::services::platform::linux::layer_shell::Keyboard::OnDemand,
        );
    }
    Ok(())
}

/// Lets pointer input outside `region` through to the windows below; `None`
/// makes the whole window take input again.
#[cfg(target_os = "linux")]
pub fn set_panel_input_region(
    window: &WebviewWindow,
    region: Option<InputRegion>,
) -> Result<(), AppError> {
    let gtk_window = window.gtk_window()?;
    match region {
        Some(region) => {
            let (x, y, width, height) = region.to_pixels();
            let shape = gtk::cairo::Region::create_rectangle(&gtk::cairo::RectangleInt::new(
                x, y, width, height,
            ));
            gtk_window.input_shape_combine_region(Some(&shape));
        }
        None => gtk_window.input_shape_combine_region(None),
    }
    Ok(())
}

// TODO: Windows (SetWindowRgn) and macOS (ignoresMouseEvents by the cursor
// position); until then the transparent area dismisses the panel on a click
#[cfg(any(target_os = "windows", target_os = "macos"))]
pub fn set_panel_input_region(
    _window: &WebviewWindow,
    _region: Option<InputRegion>,
) -> Result<(), AppError> {
    Ok(())
}

#[cfg(target_os = "linux")]
thread_local! {
    /// Geometry last applied to the layer surface. GTK windows live on the main
    /// thread, and so does this value.
    static APPLIED_GEOMETRY: std::cell::Cell<Option<(WindowProfile, i32)>> =
        const { std::cell::Cell::new(None) };
}

#[cfg(target_os = "linux")]
const PANEL_MARGIN_BOTTOM: i32 = 48;

/// Places the quick window before it is shown. `layer` is the keyboard mode of
/// the layer-shell surface, or `None` when the window is a regular one.
#[cfg(target_os = "linux")]
pub fn apply_panel_surface(
    window: &WebviewWindow,
    profile: WindowProfile,
    layer: Option<PanelKeyboard>,
) -> Result<(), AppError> {
    use crate::services::platform::linux::layer_shell::{self, Keyboard};

    let Some(keyboard) = layer else {
        return position_regular_panel(window, profile);
    };
    let gtk_window = window.gtk_window()?;
    let margin = match profile {
        WindowProfile::Panel => PANEL_MARGIN_BOTTOM,
        WindowProfile::Sheet => sheet_margin_top(window),
    };
    // Anchors and size only change with the profile; reapplying them on every
    // show costs a relayout and a configure round trip before the first frame
    if APPLIED_GEOMETRY.get() != Some((profile, margin)) {
        let (width, height) = WINDOW_SIZE;
        // Layer-shell remaps use the default size; resize alone can retain the
        // previous allocation while the surface is hidden.
        gtk_window.set_default_size(width as i32, height as i32);
        gtk_window.resize(width as i32, height as i32);
        match profile {
            WindowProfile::Panel => layer_shell::set_panel_profile(&gtk_window, margin),
            WindowProfile::Sheet => layer_shell::set_sheet_profile(&gtk_window, margin),
        }
        gtk_window.queue_resize();
        APPLIED_GEOMETRY.set(Some((profile, margin)));
    }
    layer_shell::set_keyboard(
        &gtk_window,
        match keyboard {
            PanelKeyboard::OnDemand => Keyboard::OnDemand,
            PanelKeyboard::ExclusiveUntilFocused => Keyboard::Exclusive,
        },
    );
    Ok(())
}

/// Top margin that centers the sheet vertically on the current monitor.
#[cfg(target_os = "linux")]
fn sheet_margin_top(window: &WebviewWindow) -> i32 {
    let (_, height) = WINDOW_SIZE;
    window
        .current_monitor()
        .ok()
        .flatten()
        .map(|m| {
            let scale = m.scale_factor();
            let screen_h = m.size().height as f64 / scale;
            ((screen_h - height) / 2.0).max(40.0) as i32
        })
        .unwrap_or(200)
}

#[cfg(target_os = "windows")]
pub fn apply_panel_surface(
    window: &WebviewWindow,
    profile: WindowProfile,
    _layer: Option<PanelKeyboard>,
) -> Result<(), AppError> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongW, SetWindowLongW, GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOPMOST,
    };

    let handle = window.hwnd()?.0 as windows_sys::Win32::Foundation::HWND;
    let mut style = unsafe { GetWindowLongW(handle, GWL_EXSTYLE) } as u32;
    style |= WS_EX_TOPMOST;
    // the panel takes the keyboard like any other window
    style &= !WS_EX_NOACTIVATE;
    unsafe { SetWindowLongW(handle, GWL_EXSTYLE, style as i32) };
    position_regular_panel(window, profile)
}

#[cfg(target_os = "macos")]
pub fn apply_panel_surface(
    window: &WebviewWindow,
    profile: WindowProfile,
    _layer: Option<PanelKeyboard>,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn region(x: f64, y: f64, width: f64, height: f64) -> InputRegion {
        InputRegion {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn keeps_whole_pixel_regions_as_they_are() {
        assert_eq!(
            region(8.0, 300.0, 784.0, 192.0).to_pixels(),
            (8, 300, 784, 192)
        );
    }

    #[test]
    fn covers_fractional_edges() {
        assert_eq!(
            region(7.5, 300.4, 784.2, 60.1).to_pixels(),
            (7, 300, 785, 61)
        );
    }

    #[test]
    fn clamps_to_the_window_origin_and_never_goes_negative() {
        assert_eq!(region(-4.0, -2.5, 10.0, 5.0).to_pixels(), (0, 0, 6, 3));
        assert_eq!(region(10.0, 10.0, -5.0, 0.0).to_pixels(), (10, 10, 0, 0));
    }

    #[test]
    fn panel_keyboard_defaults_to_on_demand() {
        assert_eq!(PanelKeyboard::parse(None), PanelKeyboard::OnDemand);
        assert_eq!(PanelKeyboard::parse(Some("")), PanelKeyboard::OnDemand);
        assert_eq!(
            PanelKeyboard::parse(Some("on-demand")),
            PanelKeyboard::OnDemand
        );
        assert_eq!(
            PanelKeyboard::parse(Some(" exclusive-until-focused ")),
            PanelKeyboard::ExclusiveUntilFocused
        );
        assert_eq!(PanelKeyboard::parse(Some("grab")), PanelKeyboard::OnDemand);
    }

    #[test]
    fn reads_the_region_sent_by_the_webview() {
        let value = serde_json::json!({ "x": 8, "y": 300.5, "width": 784, "height": 60 });
        let parsed: InputRegion = serde_json::from_value(value).unwrap();
        assert_eq!(parsed, region(8.0, 300.5, 784.0, 60.0));
    }
}
