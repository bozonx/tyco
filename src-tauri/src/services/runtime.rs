use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::thread;

pub use super::activation::Activation;
use super::activation::{ActivationIntent, StartMode, WINDOW_SIZE};
use super::platform::InputRegion;

use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager, WindowEvent};

use crate::errors::AppError;
use crate::state::AppState;
#[cfg(target_os = "linux")]
use gtk::prelude::WidgetExt;

pub const MAIN_WINDOW_LABEL: &str = "main";
pub const QUICK_WINDOW_LABEL: &str = "quick";
pub const PARAMS_CHANGED_EVENT: &str = "app://params-changed";
pub const CONTEXT_CAPTURED_EVENT: &str = "app://context-captured";
pub const OPEN_MAIN_EDITOR_EVENT: &str = "app://open-main-editor";
const TRAY_SHOW_ID: &str = "show";
const TRAY_QUIT_ID: &str = "quit";

pub fn emit_params(app: &AppHandle, state: &AppState) -> Result<(), AppError> {
    let params = state.params();
    let label = app.state::<RuntimeWindows>().active_label();

    if let Some(window) = app.get_webview_window(label) {
        window
            .emit(PARAMS_CHANGED_EVENT, params)
            .map_err(|error| AppError::Message(error.to_string()))?;
    }

    Ok(())
}

fn emit_captured_context(app: &AppHandle, selected_text: Option<String>) -> Result<(), AppError> {
    let label = app.state::<RuntimeWindows>().active_label();
    if let Some(window) = app.get_webview_window(label) {
        window
            .emit(
                CONTEXT_CAPTURED_EVENT,
                serde_json::json!({ "selectedText": selected_text }),
            )
            .map_err(|error| AppError::Message(error.to_string()))?;
    }
    Ok(())
}

#[derive(Default)]
struct ContextCapture {
    generation: AtomicU64,
}

#[cfg(target_os = "linux")]
#[derive(Default)]
struct LayerShell {
    supported: bool,
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

pub fn activate(app: &AppHandle, mut activation: Activation) -> Result<(), AppError> {
    let source = if activation.window_id.is_none() {
        super::platform::capture_source()
    } else {
        activation.window_id.clone()
    };
    if activation.window_id.is_none() {
        activation.window_id.clone_from(&source);
    }
    let capture_selection = activation.selected_text.is_none();
    let generation = app
        .state::<ContextCapture>()
        .generation
        .fetch_add(1, Ordering::SeqCst)
        + 1;

    on_main_thread(app, move |app| activate_on_main_thread(app, activation))?;

    if capture_selection {
        let handle = app.clone();
        thread::spawn(move || {
            let selected_text =
                tauri::async_runtime::block_on(super::platform::capture_selection(source));
            if let Err(error) = on_main_thread(&handle, move |app| {
                if app
                    .state::<ContextCapture>()
                    .generation
                    .load(Ordering::SeqCst)
                    != generation
                {
                    return Ok(());
                }
                let state = app.state::<AppState>();
                state.update_params(|params| params.selected_text.clone_from(&selected_text));
                emit_captured_context(app, selected_text)
            }) {
                log::warn!("Could not publish captured foreground context: {error}");
            }
        });
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
        .ok_or_else(|| AppError::Message(format!("Window {window_label} not found")))?;
    let state = app.state::<AppState>();

    #[cfg(target_os = "linux")]
    window.gtk_window()?.set_opacity(1.0);

    let (width, height) = WINDOW_SIZE;
    window.set_size(tauri::LogicalSize::new(width, height))?;

    #[cfg(target_os = "linux")]
    let has_layer_shell = app.state::<LayerShell>().supported;
    #[cfg(not(target_os = "linux"))]
    let has_layer_shell = false;

    if is_quick_window {
        window.set_decorations(false)?;
        // a region left by the previous session must not hide the new content
        super::platform::set_panel_input_region(&window, None)?;
        super::platform::apply_panel_surface(
            &window,
            activation.mode.profile(),
            activation.intent,
            has_layer_shell,
        )?;
    } else {
        window.set_decorations(true)?;
        window.set_resizable(true)?;
        window.center()?;
    }
    window.set_focusable(activation.intent == ActivationIntent::KeyboardFirst)?;
    window.show()?;
    super::activation_metrics::mark_show(app);
    if let Err(error) = window.unminimize() {
        log::warn!("Could not unminimize window: {error}");
    }
    if activation.intent == ActivationIntent::KeyboardFirst {
        if let Err(error) = window.set_focus() {
            log::warn!("Could not focus window: {error}");
        }
    }

    state.update_params(|params| {
        params.activation_id = params.activation_id.wrapping_add(1);
        params.mode = Some(activation.mode.as_str().into());
        params.window_id = activation.window_id;
        params.selected_text = activation.selected_text;
        params.is_window_shown = true;
        params.window_profile = match activation.mode.profile() {
            super::activation::WindowProfile::Panel => String::from("panel"),
            super::activation::WindowProfile::Sheet => String::from("sheet"),
        };
    });
    log::debug!(
        "Activated {:?} from {:?}",
        activation.mode,
        activation.source
    );
    emit_params(app, &state)
}

fn window_label_for_mode(mode: StartMode) -> &'static str {
    match mode {
        StartMode::Write
        | StartMode::Voice
        | StartMode::Select
        | StartMode::AiTasks
        | StartMode::Correction => QUICK_WINDOW_LABEL,
        StartMode::Editor | StartMode::Chat | StartMode::History | StartMode::Config => {
            MAIN_WINDOW_LABEL
        }
    }
}

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

pub fn show_application(app: &AppHandle) -> Result<(), AppError> {
    on_main_thread(app, show_application_on_main_thread)
}

pub fn open_main_editor(
    app: &AppHandle,
    text: Option<String>,
    source_text: Option<String>,
) -> Result<(), AppError> {
    on_main_thread(app, move |app| {
        show_application_on_main_thread(app)?;
        let window = app
            .get_webview_window(MAIN_WINDOW_LABEL)
            .ok_or_else(|| AppError::Message("Main window not found".into()))?;
        window
            .emit(
                OPEN_MAIN_EDITOR_EVENT,
                serde_json::json!({ "text": text, "sourceText": source_text }),
            )
            .map_err(|error| AppError::Message(error.to_string()))
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
        let is_shown = app.state::<AppState>().params().is_window_shown;
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

    state.update_params(|params| {
        params.mode = Some(StartMode::Editor.as_str().into());
        params.is_window_shown = true;
        params.window_profile = String::from("sheet");
    });
    log::debug!("Showed main application from tray");
    emit_params(app, &state)
}

pub fn dismiss_quick_window(app: &AppHandle) -> Result<(), AppError> {
    on_main_thread(app, |app| {
        let is_shown = app.state::<AppState>().params().is_window_shown;
        let active_label = app.state::<RuntimeWindows>().active_label();
        if !is_quick_window_shown(active_label, is_shown) {
            return Ok(());
        }
        hide_on_main_thread(app)
    })
}

pub fn hide_main_window(app: &AppHandle, _state: &AppState) -> Result<(), AppError> {
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

    state.update_params(|params| {
        params.is_window_shown = false;
    });

    window
        .hide()
        .map_err(|error| AppError::Message(error.to_string()))?;
    emit_params(app, &state)
}

pub fn setup(app: &mut App) -> Result<(), AppError> {
    app.manage(ContextCapture::default());
    app.manage(RuntimeWindows::default());
    let main_window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| AppError::Message("Main window not found".into()))?;
    super::platform::enable_titlebar_buttons(&main_window)?;
    #[cfg(target_os = "linux")]
    {
        let supported = super::platform::panel_surface_supported();
        if supported {
            let window = app
                .get_webview_window(QUICK_WINDOW_LABEL)
                .ok_or_else(|| AppError::Message("Quick window not found".into()))?;
            super::platform::attach_panel_surface(&window)?;
            log::info!("Using gtk-layer-shell for the quick window");
        } else {
            log::info!("gtk-layer-shell is unavailable; using a regular window");
        }
        app.manage(LayerShell { supported });
    }
    setup_tray(app)?;
    Ok(())
}

fn setup_tray(app: &mut App) -> Result<(), AppError> {
    let show_item = MenuItemBuilder::with_id(TRAY_SHOW_ID, "Показать приложение").build(app)?;
    let quit_item = MenuItemBuilder::with_id(TRAY_QUIT_ID, "Выход").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&show_item, &quit_item])
        .build()?;

    let app_handle = app.handle().clone();
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
                        let _ = show_application(app);
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
                    let params = state.params();
                    let result = match tray_click_action(params.is_window_shown) {
                        TrayClickAction::HideActiveWindow => hide_main_window(app, &state),
                        TrayClickAction::ShowApplication => show_application(app),
                    };

                    let _ = result;
                }
            }
        })
        .build(app)
        .map_err(|error| AppError::Message(error.to_string()))?;

    let _ = app_handle;

    Ok(())
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
                    } else if window_label == QUICK_WINDOW_LABEL {
                        app.state::<RuntimeWindows>()
                            .set_active_label(QUICK_WINDOW_LABEL);
                    }
                    let _ = hide_main_window(app, &state);
                }
            }
            WindowEvent::Focused(true) => super::activation_metrics::mark_os_focus(app),
            WindowEvent::Focused(false) => {}
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quick_modes_use_the_quick_window_and_main_modes_use_the_main_window() {
        for mode in [
            StartMode::Write,
            StartMode::Voice,
            StartMode::Select,
            StartMode::AiTasks,
            StartMode::Correction,
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
    fn tray_click_hides_a_visible_window_and_shows_the_application_otherwise() {
        assert_eq!(tray_click_action(true), TrayClickAction::HideActiveWindow);
        assert_eq!(tray_click_action(false), TrayClickAction::ShowApplication);
    }

    #[test]
    fn detects_only_the_visible_active_quick_window() {
        assert!(is_quick_window_shown(QUICK_WINDOW_LABEL, true));
        assert!(!is_quick_window_shown(QUICK_WINDOW_LABEL, false));
        assert!(!is_quick_window_shown(MAIN_WINDOW_LABEL, true));
    }
}
