//! Screenshot activations defer showing the overlay until pixels are available.
//! Capture policy lives in `services::screenshot`; this module binds it to
//! the Tauri windows, threads and shared state.
use super::{activate_on_main_thread, on_main_thread, MAIN_WINDOW_LABEL, QUICK_WINDOW_LABEL};
use crate::{
    errors::AppError,
    models::ChatImage,
    services::{
        activation::{coordinator::ActivationCoordinator, Activation},
        background::BackgroundServices,
        chat_images::ChatImages,
        platform,
        screenshot::{self as orchestration, Outcome, ScreenshotSource, ScreenshotWindows, OWNER},
    },
    state::AppState,
};
use tauri::{AppHandle, Manager};

struct Windows<'a>(&'a AppHandle);

impl ScreenshotWindows for Windows<'_> {
    fn is_quitting(&self) -> bool {
        self.0.state::<AppState>().is_quitting()
    }

    fn hide(&self) -> Result<(), AppError> {
        for label in [MAIN_WINDOW_LABEL, QUICK_WINDOW_LABEL] {
            if let Some(window) = self.0.get_webview_window(label) {
                if label == QUICK_WINDOW_LABEL {
                    platform::disable_panel_keyboard(&window)?;
                }
                window.hide()?;
            }
        }
        Ok(())
    }

    fn restore(&self) -> Result<(), AppError> {
        let app = self.0;
        let snapshot = app.state::<AppState>().snapshot();
        if !snapshot.window.is_window_shown {
            return Ok(());
        }
        let label = app.state::<super::RuntimeWindows>().active_label();
        if let Some(window) = app.get_webview_window(label) {
            platform::set_window_opacity(&window, 1.0)?;
            if label == QUICK_WINDOW_LABEL {
                platform::apply_panel_surface(
                    &window,
                    snapshot.window.window_profile,
                    super::panel_layer(app),
                )?;
            }
            window.show()?;
            platform::focus_window(&window)?;
        }
        Ok(())
    }
}

struct Source<'a>(&'a AppHandle);

impl ScreenshotSource for Source<'_> {
    fn settle(&self) -> bool {
        // Let the native compositor consume the unmap before reading its pixels.
        self.0
            .state::<BackgroundServices>()
            .token()
            .wait(std::time::Duration::from_millis(150))
    }

    fn is_stopped(&self) -> bool {
        self.0.state::<BackgroundServices>().token().is_stopped()
    }

    fn capture(
        &self,
        screen: Option<platform::screenshot::Screen>,
    ) -> Result<Option<platform::screenshot::Pixels>, AppError> {
        platform::screenshot::capture(screen)
    }

    fn image_quality(&self) -> String {
        self.0
            .state::<AppState>()
            .user_config()
            .pointer("/llm/imageQuality")
            .and_then(|v| v.as_str())
            .unwrap_or("balanced")
            .to_string()
    }
}

pub(super) fn activate(app: &AppHandle, mut activation: Activation) -> Result<(), AppError> {
    // Resolve the monitor and the insertion target before any window changes.
    let screen = platform::screenshot::screen()?;
    activation.target_window_id =
        platform::capture_foreground_target().map(platform::ForegroundTarget::into_platform_id);
    let handle = app.clone();
    on_main_thread(app, move |app| {
        let request = orchestration::begin(&app.state::<ActivationCoordinator>(), &Windows(app))?;
        let worker = handle.clone();
        handle
            .state::<BackgroundServices>()
            .spawn_thread("screenshot-activation", move |stop| {
                let capture = orchestration::capture(
                    &worker.state::<ActivationCoordinator>(),
                    &request,
                    &Source(&worker),
                    screen,
                );
                if stop.is_stopped() {
                    return;
                }
                let published = on_main_thread(&worker, move |app| {
                    let outcome = orchestration::finish(
                        &app.state::<ActivationCoordinator>(),
                        &request,
                        capture,
                        &Windows(app),
                        &app.state::<ChatImages>(),
                        |image| {
                            activation.screenshot = Some(image);
                            activate_on_main_thread(app, activation, screen.map(|s| (s.x, s.y)))
                        },
                    )?;
                    if let Some(Outcome::Failed(error)) = outcome {
                        log::warn!("Screenshot capture failed: {error}");
                        crate::events::emit::<crate::events::ScreenshotFailed, _>(
                            app,
                            error.code(),
                        )?;
                    }
                    Ok(())
                });
                if let Err(error) = published {
                    log::warn!("Could not publish screenshot: {error}");
                }
            })
    })
}

/// Retake without replacing the activation or its frontend question/conversation.
pub fn retake(app: &AppHandle, activation_id: u64) -> Result<Option<ChatImage>, AppError> {
    let screen = platform::screenshot::screen()?;
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    on_main_thread(app, move |app| {
        ensure_current(app, activation_id)?;
        let request = orchestration::begin(&app.state::<ActivationCoordinator>(), &Windows(app))?;
        sender
            .send(request)
            .map_err(|e| AppError::Failed(e.to_string()))
    })?;
    let request = receiver
        .recv()
        .map_err(|e| AppError::Failed(e.to_string()))?;
    let capture = orchestration::capture(
        &app.state::<ActivationCoordinator>(),
        &request,
        &Source(app),
        screen,
    );
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    on_main_thread(app, move |app| {
        let outcome = orchestration::finish(
            &app.state::<ActivationCoordinator>(),
            &request,
            capture,
            &Windows(app),
            &app.state::<ChatImages>(),
            |image| {
                let state = app.state::<AppState>();
                state.update_snapshot(|s| s.activation.screenshot = Some(image));
                super::publish_state(app, &state);
                Windows(app).restore()
            },
        )?;
        let output = match outcome {
            Some(Outcome::Captured(image)) => Ok(Some(image)),
            Some(Outcome::Cancelled) => Ok(None),
            Some(Outcome::Failed(error)) => Err(error),
            None => Err(stale()),
        };
        sender
            .send(output)
            .map_err(|e| AppError::Failed(e.to_string()))
    })?;
    receiver
        .recv()
        .map_err(|e| AppError::Failed(e.to_string()))?
}

fn stale() -> AppError {
    AppError::Stale("Screenshot session is no longer current".into())
}

fn ensure_current(app: &AppHandle, activation_id: u64) -> Result<(), AppError> {
    let snapshot = app.state::<AppState>().snapshot();
    if snapshot.activation.activation_id != activation_id
        || !snapshot.activation.mode.is_some_and(|m| m.is_screenshot())
    {
        return Err(stale());
    }
    Ok(())
}

pub fn remove(app: &AppHandle, activation_id: u64) -> Result<(), AppError> {
    on_main_thread(app, move |app| {
        ensure_current(app, activation_id)?;
        let state = app.state::<AppState>();
        state.update_snapshot(|s| s.activation.screenshot = None);
        app.state::<ChatImages>().lock().release_owner(OWNER);
        super::emit_state(app, &state)
    })
}

pub fn open_chat(
    app: &AppHandle,
    transfer: crate::models::ScreenshotChatTransfer,
    activation_id: u64,
) -> Result<(), AppError> {
    let handle = app.clone();
    on_main_thread(app, move |app| {
        ensure_current(app, activation_id)?;
        let snapshot = app.state::<AppState>().snapshot();
        let ids: Vec<String> = transfer
            .chat
            .messages
            .iter()
            .flat_map(|m| &m.images)
            .map(|i| i.id.clone())
            .collect();
        let expected = snapshot.activation.screenshot.as_ref().map(|i| &i.id);
        if ids.iter().any(|id| Some(id) != expected) {
            return Err(AppError::InvalidInput("Unexpected screenshot image".into()));
        }
        // The destination owns these bytes before the quick overlay can be
        // replaced. Its normal image reconciliation takes over after rendering.
        let images = app.state::<ChatImages>();
        let mut images = images.lock();
        for id in &ids {
            images.hold_undo(&format!("main/undo/screenshot-{activation_id}"), id);
        }
        drop(images);
        super::window_visibility::show_main_with::<crate::events::OpenScreenshotChat>(
            &handle,
            crate::models::ActivationMode::Chat,
            transfer,
            activation_id,
        )
    })
}
