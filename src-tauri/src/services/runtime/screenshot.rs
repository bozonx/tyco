//! Screenshot activations defer showing the overlay until pixels are available.
use super::{activate_on_main_thread, on_main_thread, MAIN_WINDOW_LABEL, QUICK_WINDOW_LABEL};
use crate::{
    errors::AppError,
    models::ChatImage,
    services::{
        activation::{
            coordinator::{ActivationCoordinator, CaptureRequest},
            Activation,
        },
        background::BackgroundServices,
        chat_images::{ChatImageStore, ChatImages},
        platform,
    },
    state::AppState,
};
use tauri::{AppHandle, Manager};

const OWNER: &str = "quick/screenshot";

pub(super) fn activate(app: &AppHandle, mut activation: Activation) -> Result<(), AppError> {
    let screen = platform::screenshot::screen()?;
    activation.target_window_id =
        platform::capture_foreground_target().map(platform::ForegroundTarget::into_platform_id);
    let handle = app.clone();
    on_main_thread(app, move |app| {
        let request = prepare(app)?;
        let worker = handle.clone();
        handle
            .state::<BackgroundServices>()
            .spawn_thread("screenshot-activation", move |stop| {
                let result = capture(&worker, screen, &request);
                if stop.is_stopped() {
                    return;
                }
                let published = on_main_thread(&worker, move |app| {
                    app.state::<ActivationCoordinator>()
                        .publish(&request, || match result {
                            Ok(Some((image, bytes))) => {
                                let images = app.state::<ChatImages>();
                                let mut images = images.lock();
                                images.remember(image.clone(), bytes)?;
                                images.sync(OWNER, std::slice::from_ref(&image.id))?;
                                drop(images);
                                activation.screenshot = Some(image);
                                activate_on_main_thread(app, activation, screen.map(|s| (s.x, s.y)))
                            }
                            Ok(None) => restore(app),
                            Err(error) => {
                                restore(app)?;
                                crate::events::emit::<crate::events::ScreenshotFailed, _>(
                                    app,
                                    error.code(),
                                )?;
                                log::warn!("Screenshot capture failed: {error}");
                                Ok(())
                            }
                        })
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
        let snapshot = app.state::<AppState>().snapshot();
        if snapshot.activation.activation_id != activation_id
            || !snapshot.activation.mode.is_some_and(|m| m.is_screenshot())
        {
            return Err(AppError::Stale(
                "Screenshot session is no longer current".into(),
            ));
        }
        sender
            .send(prepare(app)?)
            .map_err(|e| AppError::Failed(e.to_string()))
    })?;
    let request = receiver
        .recv()
        .map_err(|e| AppError::Failed(e.to_string()))?;
    let result = capture(app, screen, &request);
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    on_main_thread(app, move |app| {
        let mut output = Err(AppError::Stale(
            "Screenshot session is no longer current".into(),
        ));
        app.state::<ActivationCoordinator>().publish(&request, || {
            restore(app)?;
            output = match result {
                Ok(Some((image, bytes))) => {
                    let images = app.state::<ChatImages>();
                    let mut images = images.lock();
                    images.remember(image.clone(), bytes)?;
                    images.sync(OWNER, std::slice::from_ref(&image.id))?;
                    app.state::<AppState>()
                        .update_snapshot(|s| s.activation.screenshot = Some(image.clone()));
                    super::publish_state(app, &app.state::<AppState>());
                    Ok(Some(image))
                }
                Ok(None) => Ok(None),
                Err(error) => Err(error),
            };
            Ok(())
        })?;
        sender
            .send(output)
            .map_err(|e| AppError::Failed(e.to_string()))
    })?;
    receiver
        .recv()
        .map_err(|e| AppError::Failed(e.to_string()))?
}

fn prepare(app: &AppHandle) -> Result<CaptureRequest, AppError> {
    if app.state::<AppState>().is_quitting() {
        return Err(AppError::ServiceUnavailable(
            "Application is stopping".into(),
        ));
    }
    let request = app.state::<ActivationCoordinator>().reserve();
    // Do not publish hidden state: the existing view and microphone wiring must
    // survive a retake. Blur dismissal is suppressed while capture owns the window.
    for label in [MAIN_WINDOW_LABEL, QUICK_WINDOW_LABEL] {
        if let Some(window) = app.get_webview_window(label) {
            if label == QUICK_WINDOW_LABEL {
                platform::disable_panel_keyboard(&window)?;
            }
            window.hide()?;
        }
    }
    Ok(request)
}

fn capture(
    app: &AppHandle,
    screen: Option<platform::screenshot::Screen>,
    request: &CaptureRequest,
) -> Result<Option<(ChatImage, Vec<u8>)>, AppError> {
    // Let the native compositor consume the unmap before reading its pixels.
    let stop = app.state::<BackgroundServices>().token();
    if stop.wait(std::time::Duration::from_millis(150))
        || !app.state::<ActivationCoordinator>().is_current(request)
    {
        return Ok(None);
    }
    let pixels = platform::screenshot::capture(screen)?;
    if stop.is_stopped() || !app.state::<ActivationCoordinator>().is_current(request) {
        return Ok(None);
    }
    pixels
        .map(|pixels| {
            let config = app.state::<AppState>().user_config();
            let quality = config
                .pointer("/llm/imageQuality")
                .and_then(|v| v.as_str())
                .unwrap_or("balanced");
            ChatImageStore::prepare_capture(&pixels.bytes, pixels.width, pixels.height, quality)
        })
        .transpose()
}

fn restore(app: &AppHandle) -> Result<(), AppError> {
    let snapshot = app.state::<AppState>().snapshot();
    if snapshot.window.is_window_shown {
        let label = app.state::<super::RuntimeWindows>().active_label();
        if let Some(window) = app.get_webview_window(label) {
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
    }
    Ok(())
}

pub fn remove(app: &AppHandle, activation_id: u64) -> Result<(), AppError> {
    on_main_thread(app, move |app| {
        let state = app.state::<AppState>();
        if state.snapshot().activation.activation_id != activation_id {
            return Err(AppError::Stale(
                "Screenshot session is no longer current".into(),
            ));
        }
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
        let snapshot = app.state::<AppState>().snapshot();
        if snapshot.activation.activation_id != activation_id
            || !snapshot.activation.mode.is_some_and(|m| m.is_screenshot())
        {
            return Err(AppError::Stale(
                "Screenshot session is no longer current".into(),
            ));
        }
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
