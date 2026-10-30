use tauri::{AppHandle, Manager, WindowEvent};

use super::panel_layer::is_current_quick_activation;
use super::panel_layer::{settle_quick_keyboard, PanelLayerState};
use super::{emit_state, on_main_thread, RuntimeWindows, MAIN_WINDOW_LABEL, QUICK_WINDOW_LABEL};
use crate::errors::AppError;
use crate::events::{self, DesktopEvent};
use crate::services::activation::coordinator::ActivationCoordinator;
use crate::services::activation::{ActivationMode, WindowProfile};
use crate::state::AppState;

pub(super) fn hide_inactive_window(app: &AppHandle, active_label: &str) -> Result<(), AppError> {
    let inactive_label = if active_label == MAIN_WINDOW_LABEL {
        QUICK_WINDOW_LABEL
    } else {
        MAIN_WINDOW_LABEL
    };
    let Some(window) = app.get_webview_window(inactive_label) else {
        return Ok(());
    };

    if inactive_label == QUICK_WINDOW_LABEL && app.state::<PanelLayerState>().supported {
        crate::services::platform::disable_panel_keyboard(&window)?;
    }

    window.hide()?;
    Ok(())
}

/// Shows the main window from the tray or a launch without a mode. The window
/// Tyco was last activated from may be long gone from the user's mind, so the
/// target is taken anew, the way an activation takes it.
pub fn show_application(app: &AppHandle) -> Result<(), AppError> {
    let target_window_id = crate::services::platform::capture_foreground_target()
        .map(crate::services::platform::ForegroundTarget::into_platform_id);
    on_main_thread(app, move |app| {
        app.state::<AppState>()
            .update_snapshot(|snapshot| snapshot.activation.target_window_id = target_window_id);
        show_application_on_main_thread(app)
    })
}

pub fn open_main_editor(
    app: &AppHandle,
    text: Option<String>,
    source_text: Option<String>,
    activation_id: u64,
) -> Result<(), AppError> {
    show_main_with::<events::OpenMainEditor>(
        app,
        ActivationMode::Editor,
        events::EditorTransfer { text, source_text },
        activation_id,
    )
}

pub fn open_main_chat(
    app: &AppHandle,
    attachment: Option<crate::models::ChatAttachment>,
    question: Option<String>,
    auto_send: Option<bool>,
    activation_id: u64,
) -> Result<(), AppError> {
    show_main_with::<events::OpenMainChat>(
        app,
        ActivationMode::Chat,
        crate::models::OpenMainChatEvent {
            attachment,
            question,
            auto_send: auto_send.unwrap_or(false),
        },
        activation_id,
    )
}

/// Shows the main window and hands `payload` over to it.
fn show_main_with<E: DesktopEvent>(
    app: &AppHandle,
    mode: ActivationMode,
    payload: E::Payload,
    activation_id: u64,
) -> Result<(), AppError>
where
    E::Payload: Send + 'static,
{
    on_main_thread(app, move |app| {
        if app.state::<AppState>().snapshot().activation.activation_id != activation_id {
            return Err(AppError::Stale(
                "The window activation is no longer current".into(),
            ));
        }
        show_application_mode_on_main_thread(app, mode)?;
        let window = app
            .get_webview_window(MAIN_WINDOW_LABEL)
            .ok_or_else(|| AppError::ServiceUnavailable("Main window not found".into()))?;
        events::emit::<E, _>(&window, payload)?;
        Ok(())
    })
}

fn show_application_on_main_thread(app: &AppHandle) -> Result<(), AppError> {
    show_application_mode_on_main_thread(app, ActivationMode::Editor)
}

fn show_application_mode_on_main_thread(
    app: &AppHandle,
    mode: ActivationMode,
) -> Result<(), AppError> {
    // a capture started for an earlier activation must not put its text
    // into the view shown now
    app.state::<ActivationCoordinator>().invalidate();
    app.state::<RuntimeWindows>()
        .set_active_label(MAIN_WINDOW_LABEL);
    hide_inactive_window(app, MAIN_WINDOW_LABEL)?;

    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| AppError::ServiceUnavailable("Main window not found".into()))?;
    let state = app.state::<AppState>();

    // When the main window is already shown on another virtual desktop or in
    // the background, hiding it before showing it again unmaps its surface so
    // the compositor places the remapped window on the current desktop.
    if state.snapshot().window.is_window_shown && !super::target_focus::has_focused_window(app) {
        let _ = window.hide();
    }

    window.set_decorations(true)?;
    window.set_resizable(true)?;
    window.set_focusable(true)?;
    window.show()?;
    if let Err(error) = window.unminimize() {
        log::warn!("Could not unminimize window: {error}");
    }
    if let Err(error) = crate::services::platform::focus_window(&window) {
        log::warn!("Could not focus window: {error}");
    }

    state.update_snapshot(|snapshot| {
        snapshot.activation.activation_id = snapshot.activation.activation_id.wrapping_add(1);
        snapshot.activation.selected_text = None;
        snapshot.activation.mode = Some(mode);
        snapshot.window.is_window_shown = true;
        snapshot.window.window_profile = WindowProfile::Sheet;
    });
    log::debug!("Showed main application with mode {}", mode.as_str());
    emit_state(app, &state)
}

pub fn hide_quick_window_on_blur(app: &AppHandle, activation_id: u64) -> Result<(), AppError> {
    on_main_thread(app, move |app| {
        let snapshot = app.state::<AppState>().snapshot();
        let active_label = app.state::<RuntimeWindows>().active_label();
        if !is_current_quick_activation(
            active_label,
            snapshot.window.is_window_shown,
            snapshot.activation.activation_id,
            activation_id,
        ) {
            return Ok(());
        }
        let window = app
            .get_webview_window(QUICK_WINDOW_LABEL)
            .ok_or_else(|| AppError::ServiceUnavailable("Quick window not found".into()))?;
        if !should_dismiss_after_blur(
            window.is_focused()?,
            crate::services::platform::is_panel_relocating(),
        ) {
            return Ok(());
        }
        hide_on_main_thread(app)
    })
}

fn should_dismiss_after_blur(is_focused: bool, is_relocating: bool) -> bool {
    !is_focused && !is_relocating
}

/// Hides whichever Tyco window is active.
pub fn hide_active_window(app: &AppHandle) -> Result<(), AppError> {
    on_main_thread(app, hide_on_main_thread)
}

fn hide_on_main_thread(app: &AppHandle) -> Result<(), AppError> {
    let state = app.state::<AppState>();
    let label = app.state::<RuntimeWindows>().active_label();
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| AppError::ServiceUnavailable(format!("Window {label} not found")))?;

    if label == QUICK_WINDOW_LABEL && app.state::<PanelLayerState>().supported {
        crate::services::platform::disable_panel_keyboard(&window)?;
    }

    state.update_snapshot(|snapshot| {
        snapshot.window.is_window_shown = false;
    });

    window.hide()?;
    emit_state(app, &state)
}

pub fn handle_window_event(app: &AppHandle, window_label: &str, event: &WindowEvent) {
    if let Some(state) = app.try_state::<AppState>() {
        match event {
            WindowEvent::CloseRequested { api, .. } => {
                if !state.is_quitting() {
                    api.prevent_close();
                    if window_label == MAIN_WINDOW_LABEL {
                        app.state::<RuntimeWindows>()
                            .set_active_label(MAIN_WINDOW_LABEL);
                        if let Err(error) = events::emit_to::<events::MainWindowClosed, _>(
                            app,
                            MAIN_WINDOW_LABEL,
                            (),
                        ) {
                            log::warn!("Could not report the closed main window: {error}");
                        }
                        if let Err(error) = hide_active_window(app) {
                            log::error!("Could not hide the {window_label} window: {error}");
                        }
                    } else if window_label == QUICK_WINDOW_LABEL {
                        app.state::<RuntimeWindows>()
                            .set_active_label(QUICK_WINDOW_LABEL);
                        let activation_id = state.snapshot().activation.activation_id;
                        if let Err(error) =
                            hide_window(app, QUICK_WINDOW_LABEL.into(), activation_id)
                        {
                            log::error!("Could not hide the {window_label} window: {error}");
                        }
                    }
                }
            }
            WindowEvent::Focused(true) => {
                crate::services::activation::metrics::mark_os_focus(app);
                if window_label == QUICK_WINDOW_LABEL {
                    settle_quick_keyboard(app);
                }
            }
            WindowEvent::Focused(false) => {}
            WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) => {
                app.state::<crate::services::dropped_files::DroppedFiles>()
                    .record(window_label, paths);
            }
            WindowEvent::Destroyed => {
                app.state::<crate::services::dropped_files::DroppedFiles>()
                    .forget(window_label);
                app.state::<crate::services::chat_images::ChatImages>()
                    .lock()
                    .release_owner(window_label);
            }
            _ => {}
        }
    }
}

/// Hides only the requesting window, never a window activated while waiting,
/// and returns focus to the target window when the quick overlay is dismissed.
pub fn hide_window(app: &AppHandle, label: String, activation_id: u64) -> Result<(), AppError> {
    hide_window_with_refocus(app, label, activation_id, true)
}

/// Hides only the requesting window without restoring focus to the target
/// window, for flows that immediately activate another window or paste.
pub fn hide_window_without_refocus(
    app: &AppHandle,
    label: String,
    activation_id: u64,
) -> Result<(), AppError> {
    hide_window_with_refocus(app, label, activation_id, false)
}

fn hide_window_with_refocus(
    app: &AppHandle,
    label: String,
    activation_id: u64,
    restore_focus: bool,
) -> Result<(), AppError> {
    on_main_thread(app, move |app| {
        let state = app.state::<AppState>();
        let snapshot = state.snapshot();
        if !matches_window_activation(
            app.state::<RuntimeWindows>().active_label(),
            snapshot.activation.activation_id,
            &label,
            activation_id,
        ) {
            return Err(AppError::Stale(
                "The window activation is no longer current".into(),
            ));
        }
        let target = if should_restore_target_focus(
            restore_focus,
            &label,
            app.state::<PanelLayerState>().supported,
        ) {
            snapshot
                .activation
                .target_window_id
                .map(crate::services::platform::ForegroundTarget::from_platform_id)
        } else {
            None
        };
        hide_on_main_thread(app)?;
        if let Some(target) = target {
            let _ = app
                .state::<crate::services::background::BackgroundServices>()
                .spawn_thread("restore-target-focus", move |stop| {
                    if !stop.is_stopped() {
                        crate::services::platform::restore_foreground_target(&target);
                    }
                });
        }
        Ok(())
    })
}

fn should_restore_target_focus(
    restore_focus: bool,
    label: &str,
    layer_shell_supported: bool,
) -> bool {
    restore_focus && label == QUICK_WINDOW_LABEL && !layer_shell_supported
}

fn matches_window_activation(
    active_label: &str,
    current_id: u64,
    label: &str,
    activation_id: u64,
) -> bool {
    active_label == label && current_id == activation_id
}

#[cfg(test)]
mod window_command_tests {
    use super::{
        matches_window_activation, should_dismiss_after_blur, should_restore_target_focus,
    };

    #[test]
    fn output_relocation_and_delayed_blur_cannot_dismiss_a_recovered_panel() {
        assert!(!should_dismiss_after_blur(false, true));
        assert!(!should_dismiss_after_blur(true, false));
        assert!(should_dismiss_after_blur(false, false));
    }

    #[test]
    fn delayed_operations_cannot_hide_a_different_window_or_activation() {
        assert!(matches_window_activation("quick", 4, "quick", 4));
        assert!(!matches_window_activation("main", 4, "quick", 4));
        assert!(!matches_window_activation("quick", 5, "quick", 4));
    }

    #[test]
    fn restores_target_focus_only_for_non_layer_quick_window_dismissal() {
        assert!(should_restore_target_focus(true, "quick", false));
        assert!(!should_restore_target_focus(false, "quick", false));
        assert!(!should_restore_target_focus(true, "main", false));
        assert!(!should_restore_target_focus(true, "quick", true));
    }
}
