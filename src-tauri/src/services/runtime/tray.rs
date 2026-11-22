//! Tray interactions delegate window operations to the runtime.
use super::target_focus::has_focused_window;
use super::{hide_active_window, show_application};
use crate::errors::AppError;
use crate::state::AppState;
use tauri::menu::{MenuBuilder, MenuItem, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, Manager};

const TRAY_SHOW_ID: &str = "show";
const TRAY_QUIT_ID: &str = "quit";
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

struct TrayState {
    show_item: MenuItem<tauri::Wry>,
    quit_item: MenuItem<tauri::Wry>,
    default_icon: std::sync::Mutex<Option<tauri::image::Image<'static>>>,
    recording_icon: Option<tauri::image::Image<'static>>,
    default_tooltip: std::sync::Mutex<Option<String>>,
    is_recording: std::sync::atomic::AtomicBool,
}

pub fn set_tray_menu_labels(
    app: &tauri::AppHandle,
    show_label: &str,
    quit_label: &str,
    tooltip: Option<&str>,
) -> Result<(), AppError> {
    if let Some(state) = app.try_state::<TrayState>() {
        state.show_item.set_text(show_label)?;
        state.quit_item.set_text(quit_label)?;
        if let Some(tooltip) = tooltip {
            if let Ok(mut guard) = state.default_tooltip.lock() {
                *guard = Some(tooltip.to_string());
            }
            if !state
                .is_recording
                .load(std::sync::atomic::Ordering::Relaxed)
            {
                if let Some(tray) = app.tray_by_id("main-tray") {
                    let _ = tray.set_tooltip(Some(tooltip));
                }
            }
        }
    }
    Ok(())
}

pub fn set_tray_recording(
    app: &tauri::AppHandle,
    is_recording: bool,
    tooltip_label: Option<&str>,
) -> Result<(), AppError> {
    if let Some(state) = app.try_state::<TrayState>() {
        state
            .is_recording
            .store(is_recording, std::sync::atomic::Ordering::Relaxed);
        if let Some(tray) = app.tray_by_id("main-tray") {
            if is_recording {
                if let Some(ref icon) = state.recording_icon {
                    let _ = tray.set_icon(Some(icon.clone()));
                }
                if let Some(tooltip) = tooltip_label {
                    let _ = tray.set_tooltip(Some(tooltip));
                }
            } else {
                if let Ok(guard) = state.default_icon.lock() {
                    if let Some(ref icon) = *guard {
                        let _ = tray.set_icon(Some(icon.clone()));
                    }
                }
                if let Some(tooltip) = tooltip_label {
                    let _ = tray.set_tooltip(Some(tooltip));
                } else if let Ok(guard) = state.default_tooltip.lock() {
                    if let Some(ref tooltip) = *guard {
                        let _ = tray.set_tooltip(Some(tooltip.as_str()));
                    }
                }
            }
        }
    }
    Ok(())
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
    let menu = MenuBuilder::new(app)
        .items(&[&show_item])
        .separator()
        .items(&[&quit_item])
        .build()?;

    let default_icon = app.default_window_icon().map(|icon| {
        tauri::image::Image::new_owned(icon.rgba().to_vec(), icon.width(), icon.height())
    });
    let recording_icon = match load_png_image(RECORDING_ICON_BYTES) {
        Ok(icon) => Some(icon),
        Err(error) => {
            log::warn!("Could not load recording tray icon: {error}");
            None
        }
    };

    app.manage(TrayState {
        show_item,
        quit_item,
        default_icon: std::sync::Mutex::new(default_icon.clone()),
        recording_icon,
        default_tooltip: std::sync::Mutex::new(Some("TyCo — typing companion".to_string())),
        is_recording: std::sync::atomic::AtomicBool::new(false),
    });

    let mut builder = TrayIconBuilder::with_id("main-tray");

    if let Some(icon) = default_icon {
        builder = builder.icon(icon);
    }

    builder
        .menu(&menu)
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
        assert_eq!(icon.width(), 128);
        assert_eq!(icon.height(), 128);
    }
}
