mod lifecycle;
mod tray;
mod warmup;

pub use lifecycle::{create_windows, setup, shutdown};

use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

pub use super::activation::Activation;
use super::activation::{StartMode, WindowProfile, WINDOW_SIZE};
use super::activation_coordinator::{ActivationCoordinator, ActivationHost};
use super::platform::{InputRegion, PanelKeyboard};

use tauri::{AppHandle, Emitter, Manager, WindowEvent};

use crate::errors::AppError;
use crate::state::AppState;
#[cfg(target_os = "linux")]
use gtk::prelude::WidgetExt;

pub const MAIN_WINDOW_LABEL: &str = "main";
pub const QUICK_WINDOW_LABEL: &str = "quick";
pub const STATE_CHANGED_EVENT: &str = "app://state-changed";
pub const OPEN_MAIN_EDITOR_EVENT: &str = "app://open-main-editor";
pub const OPEN_MAIN_CHAT_EVENT: &str = "app://open-main-chat";
/// The user closed the main window, as opposed to hiding it with a hotkey or
/// the tray: what was open in it is done with.
pub const MAIN_WINDOW_CLOSED_EVENT: &str = "app://main-window-closed";

pub fn emit_state(app: &AppHandle, state: &AppState) -> Result<(), AppError> {
    let snapshot = state.snapshot();
    app.emit(STATE_CHANGED_EVENT, snapshot)?;

    Ok(())
}

#[cfg(target_os = "linux")]
#[derive(Default)]
struct LayerShell {
    supported: bool,
    keyboard: PanelKeyboard,
}

/// Keyboard mode of the quick window's layer surface, `None` when it is a
/// regular window.
fn panel_layer(app: &AppHandle) -> Option<PanelKeyboard> {
    #[cfg(target_os = "linux")]
    {
        let layer = app.state::<LayerShell>();
        layer.supported.then_some(layer.keyboard)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
        None
    }
}

struct RuntimeWindows {
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
    fn active_label(&self) -> &'static str {
        *self
            .active_label
            .lock()
            .expect("window label lock poisoned")
    }

    fn set_active_label(&self, label: &'static str) {
        *self
            .active_label
            .lock()
            .expect("window label lock poisoned") = label;
    }
}

/// Execute window operations serially and return their actual result to the caller.
/// Tauri executes this closure inline when already on the main thread.
fn on_main_thread(
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
        .map_err(|error| AppError::Message(error.to_string()))?
}

struct RuntimeActivationHost<'a>(&'a AppHandle);

impl ActivationHost for RuntimeActivationHost<'_> {
    fn source_window(&self) -> Option<String> {
        super::platform::capture_source()
    }

    fn has_focused_window(&self) -> bool {
        has_focused_window(self.0)
    }

    fn user_config(&self) -> serde_json::Value {
        self.0.state::<AppState>().snapshot().settings.user_config
    }

    fn activate(&self, activation: Activation) -> Result<(), AppError> {
        on_main_thread(self.0, move |app| activate_on_main_thread(app, activation))
    }
}

pub fn activate(app: &AppHandle, activation: Activation) -> Result<(), AppError> {
    let request = app
        .state::<ActivationCoordinator>()
        .begin(&RuntimeActivationHost(app), activation)?;
    if let Some(request) = request {
        let handle = app.clone();
        thread::spawn(move || {
            let selected_text = tauri::async_runtime::block_on(super::platform::capture_selection(
                request.source.clone(),
            ));
            if let Err(error) = on_main_thread(&handle, move |app| {
                app.state::<ActivationCoordinator>().publish(&request, || {
                    let state = app.state::<AppState>();
                    state.update_state(|params| {
                        params.activation.selected_text.clone_from(&selected_text)
                    });
                    emit_state(app, &state)
                })
            }) {
                log::warn!("Could not publish captured foreground context: {error}");
            }
        });
    }
    Ok(())
}

/// Waits until no Tyco window has keyboard focus. Once the compositor takes
/// it away, it has handed it to another window, so input can follow. Gives up
/// silently after `timeout`: the caller still waits for its target window.
pub fn wait_until_unfocused(app: &AppHandle, timeout: Duration) {
    wait_until_unfocused_with(
        timeout,
        || has_focused_window(app),
        Instant::now,
        thread::sleep,
    );
}

fn wait_until_unfocused_with(
    timeout: Duration,
    focused: impl Fn() -> bool,
    now: impl Fn() -> Instant,
    pause: impl Fn(Duration),
) {
    let deadline = now() + timeout;
    while focused() && now() < deadline {
        pause(Duration::from_millis(10));
    }
}

fn has_focused_window(app: &AppHandle) -> bool {
    app.webview_windows()
        .values()
        .any(|window| window.is_focused().unwrap_or(false))
}

/// The target window was closed: nothing can be inserted into it any more.
pub fn forget_target_window(app: &AppHandle, window_id: &str) -> Result<(), AppError> {
    let state = app.state::<AppState>();
    if state.snapshot().activation.window_id.as_deref() != Some(window_id) {
        return Ok(());
    }
    state.update_state(|params| {
        if params.activation.window_id.as_deref() == Some(window_id) {
            params.activation.window_id = None;
        }
    });
    emit_state(app, &state)
}

/// While the main window is shown, text goes to the application window the
/// user worked in last rather than the one Tyco was opened from: the main
/// window stays open while the user switches between applications. Only a
/// known window replaces the target; focusing the desktop or a panel keeps it.
pub fn follow_target_window(app: &AppHandle) -> Result<(), AppError> {
    let Some(target) = super::platform::window_tracker::tracker().target() else {
        return Ok(());
    };
    let active_label = app.state::<RuntimeWindows>().active_label();
    let state = app.state::<AppState>();
    let mut changed = false;
    state.update_state(|params| {
        if is_main_window_shown(active_label, params.window.is_window_shown)
            && params.activation.window_id.as_ref() != Some(&target)
        {
            params.activation.window_id = Some(target);
            changed = true;
        }
    });
    if changed {
        emit_state(app, &state)?;
    }
    Ok(())
}

fn is_main_window_shown(active_label: &str, is_window_shown: bool) -> bool {
    active_label == MAIN_WINDOW_LABEL && is_window_shown
}

fn activate_on_main_thread(app: &AppHandle, activation: Activation) -> Result<(), AppError> {
    let window_label = window_label_for_mode(activation.mode);
    let is_quick_window = window_label == QUICK_WINDOW_LABEL;
    app.state::<RuntimeWindows>().set_active_label(window_label);
    hide_inactive_window(app, window_label)?;
    let window = app
        .get_webview_window(window_label)
        .ok_or_else(|| AppError::Message(format!("Window {window_label} not found")))?;
    let state = app.state::<AppState>();

    // the warmup may have left the window transparent
    #[cfg(target_os = "linux")]
    window.gtk_window()?.set_opacity(1.0);

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
    } else if !(activation.mode == StartMode::VoiceChat && window.is_visible()?) {
        // a follow-up voice question must not move the chat the user placed
        window.set_size(tauri::LogicalSize::new(width, height))?;
        window.set_decorations(true)?;
        window.set_resizable(true)?;
        window.center()?;
    }
    window.set_focusable(true)?;
    window.show()?;
    super::activation_metrics::mark_show(app);
    if let Err(error) = window.unminimize() {
        log::warn!("Could not unminimize window: {error}");
    }
    if let Err(error) = window.set_focus() {
        log::warn!("Could not focus window: {error}");
    }

    state.update_state(|params| {
        params.activation.activation_id = params.activation.activation_id.wrapping_add(1);
        params.activation.mode = Some(activation.mode);
        params.activation.window_id = activation.window_id;
        params.activation.selected_text = activation.selected_text;
        params.activation.launcher_page = activation.launcher_page;
        params.activation.launcher_request = activation.launcher_request;
        params.activation.access_request = activation.access_request;
        params.window.is_window_shown = true;
        params.window.window_profile = activation.mode.profile();
    });
    log::debug!(
        "Activated {:?} from {:?}",
        activation.mode,
        activation.source
    );
    emit_state(app, &state)
}

fn window_label_for_mode(mode: StartMode) -> &'static str {
    match mode {
        StartMode::Write
        | StartMode::Voice
        | StartMode::Select
        | StartMode::AiTasks
        | StartMode::CommandLauncher
        | StartMode::Correction
        | StartMode::VoiceChat
        | StartMode::Translate
        | StartMode::ExternalAccess => QUICK_WINDOW_LABEL,
        StartMode::Editor | StartMode::Chat | StartMode::History | StartMode::Config => {
            MAIN_WINDOW_LABEL
        }
    }
}

fn hide_inactive_window(app: &AppHandle, active_label: &str) -> Result<(), AppError> {
    let inactive_label = if active_label == MAIN_WINDOW_LABEL {
        QUICK_WINDOW_LABEL
    } else {
        MAIN_WINDOW_LABEL
    };
    let Some(window) = app.get_webview_window(inactive_label) else {
        return Ok(());
    };

    #[cfg(target_os = "linux")]
    if inactive_label == QUICK_WINDOW_LABEL && app.state::<LayerShell>().supported {
        super::platform::disable_panel_keyboard(&window)?;
    }

    window.hide()?;
    Ok(())
}

/// Shows the main window from the tray or a launch without a mode. The window
/// Tyco was last activated from may be long gone from the user's mind, so the
/// target is taken anew, the way an activation takes it.
pub fn show_application(app: &AppHandle) -> Result<(), AppError> {
    let window_id = super::platform::capture_source();
    on_main_thread(app, move |app| {
        app.state::<AppState>()
            .update_state(|params| params.activation.window_id = window_id);
        show_application_on_main_thread(app)
    })
}

pub fn open_main_editor(
    app: &AppHandle,
    text: Option<String>,
    source_text: Option<String>,
) -> Result<(), AppError> {
    show_main_with(
        app,
        StartMode::Editor,
        OPEN_MAIN_EDITOR_EVENT,
        serde_json::json!({ "text": text, "sourceText": source_text }),
    )
}

pub fn open_main_chat(
    app: &AppHandle,
    attachment: Option<crate::models::ChatAttachment>,
    question: Option<String>,
    auto_send: Option<bool>,
) -> Result<(), AppError> {
    show_main_with(
        app,
        StartMode::Chat,
        OPEN_MAIN_CHAT_EVENT,
        serde_json::to_value(crate::models::OpenMainChatEvent {
            attachment,
            question,
            auto_send: auto_send.unwrap_or(false),
        })?,
    )
}

/// Shows the main window and hands `payload` over to it.
fn show_main_with(
    app: &AppHandle,
    mode: StartMode,
    event: &'static str,
    payload: serde_json::Value,
) -> Result<(), AppError> {
    on_main_thread(app, move |app| {
        show_application_mode_on_main_thread(app, mode)?;
        let window = app
            .get_webview_window(MAIN_WINDOW_LABEL)
            .ok_or_else(|| AppError::Message("Main window not found".into()))?;
        window.emit(event, payload)?;
        Ok(())
    })
}

/// Limits pointer input of the visible quick window to `region`; the rest of
/// the window lets clicks through to the windows below. `None` restores input
/// over the whole window.
pub fn set_quick_input_region(
    app: &AppHandle,
    region: Option<InputRegion>,
) -> Result<(), AppError> {
    on_main_thread(app, move |app| {
        let is_shown = app.state::<AppState>().snapshot().window.is_window_shown;
        let active_label = app.state::<RuntimeWindows>().active_label();
        // a late request must not narrow the window of the next session
        if region.is_some() && !is_quick_window_shown(active_label, is_shown) {
            return Ok(());
        }
        let Some(window) = app.get_webview_window(QUICK_WINDOW_LABEL) else {
            return Ok(());
        };
        super::platform::set_panel_input_region(&window, region)
    })
}

fn is_quick_window_shown(active_label: &str, is_window_shown: bool) -> bool {
    active_label == QUICK_WINDOW_LABEL && is_window_shown
}

fn show_application_on_main_thread(app: &AppHandle) -> Result<(), AppError> {
    show_application_mode_on_main_thread(app, StartMode::Editor)
}

fn show_application_mode_on_main_thread(app: &AppHandle, mode: StartMode) -> Result<(), AppError> {
    app.state::<RuntimeWindows>()
        .set_active_label(MAIN_WINDOW_LABEL);
    hide_inactive_window(app, MAIN_WINDOW_LABEL)?;

    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| AppError::Message("Main window not found".into()))?;
    let state = app.state::<AppState>();

    window.set_decorations(true)?;
    window.set_resizable(true)?;
    window.set_focusable(true)?;
    window.show()?;
    if let Err(error) = window.unminimize() {
        log::warn!("Could not unminimize window: {error}");
    }
    if let Err(error) = window.set_focus() {
        log::warn!("Could not focus window: {error}");
    }

    state.update_state(|params| {
        params.activation.activation_id = params.activation.activation_id.wrapping_add(1);
        params.activation.selected_text = None;
        params.activation.mode = Some(mode);
        params.window.is_window_shown = true;
        params.window.window_profile = WindowProfile::Sheet;
    });
    log::debug!("Showed main application with mode {}", mode.as_str());
    emit_state(app, &state)
}

pub fn dismiss_quick_window(app: &AppHandle) -> Result<(), AppError> {
    on_main_thread(app, |app| {
        let is_shown = app.state::<AppState>().snapshot().window.is_window_shown;
        let active_label = app.state::<RuntimeWindows>().active_label();
        if !is_quick_window_shown(active_label, is_shown) {
            return Ok(());
        }
        hide_on_main_thread(app)
    })
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
        .ok_or_else(|| AppError::Message(format!("Window {label} not found")))?;

    #[cfg(target_os = "linux")]
    if label == QUICK_WINDOW_LABEL && app.state::<LayerShell>().supported {
        super::platform::disable_panel_keyboard(&window)?;
    }

    state.update_state(|params| {
        params.window.is_window_shown = false;
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
                        if let Err(error) =
                            app.emit_to(MAIN_WINDOW_LABEL, MAIN_WINDOW_CLOSED_EVENT, ())
                        {
                            log::warn!("Could not report the closed main window: {error}");
                        }
                    } else if window_label == QUICK_WINDOW_LABEL {
                        app.state::<RuntimeWindows>()
                            .set_active_label(QUICK_WINDOW_LABEL);
                    }
                    if let Err(error) = hide_active_window(app) {
                        log::error!("Could not hide the {window_label} window: {error}");
                    }
                }
            }
            WindowEvent::Focused(true) => {
                super::activation_metrics::mark_os_focus(app);
                #[cfg(target_os = "linux")]
                if window_label == QUICK_WINDOW_LABEL {
                    settle_quick_keyboard(app);
                }
            }
            WindowEvent::Focused(false) => {}
            WindowEvent::Destroyed => {
                state
                    .chat_images
                    .lock()
                    .expect("chat image lock poisoned")
                    .release_owner(window_label);
            }
            _ => {}
        }
    }
}

/// Leaves the exclusive grab once the quick window has the focus. Runs on the
/// main thread, as window events do.
#[cfg(target_os = "linux")]
fn settle_quick_keyboard(app: &AppHandle) {
    let Some(keyboard) = panel_layer(app) else {
        return;
    };
    if let Some(window) = app.get_webview_window(QUICK_WINDOW_LABEL) {
        if let Err(error) = super::platform::settle_panel_keyboard(&window, keyboard) {
            log::warn!("Could not release the keyboard grab: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn focus_wait_stops_when_focus_is_released_or_the_deadline_is_reached() {
        use std::cell::Cell;
        for release_after in [Some(2), None] {
            let elapsed = Cell::new(Duration::ZERO);
            let polls = Cell::new(0);
            let start = Instant::now();
            wait_until_unfocused_with(
                Duration::from_millis(30),
                || release_after.is_none_or(|limit| polls.get() < limit),
                || start + elapsed.get(),
                |duration| {
                    elapsed.set(elapsed.get() + duration);
                    polls.set(polls.get() + 1);
                },
            );
            assert_eq!(polls.get(), release_after.unwrap_or(3));
        }
        wait_until_unfocused_with(
            Duration::from_secs(1),
            || false,
            Instant::now,
            |_| panic!("unfocused window must not wait"),
        );
        wait_until_unfocused_with(
            Duration::ZERO,
            || true,
            Instant::now,
            |_| panic!("expired deadline must not wait"),
        );
    }

    use super::*;

    #[test]
    fn quick_modes_use_the_quick_window_and_main_modes_use_the_main_window() {
        for mode in [
            StartMode::Write,
            StartMode::Voice,
            StartMode::Select,
            StartMode::AiTasks,
            StartMode::CommandLauncher,
            StartMode::Correction,
            StartMode::VoiceChat,
            StartMode::Translate,
            StartMode::ExternalAccess,
        ] {
            assert_eq!(window_label_for_mode(mode), QUICK_WINDOW_LABEL);
        }
        for mode in [
            StartMode::Editor,
            StartMode::Chat,
            StartMode::History,
            StartMode::Config,
        ] {
            assert_eq!(window_label_for_mode(mode), MAIN_WINDOW_LABEL);
        }
    }

    #[test]
    fn follows_the_target_only_while_the_main_window_is_shown() {
        assert!(is_main_window_shown(MAIN_WINDOW_LABEL, true));
        assert!(!is_main_window_shown(MAIN_WINDOW_LABEL, false));
        assert!(!is_main_window_shown(QUICK_WINDOW_LABEL, true));
    }

    #[test]
    fn detects_only_the_visible_active_quick_window() {
        assert!(is_quick_window_shown(QUICK_WINDOW_LABEL, true));
        assert!(!is_quick_window_shown(QUICK_WINDOW_LABEL, false));
        assert!(!is_quick_window_shown(MAIN_WINDOW_LABEL, true));
    }
}

/// A committed state change stays successful even if its notification fails.
pub fn publish_state(app: &AppHandle, state: &AppState) {
    if let Err(error) = emit_state(app, state) {
        log::warn!("Could not publish desktop state: {error}");
    }
}

/// Hides only the requesting window, never a window activated while waiting.
pub fn hide_window(app: &AppHandle, label: String, activation_id: u64) -> Result<(), AppError> {
    on_main_thread(app, move |app| {
        let state = app.state::<AppState>();
        let params = state.snapshot();
        if !matches_window_activation(
            app.state::<RuntimeWindows>().active_label(),
            params.activation.activation_id,
            &label,
            activation_id,
        ) {
            return Err(AppError::InvalidInput(
                "The window activation is no longer current".into(),
            ));
        }
        hide_on_main_thread(app)
    })
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
    use super::matches_window_activation;

    #[test]
    fn delayed_operations_cannot_hide_a_different_window_or_activation() {
        assert!(matches_window_activation("quick", 4, "quick", 4));
        assert!(!matches_window_activation("main", 4, "quick", 4));
        assert!(!matches_window_activation("quick", 5, "quick", 4));
    }
}
