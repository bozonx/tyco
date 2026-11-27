//! Tray interactions delegate window operations to the runtime.
use super::target_focus::has_focused_window;
use super::{hide_active_window, show_application};
use crate::errors::AppError;
use crate::locks::MutexExt;
use crate::state::AppState;
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItem, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, Manager};

const TRAY_SHOW_ID: &str = "show";
const TRAY_QUIT_ID: &str = "quit";
const TRAY_ICON_BYTES: &[u8] = include_bytes!("../../../icons/icon-tray.png");
const RECORDING_ICON_BYTES: &[u8] = include_bytes!("../../../icons/icon-recording.png");

#[derive(Debug, PartialEq, Eq)]
enum TrayClickAction {
    HideActiveWindow,
    ShowApplication,
}

fn tray_click_action(is_window_shown: bool, is_window_focused: bool) -> TrayClickAction {
    if is_window_shown && is_window_focused {
        TrayClickAction::HideActiveWindow
    } else {
        TrayClickAction::ShowApplication
    }
}

#[derive(Default)]
struct TrayActivity {
    quiet_label: Option<String>,
    default_tooltip: String,
    recording_tooltip: Option<String>,
    is_recording: bool,
    quiet_labels: QuietRunLabels,
}

#[derive(Default, serde::Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct QuietRunLabels {
    running: String,
    succeeded: String,
    failed: String,
    cancelled: String,
}

struct TrayState {
    show_item: MenuItem<tauri::Wry>,
    quit_item: MenuItem<tauri::Wry>,
    quiet_item: MenuItem<tauri::Wry>,
    default_icon: tauri::image::Image<'static>,
    recording_icon: tauri::image::Image<'static>,
    quiet_icon: tauri::image::Image<'static>,
    quiet_recording_icon: tauri::image::Image<'static>,
    activity: Mutex<TrayActivity>,
}

impl TrayState {
    fn refresh(&self, app: &tauri::AppHandle) -> Result<(), AppError> {
        let (quiet, icon, tooltip) = {
            let activity = self.activity.locked();
            let quiet = activity.quiet_label.clone();
            let icon = match (quiet.is_some(), activity.is_recording) {
                (true, true) => &self.quiet_recording_icon,
                (true, false) => &self.quiet_icon,
                (false, true) => &self.recording_icon,
                (false, false) => &self.default_icon,
            };
            let tooltip = quiet
                .clone()
                .or_else(|| activity.recording_tooltip.clone())
                .unwrap_or_else(|| activity.default_tooltip.clone());
            (quiet, icon.clone(), tooltip)
        };
        self.quiet_item
            .set_text(quiet.as_deref().unwrap_or("TyCo"))?;
        if let Some(tray) = app.tray_by_id("main-tray") {
            tray.set_icon(Some(icon))?;
            let _ = tray.set_tooltip(Some(tooltip));
        }
        Ok(())
    }
}

pub fn set_tray_menu_labels(
    app: &tauri::AppHandle,
    show_label: &str,
    quit_label: &str,
    tooltip: Option<&str>,
    labels: Option<QuietRunLabels>,
) -> Result<(), AppError> {
    if let Some(state) = app.try_state::<TrayState>() {
        state.show_item.set_text(show_label)?;
        state.quit_item.set_text(quit_label)?;
        {
            let mut activity = state.activity.locked();
            if let Some(tooltip) = tooltip {
                activity.default_tooltip = tooltip.to_owned();
            }
            if let Some(labels) = labels {
                activity.quiet_labels = labels;
            }
        }
        state.refresh(app)?;
    }
    Ok(())
}

pub fn set_tray_recording(
    app: &tauri::AppHandle,
    is_recording: bool,
    tooltip_label: Option<&str>,
) -> Result<(), AppError> {
    if let Some(state) = app.try_state::<TrayState>() {
        {
            let mut activity = state.activity.locked();
            activity.is_recording = is_recording;
            activity.recording_tooltip = tooltip_label.map(str::to_owned);
        }
        state.refresh(app)?;
    }
    Ok(())
}

pub(crate) fn quiet_run_label(
    app: &tauri::AppHandle,
    state: &tyco_activation_protocol::JobState,
    name: &str,
) -> String {
    use tyco_activation_protocol::JobState;
    let tray = app.try_state::<TrayState>();
    let activity = tray.as_ref().map(|tray| tray.activity.locked());
    let label = activity.as_ref().map(|activity| match state {
        JobState::Succeeded => &activity.quiet_labels.succeeded,
        JobState::Failed => &activity.quiet_labels.failed,
        JobState::Cancelled => &activity.quiet_labels.cancelled,
        _ => &activity.quiet_labels.running,
    });
    label.filter(|label| !label.is_empty()).map_or_else(
        || {
            let prefix = match state {
                JobState::Succeeded => "Done",
                JobState::Failed => "Error",
                JobState::Cancelled => "Stopped",
                _ => "Running",
            };
            format!("{prefix}: {name}")
        },
        |label| label.replace("{name}", name),
    )
}

pub(crate) fn set_tray_quiet_run(
    app: &tauri::AppHandle,
    label: Option<String>,
) -> Result<(), AppError> {
    if let Some(state) = app.try_state::<TrayState>() {
        state.activity.locked().quiet_label = label;
        state.refresh(app)?;
    }
    Ok(())
}

/// Adds a blue activity dot in the bottom-left corner, leaving the red
/// recording dot in the opposite corner visible.
fn command_activity_icon(icon: &tauri::image::Image<'_>) -> tauri::image::Image<'static> {
    let width = icon.width();
    let height = icon.height();
    let mut rgba = icon.rgba().to_vec();
    let radius = (width / 6) as i32;
    for y in -radius..=radius {
        for x in -radius..=radius {
            if x * x + y * y > radius * radius {
                continue;
            }
            let column = (x + radius) as u32;
            let row = height - 1 - (y + radius) as u32;
            let index = ((row * width + column) * 4) as usize;
            rgba[index..index + 4].copy_from_slice(&[88, 166, 255, 255]);
        }
    }
    tauri::image::Image::new_owned(rgba, width, height)
}

fn load_png_image(bytes: &[u8]) -> Result<tauri::image::Image<'static>, AppError> {
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder
        .read_info()
        .map_err(|error| AppError::Failed(format!("could not read PNG info: {error}")))?;
    let buffer_size = reader
        .output_buffer_size()
        .unwrap_or(((reader.info().width * reader.info().height * 4) as usize).max(1));
    let mut buf = vec![0u8; buffer_size];
    let info = reader
        .next_frame(&mut buf)
        .map_err(|error| AppError::Failed(format!("could not decode PNG frame: {error}")))?;
    let (width, height) = (info.width, info.height);
    let rgba = match info.color_type {
        png::ColorType::Rgba => buf,
        png::ColorType::Rgb => {
            let mut rgba = Vec::with_capacity((width * height * 4) as usize);
            for chunk in buf.as_chunks::<3>().0 {
                rgba.extend_from_slice(chunk);
                rgba.push(255);
            }
            rgba
        }
        other => {
            return Err(AppError::Failed(format!(
                "unsupported PNG color type: {other:?}"
            )))
        }
    };
    Ok(tauri::image::Image::new_owned(rgba, width, height))
}

pub(super) fn setup_tray(app: &mut App) -> Result<(), AppError> {
    let show_item = MenuItemBuilder::with_id(TRAY_SHOW_ID, "Show TyCo").build(app)?;
    let quit_item = MenuItemBuilder::with_id(TRAY_QUIT_ID, "Quit").build(app)?;
    let quiet_item = MenuItemBuilder::with_id("quiet-run-status", "TyCo")
        .enabled(false)
        .build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&quiet_item, &show_item])
        .separator()
        .items(&[&quit_item])
        .build()?;

    let default_icon = load_png_image(TRAY_ICON_BYTES)?;
    let recording_icon = load_png_image(RECORDING_ICON_BYTES).unwrap_or_else(|error| {
        log::warn!("Could not load recording tray icon: {error}");
        default_icon.clone()
    });

    app.manage(TrayState {
        show_item,
        quit_item,
        quiet_item,
        quiet_icon: command_activity_icon(&default_icon),
        quiet_recording_icon: command_activity_icon(&recording_icon),
        default_icon: default_icon.clone(),
        recording_icon,
        activity: Mutex::new(TrayActivity {
            default_tooltip: "TyCo — typing companion".to_owned(),
            ..Default::default()
        }),
    });

    let builder = TrayIconBuilder::with_id("main-tray").icon(default_icon);

    builder
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("TyCo — typing companion")
        .on_menu_event(move |app, event| {
            if app.try_state::<AppState>().is_some() {
                match event.id.as_ref() {
                    TRAY_SHOW_ID => {
                        if let Err(error) = show_application(app) {
                            log::error!("Could not show the application: {error}");
                        }
                    }
                    TRAY_QUIT_ID => {
                        app.exit(0);
                    }
                    _ => {}
                }
            }
        })
        .on_tray_icon_event(move |tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(state) = app.try_state::<AppState>() {
                    let snapshot = state.snapshot();
                    let result = match tray_click_action(
                        snapshot.window.is_window_shown,
                        has_focused_window(app),
                    ) {
                        TrayClickAction::HideActiveWindow => hide_active_window(app),
                        TrayClickAction::ShowApplication => show_application(app),
                    };
                    if let Err(error) = result {
                        log::error!("Tray click failed: {error}");
                    }
                }
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tray_click_hides_a_focused_visible_window_and_shows_the_application_otherwise() {
        assert_eq!(
            tray_click_action(true, true),
            TrayClickAction::HideActiveWindow
        );
        assert_eq!(
            tray_click_action(true, false),
            TrayClickAction::ShowApplication
        );
        assert_eq!(
            tray_click_action(false, false),
            TrayClickAction::ShowApplication
        );
        assert_eq!(
            tray_click_action(false, true),
            TrayClickAction::ShowApplication
        );
    }

    #[test]
    fn recording_icon_bytes_parse_as_image() {
        let icon = load_png_image(RECORDING_ICON_BYTES);
        assert!(icon.is_ok());
        let icon = icon.unwrap();
        assert_eq!(icon.width(), 32);
        assert_eq!(icon.height(), 32);
    }
}
