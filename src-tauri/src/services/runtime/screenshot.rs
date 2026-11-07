//! Screenshot activations defer showing the overlay until pixels are available.
//! Capture policy lives in `services::screenshot`; this module binds it to
//! the Tauri windows, threads and shared state.
use super::{activate_on_main_thread, on_main_thread, MAIN_WINDOW_LABEL, QUICK_WINDOW_LABEL};
use crate::{
    errors::AppError,
    models::{ChatImage, CropRect, ScreenshotCaptureMode},
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

#[derive(Default)]
pub struct ScreenshotCropCoordinator {
    pending: std::sync::Mutex<Option<(u64, std::sync::mpsc::SyncSender<Option<CropRect>>)>>,
}

impl ScreenshotCropCoordinator {
    pub fn wait_for_crop(
        &self,
        activation_id: u64,
    ) -> (
        std::sync::mpsc::Receiver<Option<CropRect>>,
        impl FnOnce() + '_,
    ) {
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        *self.pending.lock().unwrap() = Some((activation_id, sender));
        let cleanup = move || {
            let mut guard = self.pending.lock().unwrap();
            if guard.as_ref().map(|(id, _)| *id) == Some(activation_id) {
                *guard = None;
            }
        };
        (receiver, cleanup)
    }

    pub fn confirm(&self, activation_id: u64, crop: CropRect) -> bool {
        let mut guard = self.pending.lock().unwrap();
        if let Some((id, sender)) = guard.take() {
            if id == activation_id {
                let _ = sender.send(Some(crop));
                return true;
            }
            *guard = Some((id, sender));
        }
        false
    }

    pub fn cancel(&self, activation_id: u64) -> bool {
        let mut guard = self.pending.lock().unwrap();
        if let Some((id, sender)) = guard.take() {
            if id == activation_id {
                let _ = sender.send(None);
                return true;
            }
            *guard = Some((id, sender));
        }
        false
    }
}

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
                let layer = super::panel_layer(app);
                if layer.is_none() {
                    let (width, height) = super::WINDOW_SIZE;
                    let _ = window.set_size(tauri::LogicalSize::new(width, height));
                }
                platform::apply_panel_surface(&window, snapshot.window.window_profile, layer)?;
            }
            window.show()?;
            platform::focus_window(&window)?;
        }
        Ok(())
    }

    fn select_area(
        &self,
        screen: platform::screenshot::Screen,
        image: &ChatImage,
        bytes: &[u8],
    ) -> Result<Option<CropRect>, AppError> {
        let app = self.0;
        let images = app.state::<ChatImages>();
        images.lock().remember(image.clone(), bytes.to_vec())?;
        images
            .lock()
            .sync(orchestration::OWNER, std::slice::from_ref(&image.id))?;

        let activation_id = app.state::<AppState>().snapshot().activation.activation_id;
        let crop_coordinator = app.state::<ScreenshotCropCoordinator>();
        let (receiver, cleanup) = crop_coordinator.wait_for_crop(activation_id);

        let window = app
            .get_webview_window(QUICK_WINDOW_LABEL)
            .ok_or_else(|| AppError::ServiceUnavailable("Quick window not found".into()))?;

        let scale_factor = window.scale_factor().unwrap_or(1.0);
        let screen_x = screen.x;
        let screen_y = screen.y;
        let width = screen.width;
        let height = screen.height;
        let image_id = image.id.clone();

        on_main_thread(app, move |app| {
            if let Some(w) = app.get_webview_window(QUICK_WINDOW_LABEL) {
                let _ = w.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
                    screen_x, screen_y,
                )));
                let _ = w.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(
                    width, height,
                )));
                let _ = platform::set_window_opacity(&w, 1.0);
                let _ = w.set_always_on_top(true);
                let _ = w.show();
                let _ = platform::focus_window(&w);
            }
            crate::events::emit::<crate::events::ScreenshotSelectArea, _>(
                app,
                crate::models::ScreenshotAreaSelection {
                    activation_id,
                    image_id,
                    screen_x,
                    screen_y,
                    width,
                    height,
                    scale_factor,
                },
            )?;
            Ok(())
        })?;

        let crop = receiver.recv().unwrap_or(None);
        cleanup();
        Ok(crop)
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
        mode: ScreenshotCaptureMode,
    ) -> Result<Option<platform::screenshot::Pixels>, AppError> {
        platform::screenshot::capture(screen, mode)
    }

    fn selects_area_natively(&self) -> bool {
        platform::screenshot::selects_area_natively()
    }
}

pub(super) fn activate(app: &AppHandle, mut activation: Activation) -> Result<(), AppError> {
    // Resolve the monitor and the insertion target before any window changes.
    let screen = platform::screenshot::screen()?;
    let mode =
        crate::models::user_config::screenshot_capture_mode(&app.state::<AppState>().user_config());
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
                    &Windows(&worker),
                    screen,
                    mode,
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
pub fn retake(
    app: &AppHandle,
    activation_id: u64,
    mode: Option<ScreenshotCaptureMode>,
) -> Result<Option<ChatImage>, AppError> {
    let mode = mode.unwrap_or_else(|| {
        crate::models::user_config::screenshot_capture_mode(&app.state::<AppState>().user_config())
    });
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
        &Windows(app),
        screen,
        mode,
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

pub fn confirm_crop(app: &AppHandle, activation_id: u64, crop: CropRect) -> Result<(), AppError> {
    ensure_current(app, activation_id)?;
    if !app
        .state::<ScreenshotCropCoordinator>()
        .confirm(activation_id, crop)
    {
        return Err(stale());
    }
    Ok(())
}

pub fn cancel_crop(app: &AppHandle, activation_id: u64) -> Result<(), AppError> {
    ensure_current(app, activation_id)?;
    let _ = app
        .state::<ScreenshotCropCoordinator>()
        .cancel(activation_id);
    Ok(())
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
