//! The compact mode of the main window: a narrow strip over every window,
//! which shows the subtitles of the dialog. Leaving it gives the window its
//! size, position and mode back.
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::errors::AppError;
use crate::locks::MutexExt;

/// The smallest strip the subtitles still fit in, in physical pixels.
const MIN_WIDTH: u32 = 240;
const MIN_HEIGHT: u32 = 64;
/// The strip when none was remembered: wide and low...
const DEFAULT_WIDTH: u32 = 760;
const DEFAULT_HEIGHT: u32 = 140;
/// ...over the bottom of the screen, above where a taskbar or dock is.
const DEFAULT_BOTTOM_MARGIN: u32 = 96;

/// Where a window is and how large, in physical pixels of the desktop.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct WindowGeometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl WindowGeometry {
    fn intersects(&self, other: &WindowGeometry) -> bool {
        let right = |g: &WindowGeometry| i64::from(g.x) + i64::from(g.width);
        let bottom = |g: &WindowGeometry| i64::from(g.y) + i64::from(g.height);
        i64::from(self.x) < right(other)
            && i64::from(other.x) < right(self)
            && i64::from(self.y) < bottom(other)
            && i64::from(other.y) < bottom(self)
    }
}

/// What leaving the compact mode gives back.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WindowMode {
    pub geometry: WindowGeometry,
    pub is_maximized: bool,
    pub is_always_on_top: bool,
    pub has_decorations: bool,
}

/// The window the compact mode changes, apart from Tauri.
pub trait CompactWindowHost {
    fn mode(&self) -> Result<WindowMode, AppError>;
    /// The work areas of the monitors; the first is where the window is.
    fn monitors(&self) -> Vec<WindowGeometry>;
    fn apply_strip(&self, geometry: WindowGeometry) -> Result<(), AppError>;
    fn restore(&self, mode: &WindowMode) -> Result<(), AppError>;
}

/// The mode the main window had before it became a strip.
#[derive(Default)]
pub struct CompactWindowState {
    saved: Mutex<Option<WindowMode>>,
}

impl CompactWindowState {
    #[cfg(test)]
    fn is_compact(&self) -> bool {
        self.saved.locked().is_some()
    }
}

/// Where the strip goes: the remembered place while it is still on a
/// monitor, else low in the middle of the window's monitor.
fn strip_geometry(
    remembered: Option<WindowGeometry>,
    monitors: &[WindowGeometry],
) -> WindowGeometry {
    if let Some(geometry) = remembered {
        let is_on_screen = monitors.is_empty() || monitors.iter().any(|m| m.intersects(&geometry));
        if is_on_screen {
            return WindowGeometry {
                width: geometry.width.max(MIN_WIDTH),
                height: geometry.height.max(MIN_HEIGHT),
                ..geometry
            };
        }
    }
    let Some(monitor) = monitors.first() else {
        return WindowGeometry {
            x: 0,
            y: 0,
            width: DEFAULT_WIDTH,
            height: DEFAULT_HEIGHT,
        };
    };
    let width = DEFAULT_WIDTH.min(monitor.width).max(MIN_WIDTH);
    let height = DEFAULT_HEIGHT.min(monitor.height).max(MIN_HEIGHT);
    let bottom_margin = DEFAULT_BOTTOM_MARGIN.min(monitor.height.saturating_sub(height));
    WindowGeometry {
        x: monitor.x + (monitor.width.saturating_sub(width) / 2) as i32,
        y: monitor.y + monitor.height.saturating_sub(height + bottom_margin) as i32,
        width,
        height,
    }
}

/// Turns the window into the strip; returns where it went. Called again
/// while compact, it only moves the strip.
pub fn enter(
    host: &impl CompactWindowHost,
    state: &CompactWindowState,
    remembered: Option<WindowGeometry>,
) -> Result<WindowGeometry, AppError> {
    let geometry = strip_geometry(remembered, &host.monitors());
    let mut saved = state.saved.locked();
    if saved.is_none() {
        *saved = Some(host.mode()?);
    }
    host.apply_strip(geometry)?;
    Ok(geometry)
}

/// Gives the window its mode back; returns where the strip was, to be
/// remembered, or `None` when the window was not compact.
pub fn leave(
    host: &impl CompactWindowHost,
    state: &CompactWindowState,
) -> Result<Option<WindowGeometry>, AppError> {
    let Some(saved) = state.saved.locked().take() else {
        return Ok(None);
    };
    let strip = host.mode().ok().map(|mode| mode.geometry);
    host.restore(&saved)?;
    Ok(strip)
}

/// The main window through Tauri; every call runs on the main thread.
pub struct MainWindowHost<'a> {
    pub app: &'a AppHandle,
}

impl MainWindowHost<'_> {
    fn with_window<T: Send + 'static>(
        &self,
        action: impl FnOnce(&tauri::WebviewWindow) -> Result<T, AppError> + Send + 'static,
    ) -> Result<T, AppError> {
        let result = std::sync::Arc::new(Mutex::new(None));
        let output = std::sync::Arc::clone(&result);
        super::on_main_thread(self.app, move |app| {
            let window = app
                .get_webview_window(super::MAIN_WINDOW_LABEL)
                .ok_or_else(|| AppError::ServiceUnavailable("Main window not found".into()))?;
            *output.locked() = Some(action(&window)?);
            Ok(())
        })?;
        let value = result.locked().take();
        value.ok_or_else(|| AppError::Failed("The window action returned nothing".into()))
    }
}

fn geometry_of(window: &tauri::WebviewWindow) -> Result<WindowGeometry, AppError> {
    let position = window.outer_position()?;
    let size = window.inner_size()?;
    Ok(WindowGeometry {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

impl CompactWindowHost for MainWindowHost<'_> {
    fn mode(&self) -> Result<WindowMode, AppError> {
        self.with_window(|window| {
            Ok(WindowMode {
                geometry: geometry_of(window)?,
                is_maximized: window.is_maximized().unwrap_or(false),
                is_always_on_top: window.is_always_on_top().unwrap_or(false),
                has_decorations: window.is_decorated().unwrap_or(true),
            })
        })
    }

    fn monitors(&self) -> Vec<WindowGeometry> {
        self.with_window(|window| {
            let area = |monitor: &tauri::Monitor| {
                let work = monitor.work_area();
                WindowGeometry {
                    x: work.position.x,
                    y: work.position.y,
                    width: work.size.width,
                    height: work.size.height,
                }
            };
            let current = window.current_monitor().ok().flatten().map(|m| area(&m));
            let monitors = window.available_monitors().unwrap_or_default();
            let others = monitors
                .iter()
                .map(area)
                .filter(|monitor| Some(*monitor) != current);
            Ok(current.into_iter().chain(others).collect())
        })
        .unwrap_or_default()
    }

    fn apply_strip(&self, geometry: WindowGeometry) -> Result<(), AppError> {
        self.with_window(move |window| {
            if window.is_maximized().unwrap_or(false) {
                window.unmaximize()?;
            }
            window.set_decorations(false)?;
            window.set_min_size(Some(tauri::PhysicalSize::new(MIN_WIDTH, MIN_HEIGHT)))?;
            window.set_size(tauri::PhysicalSize::new(geometry.width, geometry.height))?;
            window.set_position(tauri::PhysicalPosition::new(geometry.x, geometry.y))?;
            window.set_always_on_top(true)?;
            Ok(())
        })
    }

    fn restore(&self, mode: &WindowMode) -> Result<(), AppError> {
        let mode = *mode;
        self.with_window(move |window| {
            window.set_always_on_top(mode.is_always_on_top)?;
            window.set_decorations(mode.has_decorations)?;
            // the minimum of `tauri.conf.json`
            window.set_min_size(Some(tauri::LogicalSize::new(640.0, 96.0)))?;
            let geometry = mode.geometry;
            window.set_size(tauri::PhysicalSize::new(geometry.width, geometry.height))?;
            window.set_position(tauri::PhysicalPosition::new(geometry.x, geometry.y))?;
            if mode.is_maximized {
                window.maximize()?;
            }
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MONITOR: WindowGeometry = WindowGeometry {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
    };

    struct FakeWindow {
        mode: Mutex<WindowMode>,
        monitors: Vec<WindowGeometry>,
        calls: Mutex<Vec<String>>,
    }

    impl FakeWindow {
        fn new() -> Self {
            Self {
                mode: Mutex::new(WindowMode {
                    geometry: WindowGeometry {
                        x: 100,
                        y: 50,
                        width: 1000,
                        height: 600,
                    },
                    is_maximized: true,
                    is_always_on_top: false,
                    has_decorations: true,
                }),
                monitors: vec![MONITOR],
                calls: Mutex::default(),
            }
        }
    }

    impl CompactWindowHost for FakeWindow {
        fn mode(&self) -> Result<WindowMode, AppError> {
            Ok(*self.mode.locked())
        }
        fn monitors(&self) -> Vec<WindowGeometry> {
            self.monitors.clone()
        }
        fn apply_strip(&self, geometry: WindowGeometry) -> Result<(), AppError> {
            self.calls.locked().push("strip".into());
            *self.mode.locked() = WindowMode {
                geometry,
                is_maximized: false,
                is_always_on_top: true,
                has_decorations: false,
            };
            Ok(())
        }
        fn restore(&self, mode: &WindowMode) -> Result<(), AppError> {
            self.calls.locked().push("restore".into());
            *self.mode.locked() = *mode;
            Ok(())
        }
    }

    #[test]
    fn leaving_gives_the_window_its_mode_back_and_reports_the_strip() {
        let window = FakeWindow::new();
        let before = window.mode().unwrap();
        let state = CompactWindowState::default();
        let strip = enter(&window, &state, None).unwrap();
        assert!(state.is_compact());
        assert!(window.mode().unwrap().is_always_on_top);
        // the user moves the strip
        window.mode.locked().geometry.x = 300;
        let left = leave(&window, &state).unwrap().unwrap();
        assert_eq!(left, WindowGeometry { x: 300, ..strip });
        assert_eq!(window.mode().unwrap(), before);
        assert!(!state.is_compact());
        assert_eq!(leave(&window, &state).unwrap(), None);
    }

    #[test]
    fn entering_twice_keeps_the_first_saved_mode() {
        let window = FakeWindow::new();
        let before = window.mode().unwrap();
        let state = CompactWindowState::default();
        enter(&window, &state, None).unwrap();
        enter(&window, &state, None).unwrap();
        leave(&window, &state).unwrap();
        assert_eq!(window.mode().unwrap(), before);
    }

    #[test]
    fn the_default_strip_is_low_in_the_middle_of_the_monitor() {
        let strip = strip_geometry(None, &[MONITOR]);
        assert_eq!(strip.width, DEFAULT_WIDTH);
        assert_eq!(strip.x, (1920 - DEFAULT_WIDTH as i32) / 2);
        assert_eq!(
            strip.y,
            1080 - DEFAULT_HEIGHT as i32 - DEFAULT_BOTTOM_MARGIN as i32
        );
    }

    #[test]
    fn a_remembered_strip_is_used_while_it_is_on_a_monitor() {
        let remembered = WindowGeometry {
            x: 10,
            y: 20,
            width: 500,
            height: 30,
        };
        let strip = strip_geometry(Some(remembered), &[MONITOR]);
        assert_eq!((strip.x, strip.y, strip.width), (10, 20, 500));
        // too low to hold a line: raised to the minimum
        assert_eq!(strip.height, MIN_HEIGHT);
        // a monitor that is gone since
        let off_screen = WindowGeometry {
            x: 4000,
            ..remembered
        };
        assert_eq!(
            strip_geometry(Some(off_screen), &[MONITOR]),
            strip_geometry(None, &[MONITOR])
        );
    }
}
