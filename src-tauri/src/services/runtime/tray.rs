//! Tray interactions delegate window operations to the runtime.
use super::{hide_active_window, show_application};
use crate::errors::AppError;
use crate::state::AppState;
use tauri::menu::{MenuBuilder, MenuItem, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, Manager};

const TRAY_SHOW_ID: &str = "show";
const TRAY_QUIT_ID: &str = "quit";
#[derive(Debug, PartialEq, Eq)]
enum TrayClickAction {
    HideActiveWindow,
    ShowApplication,
}

fn tray_click_action(is_window_shown: bool) -> TrayClickAction {
    if is_window_shown {
        TrayClickAction::HideActiveWindow
    } else {
        TrayClickAction::ShowApplication
    }
}

struct TrayMenu {
    show_item: MenuItem<tauri::Wry>,
    quit_item: MenuItem<tauri::Wry>,
}

pub fn set_tray_menu_labels(
    app: &tauri::AppHandle,
    show_label: &str,
    quit_label: &str,
) -> Result<(), AppError> {
    let menu = app.state::<TrayMenu>();
    menu.show_item.set_text(show_label)?;
    menu.quit_item.set_text(quit_label)?;
    Ok(())
}

pub(super) fn setup_tray(app: &mut App) -> Result<(), AppError> {
    let show_item = MenuItemBuilder::with_id(TRAY_SHOW_ID, "Show Tyco").build(app)?;
    let quit_item = MenuItemBuilder::with_id(TRAY_QUIT_ID, "Quit").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&show_item])
        .separator()
        .items(&[&quit_item])
        .build()?;

    app.manage(TrayMenu {
        show_item,
        quit_item,
    });

    let tray_icon = app.default_window_icon().cloned();

    let mut builder = TrayIconBuilder::with_id("main-tray");

    if let Some(icon) = tray_icon {
        builder = builder.icon(icon);
    }

    builder
        .menu(&menu)
        .tooltip("TyCo - typing companion")
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
                    let result = match tray_click_action(snapshot.window.is_window_shown) {
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
    fn tray_click_hides_a_visible_window_and_shows_the_application_otherwise() {
        assert_eq!(tray_click_action(true), TrayClickAction::HideActiveWindow);
        assert_eq!(tray_click_action(false), TrayClickAction::ShowApplication);
    }
}
