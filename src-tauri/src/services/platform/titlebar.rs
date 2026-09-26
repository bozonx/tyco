use tauri::WebviewWindow;

use crate::errors::AppError;

/// On Wayland tao wraps its client-side `HeaderBar` in an `EventBox` with
/// `above_child` set, so the box's input window covers the header and its
/// minimize, maximize and close buttons never get pointer events. Putting the
/// input window below the children hands the events back to the buttons.
#[cfg(target_os = "linux")]
pub fn enable_titlebar_buttons(window: &WebviewWindow) -> Result<(), AppError> {
    use gtk::prelude::*;

    let titlebar = window
        .gtk_window()?
        .titlebar()
        .and_then(|widget| widget.downcast::<gtk::EventBox>().ok());
    if let Some(event_box) = titlebar {
        event_box.set_above_child(false);
    }
    Ok(())
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub fn enable_titlebar_buttons(_window: &WebviewWindow) -> Result<(), AppError> {
    Ok(())
}
