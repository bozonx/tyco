use crate::locks::MutexExt;
mod lifecycle;
mod panel_layer;
pub mod settings_shutdown;
mod target_focus;
mod target_paste;
mod tray;
mod warmup;
mod window_visibility;

pub use lifecycle::{create_windows, manage_state, request_exit, setup, shutdown};
pub use panel_layer::set_quick_input_region;
pub use target_focus::{follow_target_window, forget_target_window, wait_until_unfocused};
pub use target_paste::paste_into_target;
pub use tray::set_tray_menu_labels;
pub use window_visibility::{
    handle_window_event, hide_active_window, hide_quick_window_on_blur, hide_window,
    open_main_chat, open_main_editor, show_application,
};

use self::panel_layer::{is_quick_window_shown, panel_layer, PanelLayerState};
use self::target_focus::has_focused_window;
use self::window_visibility::hide_inactive_window;

use std::sync::Mutex;

use super::activation::coordinator::{ActivationCoordinator, ActivationHost};
pub use super::activation::Activation;
use super::activation::{ActivationMode, WindowProfile, WINDOW_SIZE};
use super::platform::PanelKeyboardMode;

use tauri::{AppHandle, Manager};

use crate::errors::AppError;
use crate::state::AppState;

pub const MAIN_WINDOW_LABEL: &str = "main";
pub const QUICK_WINDOW_LABEL: &str = "quick";

pub fn emit_state(app: &AppHandle, state: &AppState) -> Result<(), AppError> {
    let snapshot = state.snapshot();
    crate::events::emit::<crate::events::StateChanged, _>(app, snapshot)?;

    Ok(())
}

/// A committed state change stays successful even if its notification fails.
pub fn publish_state(app: &AppHandle, state: &AppState) {
    if let Err(error) = emit_state(app, state) {
        log::warn!("Could not publish desktop state: {error}");
    }
}

pub(super) struct RuntimeWindows {
    active_label: Mutex<&'static str>,
}

impl Default for RuntimeWindows {
    fn default() -> Self {
        Self {
            active_label: Mutex::new(MAIN_WINDOW_LABEL),
        }
    }
}

impl RuntimeWindows {
    pub(super) fn active_label(&self) -> &'static str {
        *self.active_label.locked()
    }

    pub(super) fn set_active_label(&self, label: &'static str) {
        *self.active_label.locked() = label;
    }
}

/// Execute window operations serially and return their actual result to the caller.
/// Tauri executes this closure inline when already on the main thread.
pub(super) fn on_main_thread(
    app: &AppHandle,
    action: impl FnOnce(&AppHandle) -> Result<(), AppError> + Send + 'static,
) -> Result<(), AppError> {
    let handle = app.clone();
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let _ = sender.send(action(&handle));
    })?;
    receiver
        .recv()
        .map_err(|error| AppError::Failed(error.to_string()))?
}

struct RuntimeActivationHost<'a> {
    app: &'a AppHandle,
    foreground_target: Option<super::platform::ForegroundTarget>,
}

impl ActivationHost for RuntimeActivationHost<'_> {
    fn foreground_target(&self) -> Option<super::platform::ForegroundTarget> {
        self.foreground_target.clone()
    }

    fn has_focused_window(&self) -> bool {
        has_focused_window(self.app)
    }

    fn user_config(&self) -> std::sync::Arc<serde_json::Value> {
        self.app.state::<AppState>().user_config()
    }

    fn activate(&self, activation: Activation) -> Result<(), AppError> {
        activate_on_main_thread(self.app, activation)
    }
}

pub fn activate(app: &AppHandle, activation: Activation) -> Result<(), AppError> {
    let foreground_target = if activation.target_window_id.is_none() {
        super::platform::capture_foreground_target()
    } else {
        None
    };
    let handle = app.clone();
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    // Generation allocation and window mutation share the main-thread queue.
    // Never hold the coordinator lock while waiting for that queue.
    app.run_on_main_thread(move || {
        if handle.state::<AppState>().is_quitting() {
            let _ = sender.send(Err(AppError::ServiceUnavailable(
                "Application is stopping".into(),
            )));
            return;
        }
        let snapshot = handle.state::<AppState>().snapshot();
        if activation
            .finishes_open_voice_input(snapshot.activation.mode, snapshot.window.is_window_shown)
        {
            let result = crate::events::emit_to::<crate::events::VoiceFinish, _>(
                &handle,
                QUICK_WINDOW_LABEL,
                snapshot.activation.activation_id,
            )
            .map(|()| None)
            .map_err(AppError::from);
            let _ = sender.send(result);
            return;
        }
        let result = handle.state::<ActivationCoordinator>().begin(
            &RuntimeActivationHost {
                app: &handle,
                foreground_target,
            },
            activation,
        );
        let _ = sender.send(result);
    })?;
    let request = receiver
        .recv()
        .map_err(|error| AppError::Failed(error.to_string()))??;
    if let Some(request) = request {
        let handle = app.clone();
        let services = app.state::<super::background::BackgroundServices>();
        services.spawn_thread("activation-selection", move |stop| {
            if stop.is_stopped() {
                return;
            }
            let selected_text = tauri::async_runtime::block_on(super::platform::capture_selection(
                request.foreground_target.clone(),
            ));
            if stop.is_stopped() {
                return;
            }
            if let Err(error) = on_main_thread(&handle, move |app| {
                app.state::<ActivationCoordinator>().publish(&request, || {
                    let state = app.state::<AppState>();
                    state.update_snapshot(|snapshot| {
                        snapshot.activation.selected_text.clone_from(&selected_text)
                    });
                    emit_state(app, &state)
                })
            }) {
                log::warn!("Could not publish captured foreground context: {error}");
            }
        })?;
    }
    Ok(())
}

fn activate_on_main_thread(app: &AppHandle, activation: Activation) -> Result<(), AppError> {
    let window_label = window_label_for_mode(activation.mode);
    let is_quick_window = window_label == QUICK_WINDOW_LABEL;
    app.state::<RuntimeWindows>().set_active_label(window_label);
    hide_inactive_window(app, window_label)?;
    let window = app
        .get_webview_window(window_label)
        .ok_or_else(|| AppError::ServiceUnavailable(format!("Window {window_label} not found")))?;
    let state = app.state::<AppState>();

    // the warmup may have left the window transparent
    super::platform::set_window_opacity(&window, 1.0)?;

    let (width, height) = WINDOW_SIZE;
    if is_quick_window {
        let layer = panel_layer(app);
        // a layer surface takes its size from `apply_panel_surface`
        if layer.is_none() {
            window.set_size(tauri::LogicalSize::new(width, height))?;
            window.set_decorations(false)?;
        }
        // a region left by the previous session must not hide the new content
        super::platform::set_panel_input_region(&window, None)?;
        super::platform::apply_panel_surface(&window, activation.mode.profile(), layer)?;
    } else if !(activation.mode == ActivationMode::VoiceChat && window.is_visible()?) {
        // a follow-up voice question must not move the chat the user placed
        window.set_size(tauri::LogicalSize::new(width, height))?;
        window.set_decorations(true)?;
        window.set_resizable(true)?;
        window.center()?;
    }
    window.set_focusable(true)?;
    window.show()?;
    super::activation::metrics::mark_show(app);
    if let Err(error) = window.unminimize() {
        log::warn!("Could not unminimize window: {error}");
    }
    if let Err(error) = window.set_focus() {
        log::warn!("Could not focus window: {error}");
    }

    state.update_snapshot(|snapshot| {
        snapshot.activation.activation_id = snapshot.activation.activation_id.wrapping_add(1);
        snapshot.activation.mode = Some(activation.mode);
        snapshot.activation.target_window_id = activation.target_window_id;
        snapshot.activation.selected_text = activation.selected_text;
        snapshot.activation.launcher_page_id = activation.launcher_page_id;
        snapshot.activation.launcher_request = activation.launcher_request;
        snapshot.activation.access_request = activation.access_request;
        snapshot.window.is_window_shown = true;
        snapshot.window.window_profile = activation.mode.profile();
    });
    log::debug!(
        "Activated {:?} from {:?}",
        activation.mode,
        activation.source
    );
    emit_state(app, &state)
}

fn window_label_for_mode(mode: ActivationMode) -> &'static str {
    match mode {
        ActivationMode::QuickInput
        | ActivationMode::Voice
        | ActivationMode::SelectionActions
        | ActivationMode::AiTasks
        | ActivationMode::VoiceCommands
        | ActivationMode::CommandLauncher
        | ActivationMode::Correction
        | ActivationMode::VoiceChat
        | ActivationMode::Translation
        | ActivationMode::ExternalAccess => QUICK_WINDOW_LABEL,
        ActivationMode::Editor
        | ActivationMode::Chat
        | ActivationMode::History
        | ActivationMode::Config => MAIN_WINDOW_LABEL,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quick_modes_use_the_quick_window_and_main_modes_use_the_main_window() {
        for mode in [
            ActivationMode::QuickInput,
            ActivationMode::Voice,
            ActivationMode::SelectionActions,
            ActivationMode::AiTasks,
            ActivationMode::CommandLauncher,
            ActivationMode::Correction,
            ActivationMode::VoiceChat,
            ActivationMode::Translation,
            ActivationMode::ExternalAccess,
        ] {
            assert_eq!(window_label_for_mode(mode), QUICK_WINDOW_LABEL);
        }
        for mode in [
            ActivationMode::Editor,
            ActivationMode::Chat,
            ActivationMode::History,
            ActivationMode::Config,
        ] {
            assert_eq!(window_label_for_mode(mode), MAIN_WINDOW_LABEL);
        }
    }
}
