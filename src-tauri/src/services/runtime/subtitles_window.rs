//! The subtitles of the dialog: a strip over every window with the latest
//! words of the other side. It is a window of its own, so the main window
//! keeps its size and place; the main window is minimized while the strip is
//! shown and comes back when it is closed.
//!
//! The dialog runs in the main window, which publishes what the strip shows;
//! the strip renders it and hands its buttons back to the main window.
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::errors::AppError;
use crate::events::{self, SubtitlesActionRequested, SubtitlesChanged};
use crate::locks::MutexExt;

pub const SUBTITLES_WINDOW_LABEL: &str = "subtitles";

/// The smallest strip the subtitles still fit in, in logical pixels.
const MIN_WIDTH: u32 = 240;
const MIN_HEIGHT: u32 = 44;
/// The strip when none was remembered: wide and low, in logical pixels...
const DEFAULT_WIDTH: u32 = 760;
const DEFAULT_HEIGHT: u32 = 84;
/// Extra vertical headroom for the click-through anchored layer-shell surface,
/// in logical pixels, so the bottom-aligned pill can grow upward even at larger
/// UI scales.
const ANCHORED_SURFACE_HEIGHT: u32 = 108;
/// ...over the bottom of the screen, above where a taskbar or dock is, in
/// logical pixels.
const DEFAULT_BOTTOM_MARGIN: u32 = 96;

/// A monitor's usable work area in physical pixels together with its scale
/// factor, so logical defaults scale properly on HiDPI displays.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MonitorArea {
    pub work_area: WindowGeometry,
    pub scale_factor: f64,
}

fn scaled(logical: u32, scale_factor: f64) -> u32 {
    (f64::from(logical) * scale_factor.max(1.0)).round() as u32
}

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

/// What the strip shows, put into words by the main window.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(optional_fields = nullable)]
pub struct SubtitlesView {
    /// The latest words large: the translation, or the original without one.
    pub main_text: String,
    /// The language of `main_text` when it is the translation.
    pub main_lang: Option<String>,
    /// Words that still wait for their translation, dimmed after it.
    pub pending_text: String,
    /// The original small under the translation.
    pub secondary_text: String,
    /// Shown while nothing was said yet.
    pub placeholder: String,
    pub error_text: String,
    pub is_active: bool,
    pub stop_label: String,
    pub expand_label: String,
    /// When the running session began recording to a file, in Unix
    /// milliseconds; none: it is not recorded.
    #[serde(default, rename = "recordingStartedAt")]
    pub recording_started_at_ms: Option<u64>,
    #[serde(default)]
    pub recording_label: String,
}

/// What the strip knows when it loads.
#[derive(Clone, Debug, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(optional_fields = nullable)]
pub struct SubtitlesSnapshot {
    pub view: Option<SubtitlesView>,
    /// The compositor holds the strip at the bottom of the screen: it cannot
    /// be moved, and only its buttons take the pointer.
    pub is_anchored: bool,
}

/// A button of the strip, done by the main window.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum SubtitlesAction {
    /// Stops the dialog; the main window comes back.
    Stop,
    /// The main window comes back; the dialog goes on.
    Expand,
}

/// The windows the subtitles involve, apart from Tauri.
pub trait SubtitlesHost {
    /// The work areas of the monitors; the first is where the main window is.
    fn monitors(&self) -> Vec<MonitorArea>;
    /// Creates the strip if needed; returns whether the compositor anchors it.
    fn prepare_strip(&self) -> Result<bool, AppError>;
    /// Shows the strip, at `geometry` unless it is anchored.
    fn show_strip(&self, geometry: Option<WindowGeometry>) -> Result<(), AppError>;
    /// Where the strip is now; `None` while it is anchored or not there.
    fn strip_geometry(&self) -> Option<WindowGeometry>;
    fn hide_strip(&self) -> Result<(), AppError>;
    fn minimize_main(&self) -> Result<(), AppError>;
    fn restore_main(&self) -> Result<(), AppError>;
}

#[derive(Default)]
pub struct SubtitlesState {
    is_shown: Mutex<bool>,
    is_anchored: Mutex<bool>,
    view: Mutex<Option<SubtitlesView>>,
}

impl SubtitlesState {
    pub fn snapshot(&self) -> SubtitlesSnapshot {
        SubtitlesSnapshot {
            view: self.view.locked().clone(),
            is_anchored: *self.is_anchored.locked(),
        }
    }

    /// Keeps what the strip shows; returns whether it changed.
    pub fn set_view(&self, view: SubtitlesView) -> bool {
        let mut current = self.view.locked();
        if current.as_ref() == Some(&view) {
            return false;
        }
        *current = Some(view);
        true
    }
}

/// Where the strip goes: the remembered place while it is still on a
/// monitor, else low in the middle of the main window's monitor.
fn strip_geometry(remembered: Option<WindowGeometry>, monitors: &[MonitorArea]) -> WindowGeometry {
    if let Some(geometry) = remembered {
        let matched = monitors
            .iter()
            .find(|monitor| monitor.work_area.intersects(&geometry));
        if monitors.is_empty() || matched.is_some() {
            let scale = matched.map_or(1.0, |monitor| monitor.scale_factor);
            return WindowGeometry {
                width: geometry.width.max(scaled(MIN_WIDTH, scale)),
                height: geometry.height.max(scaled(MIN_HEIGHT, scale)),
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
    let work = monitor.work_area;
    let scale = monitor.scale_factor;
    let min_width = scaled(MIN_WIDTH, scale).min(work.width);
    let min_height = scaled(MIN_HEIGHT, scale).min(work.height);
    let width = scaled(DEFAULT_WIDTH, scale).min(work.width).max(min_width);
    let height = scaled(DEFAULT_HEIGHT, scale)
        .min(work.height)
        .max(min_height);
    let bottom_margin =
        scaled(DEFAULT_BOTTOM_MARGIN, scale).min(work.height.saturating_sub(height));
    WindowGeometry {
        x: work.x + (work.width.saturating_sub(width) / 2) as i32,
        y: work.y + work.height.saturating_sub(height + bottom_margin) as i32,
        width,
        height,
    }
}

/// Shows the strip and minimizes the main window. Called again while shown,
/// it only shows the strip again.
pub fn show(
    host: &impl SubtitlesHost,
    state: &SubtitlesState,
    remembered: Option<WindowGeometry>,
) -> Result<(), AppError> {
    let is_anchored = host.prepare_strip()?;
    *state.is_anchored.locked() = is_anchored;
    let geometry = (!is_anchored).then(|| strip_geometry(remembered, &host.monitors()));
    host.show_strip(geometry)?;
    *state.is_shown.locked() = true;
    host.minimize_main()
}

/// Hides the strip and gives the main window back; returns where the strip
/// was, to be remembered, or `None` when it was anchored or not shown.
pub fn hide(
    host: &impl SubtitlesHost,
    state: &SubtitlesState,
) -> Result<Option<WindowGeometry>, AppError> {
    let was_shown = std::mem::replace(&mut *state.is_shown.locked(), false);
    if !was_shown {
        return Ok(None);
    }
    let geometry = host.strip_geometry();
    host.hide_strip()?;
    host.restore_main()?;
    Ok(geometry)
}

/// Keeps what the strip shows and sends it there when it changed.
pub fn publish(app: &AppHandle, view: SubtitlesView) -> Result<(), AppError> {
    let state = app.state::<SubtitlesState>();
    if state.set_view(view.clone()) {
        events::emit_to::<SubtitlesChanged, _>(app, SUBTITLES_WINDOW_LABEL, view)?;
    }
    Ok(())
}

/// Hands a button of the strip to the main window, where the dialog runs.
pub fn request_action(app: &AppHandle, action: SubtitlesAction) -> Result<(), AppError> {
    events::emit_to::<SubtitlesActionRequested, _>(app, super::MAIN_WINDOW_LABEL, action)?;
    Ok(())
}

/// The windows through Tauri; every call runs on the main thread.
pub struct TauriSubtitlesHost<'a> {
    pub app: &'a AppHandle,
}

impl TauriSubtitlesHost<'_> {
    fn on_window<T: Send + 'static>(
        &self,
        label: &'static str,
        action: impl FnOnce(&tauri::WebviewWindow) -> Result<T, AppError> + Send + 'static,
    ) -> Result<T, AppError> {
        let result = std::sync::Arc::new(Mutex::new(None));
        let output = std::sync::Arc::clone(&result);
        super::on_main_thread(self.app, move |app| {
            let window = app
                .get_webview_window(label)
                .ok_or_else(|| AppError::ServiceUnavailable(format!("Window {label} not found")))?;
            *output.locked() = Some(action(&window)?);
            Ok(())
        })?;
        let value = result.locked().take();
        value.ok_or_else(|| AppError::Failed("The window action returned nothing".into()))
    }
}

fn area_of(monitor: &tauri::Monitor) -> MonitorArea {
    let work = monitor.work_area();
    MonitorArea {
        work_area: WindowGeometry {
            x: work.position.x,
            y: work.position.y,
            width: work.size.width,
            height: work.size.height,
        },
        scale_factor: monitor.scale_factor().max(1.0),
    }
}

impl SubtitlesHost for TauriSubtitlesHost<'_> {
    fn monitors(&self) -> Vec<MonitorArea> {
        self.on_window(super::MAIN_WINDOW_LABEL, |window| {
            let current = window.current_monitor().ok().flatten().map(|m| area_of(&m));
            let others = window
                .available_monitors()
                .unwrap_or_default()
                .iter()
                .map(area_of)
                .filter(|monitor| Some(*monitor) != current)
                .collect::<Vec<_>>();
            Ok(current.into_iter().chain(others).collect())
        })
        .unwrap_or_default()
    }

    fn prepare_strip(&self) -> Result<bool, AppError> {
        let result = std::sync::Arc::new(Mutex::new(None));
        let output = std::sync::Arc::clone(&result);
        super::on_main_thread(self.app, move |app| {
            *output.locked() = Some(ensure_strip(app)?);
            Ok(())
        })?;
        let is_anchored = result.locked().take();
        Ok(is_anchored.unwrap_or(false))
    }

    fn show_strip(&self, geometry: Option<WindowGeometry>) -> Result<(), AppError> {
        self.on_window(SUBTITLES_WINDOW_LABEL, move |window| {
            if let Some(geometry) = geometry {
                window.set_size(tauri::PhysicalSize::new(geometry.width, geometry.height))?;
                window.set_position(tauri::PhysicalPosition::new(geometry.x, geometry.y))?;
                window.set_always_on_top(true)?;
            }
            window.show()?;
            Ok(())
        })
    }

    fn strip_geometry(&self) -> Option<WindowGeometry> {
        if *self.app.state::<SubtitlesState>().is_anchored.locked() {
            return None;
        }
        self.on_window(SUBTITLES_WINDOW_LABEL, |window| {
            let position = window.outer_position()?;
            let size = window.inner_size()?;
            Ok(WindowGeometry {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
            })
        })
        .ok()
    }

    fn hide_strip(&self) -> Result<(), AppError> {
        self.on_window(SUBTITLES_WINDOW_LABEL, |window| Ok(window.hide()?))
    }

    fn minimize_main(&self) -> Result<(), AppError> {
        self.on_window(super::MAIN_WINDOW_LABEL, |window| Ok(window.minimize()?))
    }

    fn restore_main(&self) -> Result<(), AppError> {
        self.on_window(super::MAIN_WINDOW_LABEL, |window| {
            window.show()?;
            window.unminimize()?;
            if let Err(error) = crate::services::platform::focus_window(window) {
                log::warn!("Could not focus the main window: {error}");
            }
            Ok(())
        })
    }
}

/// Creates the strip the first time it is shown: most users never open it.
/// Returns whether the compositor anchors it.
fn ensure_strip(app: &AppHandle) -> Result<bool, AppError> {
    if app.get_webview_window(SUBTITLES_WINDOW_LABEL).is_some() {
        return Ok(*app.state::<SubtitlesState>().is_anchored.locked());
    }
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == SUBTITLES_WINDOW_LABEL)
        .ok_or_else(|| AppError::ServiceUnavailable("The subtitles window is not set up".into()))?
        .clone();
    let window = super::lifecycle::window_builder(app, &config)?.build()?;
    crate::services::platform::attach_subtitles_surface(
        &window,
        (DEFAULT_WIDTH, ANCHORED_SURFACE_HEIGHT),
        DEFAULT_BOTTOM_MARGIN as i32,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const MONITOR: MonitorArea = MonitorArea {
        work_area: WindowGeometry {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        },
        scale_factor: 1.0,
    };

    const HIDPI_MONITOR: MonitorArea = MonitorArea {
        work_area: WindowGeometry {
            x: 0,
            y: 0,
            width: 3840,
            height: 2160,
        },
        scale_factor: 2.0,
    };

    #[derive(Default)]
    struct FakeHost {
        is_anchored: bool,
        strip: Mutex<Option<WindowGeometry>>,
        calls: Mutex<Vec<String>>,
    }

    impl SubtitlesHost for FakeHost {
        fn monitors(&self) -> Vec<MonitorArea> {
            vec![MONITOR]
        }
        fn prepare_strip(&self) -> Result<bool, AppError> {
            Ok(self.is_anchored)
        }
        fn show_strip(&self, geometry: Option<WindowGeometry>) -> Result<(), AppError> {
            self.calls.locked().push(format!("show {geometry:?}"));
            *self.strip.locked() = geometry;
            Ok(())
        }
        fn strip_geometry(&self) -> Option<WindowGeometry> {
            *self.strip.locked()
        }
        fn hide_strip(&self) -> Result<(), AppError> {
            self.calls.locked().push("hide".into());
            Ok(())
        }
        fn minimize_main(&self) -> Result<(), AppError> {
            self.calls.locked().push("minimize main".into());
            Ok(())
        }
        fn restore_main(&self) -> Result<(), AppError> {
            self.calls.locked().push("restore main".into());
            Ok(())
        }
    }

    #[test]
    fn showing_minimizes_the_main_window_and_hiding_brings_it_back() {
        let host = FakeHost::default();
        let state = SubtitlesState::default();
        show(&host, &state, None).unwrap();
        // the user moves the strip
        host.strip.locked().as_mut().unwrap().x = 300;
        let remembered = hide(&host, &state).unwrap().unwrap();
        assert_eq!(remembered.x, 300);
        assert_eq!(
            host.calls.locked()[1..],
            ["minimize main", "hide", "restore main"]
        );
        // hidden already: nothing to give back
        assert_eq!(hide(&host, &state).unwrap(), None);
        assert_eq!(host.calls.locked().len(), 4);
    }

    #[test]
    fn an_anchored_strip_is_neither_placed_nor_remembered() {
        let host = FakeHost {
            is_anchored: true,
            ..FakeHost::default()
        };
        let state = SubtitlesState::default();
        show(&host, &state, Some(MONITOR.work_area)).unwrap();
        assert_eq!(host.calls.locked()[0], "show None");
        assert!(state.snapshot().is_anchored);
        assert_eq!(hide(&host, &state).unwrap(), None);
    }

    #[test]
    fn a_view_is_sent_only_when_it_changed() {
        let state = SubtitlesState::default();
        let view = SubtitlesView {
            main_text: "Hello".into(),
            ..SubtitlesView::default()
        };
        assert!(state.set_view(view.clone()));
        assert!(!state.set_view(view.clone()));
        assert_eq!(state.snapshot().view, Some(view));
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

    #[test]
    fn scales_default_and_minimum_strip_sizes_on_hidpi_monitors() {
        let strip = strip_geometry(None, &[HIDPI_MONITOR]);
        assert_eq!(strip.width, DEFAULT_WIDTH * 2);
        assert_eq!(strip.height, DEFAULT_HEIGHT * 2);
        assert_eq!(strip.x, (3840 - (DEFAULT_WIDTH * 2) as i32) / 2);
        assert_eq!(
            strip.y,
            2160 - (DEFAULT_HEIGHT * 2) as i32 - (DEFAULT_BOTTOM_MARGIN * 2) as i32
        );

        let too_small = WindowGeometry {
            x: 100,
            y: 100,
            width: 300,
            height: 52,
        };
        let clamped = strip_geometry(Some(too_small), &[HIDPI_MONITOR]);
        assert_eq!(clamped.width, MIN_WIDTH * 2);
        assert_eq!(clamped.height, MIN_HEIGHT * 2);
    }
}
