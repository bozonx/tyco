//! Tray interactions delegate window operations to the runtime.
use super::{hide_active_window, show_application};
use crate::errors::AppError;
use crate::state::AppState;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, Manager};

const TRAY_SHOW_ID: &str = "show";
const TRAY_CORRECT_ID: &str = "correct-selection";
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

pub(super) fn setup_tray(app: &mut App) -> Result<(), AppError> {
    let show_item = MenuItemBuilder::with_id(TRAY_SHOW_ID, "Show Tyco").build(app)?;
    let correct_item =
        MenuItemBuilder::with_id(TRAY_CORRECT_ID, "Correct selected text").build(app)?;
    let quit_item = MenuItemBuilder::with_id(TRAY_QUIT_ID, "Quit").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&show_item, &correct_item])
        .separator()
        .items(&[&quit_item])
        .build()?;

    let tray_icon = app.default_window_icon().cloned();

    let mut builder = TrayIconBuilder::with_id("main-tray");

    if let Some(icon) = tray_icon {
        builder = builder.icon(icon);
    }

    builder
        .menu(&menu)
        .tooltip("TyCo - typing companion")
        .on_menu_event(move |app, event| {
            if let Some(state) = app.try_state::<AppState>() {
                match event.id.as_ref() {
                    TRAY_SHOW_ID => {
                        if let Err(error) = show_application(app) {
                            log::error!("Could not show the application: {error}");
                        }
                    }
                    TRAY_CORRECT_ID => {
                        if let Err(error) = crate::services::selection_replace::trigger(
                            app,
                            "correction",
                            crate::services::selection_replace::TriggerWait::Delay(
                                crate::services::selection_replace::TRAY_MENU_DELAY,
                            ),
                        ) {
                            log::error!("Could not correct the selection: {error}");
                        }
                    }
                    TRAY_QUIT_ID => {
                        state.set_quitting(true);
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
                    let params = state.snapshot();
                    let result = match tray_click_action(params.window.is_window_shown) {
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
