use serde::Deserialize;
use tauri::{PhysicalPosition, Position, WebviewWindow};

#[cfg(target_os = "linux")]
use gtk::prelude::*;

use crate::errors::AppError;
use crate::services::activation::{WindowProfile, WINDOW_SIZE};

/// Part of the window, in logical pixels from its top left corner, that takes
/// pointer input.
#[derive(Clone, Copy, Debug, PartialEq, Deserialize, ts_rs::TS)]
pub struct InputRegion {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl InputRegion {
    /// Whole pixels covering the region: it may grow by a fraction of a
    /// pixel, never shrink, so its edges always stay clickable.
    pub fn to_integer_logical_bounds(self) -> (i32, i32, i32, i32) {
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
pub enum PanelKeyboardMode {
    /// The compositor decides whether the mapped panel gets the focus.
    #[default]
    OnDemand,
    /// The panel grabs the keyboard when mapped, as in the input-loss lab, and
    /// returns to on-demand once the focus has arrived, so a click elsewhere
    /// still takes the focus away.
    ExclusiveUntilFocused,
}

impl PanelKeyboardMode {
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

#[cfg(target_os = "linux")]
pub fn attach_panel_surface(
    window: &WebviewWindow,
    should_recover: impl Fn() -> bool + Send + Sync + 'static,
) -> Result<(), AppError> {
    let gtk_window = window.gtk_window()?;
    crate::services::platform::linux::layer_shell::attach(&gtk_window);
    window.with_webview(move |webview| {
        let view = webview.inner();
        let Some(window) = view
            .toplevel()
            .and_then(|widget| widget.downcast::<gtk::ApplicationWindow>().ok())
        else {
            return;
        };
        let weak_window = window.downgrade();
        let weak_view = view.downgrade();
        if let Some(display) = gtk::gdk::Display::default() {
            display.connect_monitor_removed(move |display, removed| {
                if let (Some(window), Some(view)) = (weak_window.upgrade(), weak_view.upgrade()) {
                    if should_recover() {
                        recover_removed_monitor(&window, &view, display, removed);
                    }
                }
            });
        }
    })?;
    gtk_window.connect_focus_in_event(|window, _| {
        if PANEL_RELOCATING.replace(false) {
            clear_relocation_timer();
            super::linux::layer_shell::set_keyboard(
                window,
                super::linux::layer_shell::KeyboardMode::OnDemand,
            );
        }
        gtk::glib::Propagation::Proceed
    });
    Ok(())
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub fn attach_panel_surface(
    _window: &WebviewWindow,
    _should_recover: impl Fn() -> bool + Send + Sync + 'static,
) -> Result<(), AppError> {
    Ok(())
}

#[cfg(target_os = "linux")]
pub fn disable_panel_keyboard(window: &WebviewWindow) -> Result<(), AppError> {
    crate::services::platform::linux::layer_shell::set_keyboard(
        &window.gtk_window()?,
        crate::services::platform::linux::layer_shell::KeyboardMode::None,
    );
    Ok(())
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub fn disable_panel_keyboard(_window: &WebviewWindow) -> Result<(), AppError> {
    Ok(())
}

/// Whether the quick window can be a layer-shell surface, which takes its
/// size and keyboard mode from `apply_panel_surface`; only Linux has them.
pub fn is_layer_shell_supported() -> bool {
    #[cfg(target_os = "linux")]
    {
        crate::services::platform::linux::layer_shell::is_supported()
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

/// Fades the window in or out without unmapping it; only GTK can.
pub fn set_window_opacity(window: &WebviewWindow, opacity: f64) -> Result<(), AppError> {
    #[cfg(target_os = "linux")]
    {
        use gtk::prelude::WidgetExt;
        window.gtk_window()?.set_opacity(opacity);
    }
    #[cfg(not(target_os = "linux"))]
    let _ = (window, opacity);
    Ok(())
}

/// The shown panel got the focus: an exclusive grab is not needed any more.
#[cfg(not(target_os = "linux"))]
pub fn settle_panel_keyboard(
    _window: &WebviewWindow,
    _keyboard: PanelKeyboardMode,
) -> Result<(), AppError> {
    Ok(())
}

/// The shown panel got the focus: an exclusive grab is not needed any more.
#[cfg(target_os = "linux")]
pub fn settle_panel_keyboard(
    window: &WebviewWindow,
    keyboard: PanelKeyboardMode,
) -> Result<(), AppError> {
    if keyboard == PanelKeyboardMode::ExclusiveUntilFocused {
        crate::services::platform::linux::layer_shell::set_keyboard(
            &window.gtk_window()?,
            crate::services::platform::linux::layer_shell::KeyboardMode::OnDemand,
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
            let (x, y, width, height) = region.to_integer_logical_bounds();
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
    static APPLIED_GEOMETRY: std::cell::Cell<Option<(WindowProfile, i32, i32, i32)>> =
        const { std::cell::Cell::new(None) };
}

#[cfg(target_os = "linux")]
const PANEL_MARGIN_BOTTOM: i32 = 48;

#[cfg(target_os = "linux")]
thread_local! {
    static SELECTED_PANEL_MONITOR: std::cell::RefCell<Option<gtk::gdk::Monitor>> = const { std::cell::RefCell::new(None) };
    static PANEL_RELOCATING: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    static RELOCATION_TIMER: std::cell::RefCell<Option<gtk::glib::SourceId>> = const { std::cell::RefCell::new(None) };
}

pub fn is_panel_relocating() -> bool {
    #[cfg(target_os = "linux")]
    {
        PANEL_RELOCATING.get()
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

#[cfg(target_os = "linux")]
fn clear_relocation_timer() {
    RELOCATION_TIMER.with_borrow_mut(|timer| {
        if let Some(timer) = timer.take() {
            timer.remove();
        }
    });
}

#[cfg(target_os = "linux")]
fn recover_removed_monitor(
    window: &gtk::ApplicationWindow,
    view: &impl IsA<gtk::Widget>,
    display: &gtk::gdk::Display,
    removed: &gtk::gdk::Monitor,
) {
    use super::linux::layer_shell::{self, KeyboardMode};
    if !SELECTED_PANEL_MONITOR.with_borrow(|monitor| monitor.as_ref() == Some(removed)) {
        return;
    }
    let Some(monitor) = (0..display.n_monitors())
        .filter_map(|index| display.monitor(index))
        .find(|monitor| monitor != removed)
    else {
        return;
    };
    let Some((profile, _, _, _)) = APPLIED_GEOMETRY.get() else {
        return;
    };
    PANEL_RELOCATING.set(true);
    clear_relocation_timer();
    window.hide();
    layer_shell::set_monitor(window, &monitor);
    SELECTED_PANEL_MONITOR.with_borrow_mut(|selected| *selected = Some(monitor.clone()));
    let geometry = monitor.geometry();
    let (width, height) = fitted_panel_size(geometry.width(), geometry.height());
    let margin = match profile {
        WindowProfile::Panel => PANEL_MARGIN_BOTTOM,
        WindowProfile::Sheet => ((geometry.height() - height) / 2).max(MIN_SHEET_MARGIN_TOP as i32),
    };
    view.set_size_request(width, height);
    window.set_default_size(width, height);
    window.resize(width, height);
    match profile {
        WindowProfile::Panel => layer_shell::set_panel_profile(window, margin),
        WindowProfile::Sheet => layer_shell::set_sheet_profile(window, margin),
    }
    APPLIED_GEOMETRY.set(Some((profile, margin, width, height)));
    // The old output's closed event is not a user dismissal. Reacquire the
    // keyboard while remapping, then return to on-demand on native focus.
    layer_shell::set_keyboard(window, KeyboardMode::Exclusive);
    window.show();
    window.present();
    let weak_window = window.downgrade();
    let timer = gtk::glib::timeout_add_local_once(std::time::Duration::from_secs(2), move || {
        RELOCATION_TIMER.with_borrow_mut(|timer| {
            timer.take();
        });
        PANEL_RELOCATING.set(false);
        if let Some(window) = weak_window.upgrade() {
            layer_shell::set_keyboard(&window, KeyboardMode::OnDemand);
        }
    });
    RELOCATION_TIMER.with_borrow_mut(|slot| *slot = Some(timer));
}

/// Capture target geometry off the GTK thread, before hiding or focusing windows.
pub fn target_monitor_point(id: Option<&str>) -> Option<(i32, i32)> {
    #[cfg(target_os = "linux")]
    if super::session::current().is_kde_wayland() {
        return super::linux::kwin::window_center(id?);
    }
    let _ = id;
    None
}

/// Bind a layer panel to the recipient's monitor instead of a previous output.
pub fn select_panel_monitor(
    window: &WebviewWindow,
    point: Option<(i32, i32)>,
    layer: Option<PanelKeyboardMode>,
) -> Result<(), AppError> {
    #[cfg(target_os = "linux")]
    if let (Some((x, y)), Some(_)) = (point, layer) {
        let gtk_window = window.gtk_window()?;
        if let Some(display) = gtk::gdk::Display::default() {
            if let Some(monitor) = display.monitor_at_point(x, y) {
                super::linux::layer_shell::set_monitor(&gtk_window, &monitor);
                SELECTED_PANEL_MONITOR.with_borrow_mut(|selected| *selected = Some(monitor));
            }
        }
    }
    let _ = (window, point, layer);
    Ok(())
}

#[cfg(target_os = "linux")]
fn fitted_panel_size(width: i32, height: i32) -> (i32, i32) {
    let (default_width, default_height) = WINDOW_SIZE;
    (
        (default_width as i32).min((width - 32).max(1)),
        (default_height as i32).min((height - 96).max(1)),
    )
}

/// Places the quick window before it is shown. `layer` is the keyboard mode of
/// the layer-shell surface, or `None` when the window is a regular one.
#[cfg(target_os = "linux")]
pub fn apply_panel_surface(
    window: &WebviewWindow,
    profile: WindowProfile,
    layer: Option<PanelKeyboardMode>,
) -> Result<(), AppError> {
    use crate::services::platform::linux::layer_shell::{self, KeyboardMode};

    let Some(keyboard) = layer else {
        return position_regular_panel(window, profile);
    };
    let gtk_window = window.gtk_window()?;
    let (width, height) = layer_shell::monitor(&gtk_window)
        .map(|monitor| {
            let geometry = monitor.geometry();
            fitted_panel_size(geometry.width(), geometry.height())
        })
        .unwrap_or((WINDOW_SIZE.0 as i32, WINDOW_SIZE.1 as i32));
    let margin = match profile {
        WindowProfile::Panel => PANEL_MARGIN_BOTTOM,
        WindowProfile::Sheet => sheet_margin_top(window, height),
    };
    // Anchors and size only change with the profile; reapplying them on every
    // show costs a relayout and a configure round trip before the first frame
    if APPLIED_GEOMETRY.get() != Some((profile, margin, width, height)) {
        // Layer-shell remaps use the default size; resize alone can retain the
        // previous allocation while the surface is hidden.
        // Wry's GtkFixed child retains a minimum size from its previous bounds.
        // Shrink that request as well, otherwise GTK cannot fit a smaller output.
        window.with_webview(move |webview| {
            webview.inner().set_size_request(width, height);
        })?;
        gtk_window.set_default_size(width, height);
        gtk_window.resize(width, height);
        match profile {
            WindowProfile::Panel => layer_shell::set_panel_profile(&gtk_window, margin),
            WindowProfile::Sheet => layer_shell::set_sheet_profile(&gtk_window, margin),
        }
        gtk_window.queue_resize();
        APPLIED_GEOMETRY.set(Some((profile, margin, width, height)));
    }
    layer_shell::set_keyboard(
        &gtk_window,
        match keyboard {
            PanelKeyboardMode::OnDemand => KeyboardMode::OnDemand,
            PanelKeyboardMode::ExclusiveUntilFocused => KeyboardMode::Exclusive,
        },
    );
    Ok(())
}

/// The sheet keeps at least this much space above it.
#[cfg(target_os = "linux")]
const MIN_SHEET_MARGIN_TOP: f64 = 40.0;
/// The top margin when the monitor is unknown.
#[cfg(target_os = "linux")]
const FALLBACK_SHEET_MARGIN_TOP: i32 = 200;

/// Top margin that centers the sheet vertically on the current monitor.
#[cfg(target_os = "linux")]
fn sheet_margin_top(window: &WebviewWindow, height: i32) -> i32 {
    if let Ok(gtk_window) = window.gtk_window() {
        if let Some(monitor) = super::linux::layer_shell::monitor(&gtk_window) {
            return ((monitor.geometry().height() - height) / 2).max(MIN_SHEET_MARGIN_TOP as i32);
        }
    }
    window
        .current_monitor()
        .ok()
        .flatten()
        .map(|m| {
            let scale = m.scale_factor();
            let screen_h = m.size().height as f64 / scale;
            ((screen_h - f64::from(height)) / 2.0).max(MIN_SHEET_MARGIN_TOP) as i32
        })
        .unwrap_or(FALLBACK_SHEET_MARGIN_TOP)
}

#[cfg(target_os = "windows")]
pub fn apply_panel_surface(
    window: &WebviewWindow,
    profile: WindowProfile,
    _layer: Option<PanelKeyboardMode>,
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
    _layer: Option<PanelKeyboardMode>,
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

    #[cfg(target_os = "linux")]
    #[test]
    fn panel_fits_small_high_dpi_outputs() {
        assert_eq!(fitted_panel_size(1920, 1080), (930, 600));
        assert_eq!(fitted_panel_size(960, 540), (928, 444));
    }

    #[test]
    fn keeps_whole_pixel_regions_as_they_are() {
        assert_eq!(
            region(8.0, 300.0, 784.0, 192.0).to_integer_logical_bounds(),
            (8, 300, 784, 192)
        );
    }

    #[test]
    fn covers_fractional_edges() {
        assert_eq!(
            region(7.5, 300.4, 784.2, 60.1).to_integer_logical_bounds(),
            (7, 300, 785, 61)
        );
    }

    #[test]
    fn clamps_to_the_window_origin_and_never_goes_negative() {
        assert_eq!(
            region(-4.0, -2.5, 10.0, 5.0).to_integer_logical_bounds(),
            (0, 0, 6, 3)
        );
        assert_eq!(
            region(10.0, 10.0, -5.0, 0.0).to_integer_logical_bounds(),
            (10, 10, 0, 0)
        );
    }

    #[test]
    fn panel_keyboard_defaults_to_on_demand() {
        assert_eq!(PanelKeyboardMode::parse(None), PanelKeyboardMode::OnDemand);
        assert_eq!(
            PanelKeyboardMode::parse(Some("")),
            PanelKeyboardMode::OnDemand
        );
        assert_eq!(
            PanelKeyboardMode::parse(Some("on-demand")),
            PanelKeyboardMode::OnDemand
        );
        assert_eq!(
            PanelKeyboardMode::parse(Some(" exclusive-until-focused ")),
            PanelKeyboardMode::ExclusiveUntilFocused
        );
        assert_eq!(
            PanelKeyboardMode::parse(Some("grab")),
            PanelKeyboardMode::OnDemand
        );
    }

    #[test]
    fn reads_the_region_sent_by_the_webview() {
        let value = serde_json::json!({ "x": 8, "y": 300.5, "width": 784, "height": 60 });
        let parsed: InputRegion = serde_json::from_value(value).unwrap();
        assert_eq!(parsed, region(8.0, 300.5, 784.0, 60.0));
    }
}
