use tauri::{AppHandle, Manager};

use super::{on_main_thread, RuntimeWindows, QUICK_WINDOW_LABEL};
use crate::errors::AppError;
use crate::services::platform::{InputRegion, PanelKeyboardMode};
use crate::state::AppState;

#[cfg(target_os = "linux")]
#[derive(Default)]
pub(super) struct LayerShellRuntimeState {
    pub(super) supported: bool,
    pub(super) keyboard: PanelKeyboardMode,
}

/// Keyboard mode of the quick window's layer surface, `None` when it is a
/// regular window.
pub(super) fn panel_layer(app: &AppHandle) -> Option<PanelKeyboardMode> {
    #[cfg(target_os = "linux")]
    {
        let layer = app.state::<LayerShellRuntimeState>();
        layer.supported.then_some(layer.keyboard)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
        None
    }
}

/// Limits pointer input of the visible quick window to `region`; the rest of
/// the window lets clicks through to the windows below. `None` restores input
/// over the whole window.
pub fn set_quick_input_region(
    app: &AppHandle,
    region: Option<InputRegion>,
    activation_id: u64,
) -> Result<(), AppError> {
    on_main_thread(app, move |app| {
        let snapshot = app.state::<AppState>().snapshot();
        let active_label = app.state::<RuntimeWindows>().active_label();
        // a late request must not narrow the window of the next session
        if !is_current_quick_activation(
            active_label,
            snapshot.window.is_window_shown,
            snapshot.activation.activation_id,
            activation_id,
        ) {
            return Ok(());
        }
        let Some(window) = app.get_webview_window(QUICK_WINDOW_LABEL) else {
            return Ok(());
        };
        crate::services::platform::set_panel_input_region(&window, region)
    })
}

pub(super) fn is_quick_window_shown(active_label: &str, is_window_shown: bool) -> bool {
    active_label == QUICK_WINDOW_LABEL && is_window_shown
}

pub(super) fn is_current_quick_activation(
    active_label: &str,
    is_window_shown: bool,
    current_id: u64,
    requested_id: u64,
) -> bool {
    is_quick_window_shown(active_label, is_window_shown) && current_id == requested_id
}

/// Leaves the exclusive grab once the quick window has the focus. Runs on the
/// main thread, as window events do.
#[cfg(target_os = "linux")]
pub(super) fn settle_quick_keyboard(app: &AppHandle) {
    let Some(keyboard) = panel_layer(app) else {
        return;
    };
    if let Some(window) = app.get_webview_window(QUICK_WINDOW_LABEL) {
        if let Err(error) = crate::services::platform::settle_panel_keyboard(&window, keyboard) {
            log::warn!("Could not release the keyboard grab: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::runtime::MAIN_WINDOW_LABEL;

    #[test]
    fn detects_only_the_visible_active_quick_window() {
        assert!(is_quick_window_shown(QUICK_WINDOW_LABEL, true));
        assert!(!is_quick_window_shown(QUICK_WINDOW_LABEL, false));
        assert!(!is_quick_window_shown(MAIN_WINDOW_LABEL, true));
    }

    #[test]
    fn quick_window_updates_belong_to_the_visible_current_activation() {
        assert!(is_current_quick_activation(QUICK_WINDOW_LABEL, true, 2, 2));
        assert!(!is_current_quick_activation(QUICK_WINDOW_LABEL, true, 2, 1));
        assert!(!is_current_quick_activation(
            QUICK_WINDOW_LABEL,
            false,
            2,
            2
        ));
        assert!(!is_current_quick_activation(MAIN_WINDOW_LABEL, true, 2, 2));
    }
}
