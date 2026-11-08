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
        screenshot::{
            self as orchestration, Outcome, ScreenshotSource, ScreenshotWindows, OWNER,
            SELECTOR_OWNER,
        },
    },
    state::AppState,
};
use tauri::{AppHandle, Manager};

/// Hands the crop chosen in the selector back to the waiting capture worker.
/// Prompts are keyed by their selection id, not by the activation id: the
/// first capture of an activation selects before the activation is published.
#[derive(Default)]
pub struct ScreenshotCropCoordinator {
    pending: std::sync::Mutex<Option<(u64, std::sync::mpsc::SyncSender<Option<CropRect>>)>>,
}

impl ScreenshotCropCoordinator {
    fn wait_for_crop(&self, selection_id: u64) -> std::sync::mpsc::Receiver<Option<CropRect>> {
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        *self.pending.lock().unwrap() = Some((selection_id, sender));
        receiver
    }

    fn clear(&self, selection_id: u64) {
        let mut guard = self.pending.lock().unwrap();
        if guard.as_ref().map(|(id, _)| *id) == Some(selection_id) {
            *guard = None;
        }
    }

    fn answer(&self, selection_id: u64, crop: Option<CropRect>) -> bool {
        let mut guard = self.pending.lock().unwrap();
        if guard.as_ref().map(|(id, _)| *id) != Some(selection_id) {
            return false;
        }
        let (_, sender) = guard.take().expect("checked above");
        let _ = sender.send(crop);
        true
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
        selection_id: u64,
        screen: Option<platform::screenshot::Screen>,
        size: (u32, u32),
        image: &ChatImage,
        bytes: &[u8],
        is_live: &dyn Fn() -> bool,
    ) -> Result<Option<CropRect>, AppError> {
        let app = self.0;
        let images = app.state::<ChatImages>();
        {
            let mut images = images.lock();
            images.remember(image.clone(), bytes.to_vec())?;
            images.sync(SELECTOR_OWNER, std::slice::from_ref(&image.id))?;
        }
        let crops = app.state::<ScreenshotCropCoordinator>();
        let receiver = crops.wait_for_crop(selection_id);
        let crop = show_selector(app, selection_id, screen, size, &image.id)
            .map(|()| wait_for_crop(&receiver, is_live));
        crops.clear(selection_id);
        images.lock().release_owner(SELECTOR_OWNER);
        hide_selector(app);
        crop
    }
}

/// The quick window geometry the selector replaces while it covers a monitor.
struct SavedGeometry {
    position: Option<tauri::PhysicalPosition<i32>>,
    size: Option<tauri::PhysicalSize<u32>>,
    always_on_top: bool,
    layer: bool,
}

static SAVED_GEOMETRY: std::sync::Mutex<Option<SavedGeometry>> = std::sync::Mutex::new(None);

fn show_selector(
    app: &AppHandle,
    selection_id: u64,
    screen: Option<platform::screenshot::Screen>,
    (width, height): (u32, u32),
    image_id: &str,
) -> Result<(), AppError> {
    let image_id = image_id.to_owned();
    on_main_thread(app, move |app| {
        let window = app
            .get_webview_window(QUICK_WINDOW_LABEL)
            .ok_or_else(|| AppError::ServiceUnavailable("Quick window not found".into()))?;
        let layer = super::panel_layer(app).is_some();
        *SAVED_GEOMETRY.lock().unwrap() = Some(SavedGeometry {
            position: window.outer_position().ok(),
            size: window.inner_size().ok(),
            always_on_top: window.is_always_on_top().unwrap_or(false),
            layer,
        });
        platform::cover_output(
            &window,
            screen.map(|s| (s.x, s.y, s.width, s.height)),
            layer,
        )?;
        platform::set_window_opacity(&window, 1.0)?;
        if !layer {
            window.set_always_on_top(true)?;
        }
        window.show()?;
        platform::focus_window(&window)?;
        crate::events::emit::<crate::events::ScreenshotSelectArea, _>(
            app,
            crate::models::ScreenshotAreaSelection {
                selection_id,
                image_id,
                // `ChatImageStore::prepare_selector_preview` encodes a PNG
                media_type: crate::models::ScreenshotPreviewMediaType::Png,
                screen_x: screen.map_or(0, |s| s.x),
                screen_y: screen.map_or(0, |s| s.y),
                width,
                height,
                scale_factor: window.scale_factor().unwrap_or(1.0),
            },
        )?;
        Ok(())
    })
}

/// Hides the selector and gives the quick window its previous geometry back,
/// so `restore` or the activation shows it as before the capture.
fn hide_selector(app: &AppHandle) {
    let Some(saved) = SAVED_GEOMETRY.lock().unwrap().take() else {
        return;
    };
    let result = on_main_thread(app, move |app| {
        crate::events::emit::<crate::events::ScreenshotSelectAreaClosed, _>(app, ())?;
        if let Some(window) = app.get_webview_window(QUICK_WINDOW_LABEL) {
            window.hide()?;
            platform::uncover_output(&window, saved.layer)?;
            if !saved.layer {
                window.set_always_on_top(saved.always_on_top)?;
                if let Some(size) = saved.size {
                    window.set_size(size)?;
                }
                if let Some(position) = saved.position {
                    window.set_position(position)?;
                }
            }
        }
        Ok(())
    });
    if let Err(error) = result {
        log::warn!("Could not close the screenshot area selector: {error}");
    }
}

/// Waits for the selector without blocking shutdown or a newer activation.
fn wait_for_crop(
    receiver: &std::sync::mpsc::Receiver<Option<CropRect>>,
    is_live: &dyn Fn() -> bool,
) -> Option<CropRect> {
    use std::sync::mpsc::RecvTimeoutError;
    while is_live() {
        match receiver.recv_timeout(std::time::Duration::from_millis(100)) {
            Ok(crop) => return crop,
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return None,
        }
    }
    None
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
}

pub(super) fn activate(app: &AppHandle, mut activation: Activation) -> Result<(), AppError> {
    // Resolve the monitor and the insertion target before any window changes.
    let screen = platform::screenshot::screen()?;
    let mode = ScreenshotCaptureMode::Area;
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
                            activation.screenshots = vec![image.clone()];
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

/// Adds another screenshot while retaining the quick request activation and draft.
pub fn add(app: &AppHandle, activation_id: u64) -> Result<Option<ChatImage>, AppError> {
    let mode = ScreenshotCaptureMode::Area;
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
                state.update_snapshot(|s| {
                    s.activation.screenshots.push(image.clone());
                    s.activation.screenshot = s.activation.screenshots.first().cloned();
                });
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

/// Retake without replacing the activation or its frontend question/conversation.
pub fn retake(
    app: &AppHandle,
    activation_id: u64,
    _mode: Option<ScreenshotCaptureMode>,
) -> Result<Option<ChatImage>, AppError> {
    add(app, activation_id)
}

pub fn confirm_crop(app: &AppHandle, selection_id: u64, crop: CropRect) -> Result<(), AppError> {
    if crop.width == 0 || crop.height == 0 {
        return Err(AppError::invalid_input("Empty screenshot selection"));
    }
    if !app
        .state::<ScreenshotCropCoordinator>()
        .answer(selection_id, Some(crop))
    {
        return Err(stale());
    }
    Ok(())
}

pub fn cancel_crop(app: &AppHandle, selection_id: u64) -> Result<(), AppError> {
    app.state::<ScreenshotCropCoordinator>()
        .answer(selection_id, None);
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

pub fn remove(
    app: &AppHandle,
    activation_id: u64,
    image_id: Option<String>,
) -> Result<(), AppError> {
    on_main_thread(app, move |app| {
        ensure_current(app, activation_id)?;
        let state = app.state::<AppState>();
        let images = app.state::<ChatImages>();
        let mut remaining_ids = Vec::new();
        state.update_snapshot(|s| {
            if let Some(target_id) = image_id.as_deref() {
                s.activation.screenshots.retain(|i| i.id != target_id);
            } else {
                s.activation.screenshots.clear();
            }
            s.activation.screenshot = s.activation.screenshots.first().cloned();
            remaining_ids = s
                .activation
                .screenshots
                .iter()
                .map(|i| i.id.clone())
                .collect();
        });
        let mut images = images.lock();
        if remaining_ids.is_empty() {
            images.release_owner(OWNER);
        } else {
            images.sync(OWNER, &remaining_ids)?;
        }
        super::emit_state(app, &state)
    })
}

pub fn open_chat(
    app: &AppHandle,
    transfer: crate::models::ChatTransfer,
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
        let valid_ids: std::collections::HashSet<_> = snapshot
            .activation
            .screenshots
            .iter()
            .map(|i| i.id.as_str())
            .collect();
        if ids.iter().any(|id| !valid_ids.contains(id.as_str())) {
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
        super::window_visibility::show_main_with::<crate::events::OpenTransferredChat>(
            &handle,
            crate::models::ActivationMode::Chat,
            transfer,
            activation_id,
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const CROP: CropRect = CropRect {
        x: 1,
        y: 2,
        width: 3,
        height: 4,
    };

    #[test]
    fn only_the_pending_selection_is_answered() {
        let crops = ScreenshotCropCoordinator::default();
        let receiver = crops.wait_for_crop(7);
        assert!(!crops.answer(6, Some(CROP)));
        assert!(crops.answer(7, Some(CROP)));
        assert!(!crops.answer(7, None));
        assert_eq!(wait_for_crop(&receiver, &|| true), Some(CROP));
    }

    #[test]
    fn waiting_stops_when_the_capture_is_no_longer_live() {
        let crops = ScreenshotCropCoordinator::default();
        let receiver = crops.wait_for_crop(1);
        assert_eq!(wait_for_crop(&receiver, &|| false), None);
        // A newer prompt drops the older sender.
        let _newer = crops.wait_for_crop(2);
        assert_eq!(wait_for_crop(&receiver, &|| true), None);
        crops.clear(1);
        assert!(crops.answer(2, None));
    }
}
