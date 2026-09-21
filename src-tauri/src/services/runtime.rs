use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::{thread, time::Duration};

pub use super::activation::{Activation, ActivationIntent, ActivationSource, StartMode};

use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager, WindowEvent};

use crate::errors::AppError;
use crate::services::foreground_context::{ForegroundContext, SystemForegroundContext};
use crate::state::AppState;

pub const MAIN_WINDOW_LABEL: &str = "main";
pub const PARAMS_CHANGED_EVENT: &str = "app://params-changed";
pub const CONTEXT_CAPTURED_EVENT: &str = "app://context-captured";
pub const VOICE_TEXT_EVENT: &str = "app://voice-text";
const TRAY_SHOW_ID: &str = "show";
const TRAY_QUIT_ID: &str = "quit";

pub fn emit_params(app: &AppHandle, state: &AppState) -> Result<(), AppError> {
    let params = state.params();

    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        window
            .emit(PARAMS_CHANGED_EVENT, params)
            .map_err(|error| AppError::Message(error.to_string()))?;
    }

    Ok(())
}

pub fn emit_voice_text(app: &AppHandle, text: String) -> Result<(), AppError> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        window
            .emit(VOICE_TEXT_EVENT, text)
            .map_err(|error| AppError::Message(error.to_string()))?;
    }

    Ok(())
}

fn emit_captured_context(app: &AppHandle, selected_text: Option<String>) -> Result<(), AppError> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
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
struct Warmup {
    cancelled: AtomicBool,
}

#[derive(Default)]
struct ContextCapture {
    generation: AtomicU64,
}

impl Warmup {
    fn visibility(&self, step: usize, initially_visible: bool) -> Option<bool> {
        if self.cancelled.load(Ordering::SeqCst) {
            return None;
        }
        match step {
            0..=5 => Some(step.is_multiple_of(2)),
            6 if initially_visible => Some(true),
            _ => None,
        }
    }
}

fn cancel_warmup(app: &AppHandle) {
    if let Some(warmup) = app.try_state::<Warmup>() {
        warmup.cancelled.store(true, Ordering::SeqCst);
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
    let context = SystemForegroundContext::detect();
    let source = if activation.window_id.is_none() {
        context.capture_source()
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

    on_main_thread(app, move |app| {
        cancel_warmup(app);
        activate_on_main_thread(app, activation)
    })?;

    if capture_selection {
        let handle = app.clone();
        thread::spawn(move || {
            let selected_text = tauri::async_runtime::block_on(context.capture_selection(source));
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
    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| AppError::Message("Main window not found".into()))?;
    let state = app.state::<AppState>();

    // Native-window fallback; layer-shell will replace this in task 6.
    let (width, height) = activation.mode.profile().size();
    window.set_size(tauri::LogicalSize::new(width, height))?;
    window.center()?;
    window.set_focusable(activation.intent == ActivationIntent::KeyboardFirst)?;
    window.show()?;
    if let Err(error) = window.unminimize() {
        log::warn!("Could not unminimize window: {error}");
    }
    if activation.intent == ActivationIntent::KeyboardFirst {
        if let Err(error) = window.set_focus() {
            log::warn!("Could not focus window: {error}");
        }
    }

    state.update_params(|params| {
        params.mode = Some(activation.mode.as_str().into());
        params.window_id = activation.window_id;
        params.selected_text = activation.selected_text;
        params.is_window_shown = true;
    });
    log::debug!(
        "Activated {:?} from {:?}",
        activation.mode,
        activation.source
    );
    emit_params(app, &state)
}

fn schedule_warmup(app: &AppHandle) -> Result<(), AppError> {
    let initially_visible = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| AppError::Message("Main window not found".into()))?
        .is_visible()?;
    let handle = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(400));
        for step in 0..7 {
            let result = on_main_thread(&handle, move |app| {
                let Some(show) = app.state::<Warmup>().visibility(step, initially_visible) else {
                    return Ok(());
                };
                let window = app
                    .get_webview_window(MAIN_WINDOW_LABEL)
                    .ok_or_else(|| AppError::Message("Main window not found".into()))?;
                if show {
                    window.show()?;
                } else {
                    window.hide()?;
                }
                Ok(())
            });
            if let Err(error) = result {
                log::warn!("Window warmup failed: {error}");
                return;
            }
            if handle.state::<Warmup>().cancelled.load(Ordering::SeqCst) {
                return;
            }
            thread::sleep(Duration::from_millis(250));
        }
    });
    Ok(())
}

pub fn hide_main_window(app: &AppHandle, _state: &AppState) -> Result<(), AppError> {
    on_main_thread(app, |app| {
        cancel_warmup(app);
        hide_on_main_thread(app)
    })
}

fn hide_on_main_thread(app: &AppHandle) -> Result<(), AppError> {
    let state = app.state::<AppState>();
    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| AppError::Message(String::from("Main window not found")))?;

    state.update_params(|params| {
        params.is_window_shown = false;
    });

    window
        .hide()
        .map_err(|error| AppError::Message(error.to_string()))?;
    emit_params(app, &state)
}

pub fn setup(app: &mut App) -> Result<(), AppError> {
    app.manage(Warmup::default());
    app.manage(ContextCapture::default());
    setup_tray(app)?;
    schedule_warmup(app.handle())?;
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
                        let _ = activate(
                            app,
                            Activation::new(StartMode::Editor, ActivationSource::Tray),
                        );
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
                    let result = if params.is_window_shown {
                        hide_main_window(app, &state)
                    } else {
                        activate(
                            app,
                            Activation::new(StartMode::Editor, ActivationSource::Tray),
                        )
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

pub fn handle_window_event(app: &AppHandle, event: &WindowEvent) {
    if let Some(state) = app.try_state::<AppState>() {
        match event {
            WindowEvent::CloseRequested { api, .. } => {
                if !state.is_quitting() {
                    api.prevent_close();
                    let _ = hide_main_window(app, &state);
                }
            }
            WindowEvent::Focused(false) => {}
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn warmup_runs_three_cycles_and_restores_visibility() {
        let warmup = Warmup::default();
        assert_eq!(
            (0..7)
                .filter_map(|step| warmup.visibility(step, false))
                .collect::<Vec<_>>(),
            vec![true, false, true, false, true, false]
        );
        assert_eq!(warmup.visibility(6, true), Some(true));
        assert_eq!(warmup.visibility(7, true), None);
    }

    #[test]
    fn user_action_cancels_every_remaining_warmup_operation() {
        let warmup = Warmup::default();
        assert_eq!(warmup.visibility(0, true), Some(true));
        warmup.cancelled.store(true, Ordering::SeqCst);
        for step in 1..7 {
            assert_eq!(warmup.visibility(step, true), None);
        }
    }
}
