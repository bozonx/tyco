//! Screenshot capture orchestration, independent of the window runtime.
//!
//! A capture runs in three steps: `begin` on the window executor reserves an
//! activation generation and hides TyCo windows, `capture` on a worker reads
//! and encodes the pixels, and `finish` on the window executor publishes the
//! result only while its generation is still current.
use crate::{
    errors::AppError,
    models::{ChatImage, CropRect, ScreenshotCaptureMode},
    services::{
        activation::coordinator::{ActivationCoordinator, CaptureRequest},
        chat_images::{ChatImageStore, ChatImages},
        platform::screenshot::{crop_pixels, Pixels, Screen},
    },
};

/// The image owner that keeps the quick request screenshot alive.
pub(crate) const OWNER: &str = "quick/screenshot";
/// Owns the frozen full-screen image only while the area selector shows it,
/// so cancelling a selection never releases the previous screenshot.
pub(crate) const SELECTOR_OWNER: &str = "quick/screenshot-selector";

/// Window side of a capture, called on the window executor.
pub(crate) trait ScreenshotWindows {
    fn is_quitting(&self) -> bool;
    /// Hides TyCo windows without publishing hidden state, so the view and its
    /// microphone wiring survive a retake.
    fn hide(&self) -> Result<(), AppError>;
    /// Shows the window that was visible before the capture, if any.
    fn restore(&self) -> Result<(), AppError>;
    /// Prompts the user to drag a selection rectangle over the frozen image.
    /// `selection_id` identifies this prompt in the confirm/cancel commands.
    /// Returns `None` on cancellation or as soon as `is_live` turns false.
    /// `screen` is the captured monitor, or `None` when the system chose what
    /// to capture (Wayland); `size` is the frozen image size in pixels.
    fn select_area(
        &self,
        selection_id: u64,
        screen: Option<Screen>,
        size: (u32, u32),
        image: &ChatImage,
        bytes: &[u8],
        is_live: &dyn Fn() -> bool,
    ) -> Result<Option<CropRect>, AppError>;
}

/// Capture side, called on a worker thread.
pub(crate) trait ScreenshotSource {
    /// Waits for the compositor to drop the hidden windows; true when stopping.
    fn settle(&self) -> bool;
    fn is_stopped(&self) -> bool;
    fn capture(&self, screen: Option<Screen>) -> Result<Option<Pixels>, AppError>;
}

pub(crate) type Capture = Result<Option<(ChatImage, Vec<u8>)>, AppError>;

#[derive(Debug)]
pub(crate) enum Outcome {
    Captured(ChatImage),
    /// The user dismissed the system capture dialog.
    Cancelled,
    Failed(AppError),
}

pub(crate) fn begin(
    coordinator: &ActivationCoordinator,
    windows: &impl ScreenshotWindows,
) -> Result<CaptureRequest, AppError> {
    if windows.is_quitting() {
        return Err(AppError::ServiceUnavailable(
            "Application is stopping".into(),
        ));
    }
    // Reserve first: blur dismissal is suppressed while a capture is pending.
    let request = coordinator.reserve();
    if let Err(error) = windows.hide() {
        coordinator.invalidate();
        let _ = windows.restore();
        return Err(error);
    }
    Ok(request)
}

/// `Ok(None)` for a cancelled dialog or a request that is no longer current.
pub(crate) fn capture(
    coordinator: &ActivationCoordinator,
    request: &CaptureRequest,
    source: &impl ScreenshotSource,
    windows: &impl ScreenshotWindows,
    screen: Option<Screen>,
    mode: ScreenshotCaptureMode,
) -> Capture {
    if source.settle() || !coordinator.is_current(request) {
        return Ok(None);
    }
    // Area mode captures the entire screen too and crops it in the selector.
    let pixels = source.capture(screen)?;
    if source.is_stopped() || !coordinator.is_current(request) {
        return Ok(None);
    }
    let Some(pixels) = pixels else {
        return Ok(None);
    };
    let pixels = if mode == ScreenshotCaptureMode::Area {
        let (full_image, full_bytes) =
            ChatImageStore::prepare_selector_preview(&pixels.bytes, pixels.width, pixels.height)?;
        let is_live = || !source.is_stopped() && coordinator.is_current(request);
        let crop = windows.select_area(
            request.generation,
            screen,
            (pixels.width, pixels.height),
            &full_image,
            &full_bytes,
            &is_live,
        )?;
        if source.is_stopped() || !coordinator.is_current(request) {
            return Ok(None);
        }
        let Some(crop) = crop else {
            return Ok(None);
        };
        crop_pixels(&pixels, crop)?
    } else {
        pixels
    };
    ChatImageStore::prepare_capture(&pixels.bytes, pixels.width, pixels.height).map(Some)
}

/// Publishes `capture` while `request` is current; `None` when it is stale, in
/// which case neither windows nor images are touched. A captured image is
/// owned by `OWNER` before `show` runs. Cancellation and failure restore the
/// previous window and keep the previous screenshot.
pub(crate) fn finish(
    coordinator: &ActivationCoordinator,
    request: &CaptureRequest,
    capture: Capture,
    windows: &impl ScreenshotWindows,
    images: &ChatImages,
    show: impl FnOnce(ChatImage) -> Result<(), AppError>,
) -> Result<Option<Outcome>, AppError> {
    let mut outcome = None;
    coordinator.publish(request, || {
        let result = match capture {
            Ok(Some((image, bytes))) => store(images, &image, bytes)
                .and_then(|()| show(image.clone()))
                .map(|()| Outcome::Captured(image)),
            Ok(None) => Ok(Outcome::Cancelled),
            Err(error) => Ok(Outcome::Failed(error)),
        };
        let result = result.unwrap_or_else(Outcome::Failed);
        if !matches!(result, Outcome::Captured(_)) {
            windows.restore()?;
        }
        outcome = Some(result);
        Ok(())
    })?;
    Ok(outcome)
}

fn store(images: &ChatImages, image: &ChatImage, bytes: Vec<u8>) -> Result<(), AppError> {
    let mut images = images.lock();
    images.remember(image.clone(), bytes)?;
    images.hold(OWNER, &image.id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    #[derive(Default)]
    struct Windows {
        quitting: bool,
        hide_fails: bool,
        log: RefCell<Vec<&'static str>>,
        area_crop: RefCell<Option<Option<CropRect>>>,
        selector_size: Cell<Option<(u32, u32)>>,
    }

    impl ScreenshotWindows for Windows {
        fn is_quitting(&self) -> bool {
            self.quitting
        }
        fn hide(&self) -> Result<(), AppError> {
            self.log.borrow_mut().push("hide");
            if self.hide_fails {
                return Err(AppError::Failed("hide".into()));
            }
            Ok(())
        }
        fn restore(&self) -> Result<(), AppError> {
            self.log.borrow_mut().push("restore");
            Ok(())
        }
        fn select_area(
            &self,
            _selection_id: u64,
            _screen: Option<Screen>,
            size: (u32, u32),
            _image: &ChatImage,
            _bytes: &[u8],
            _is_live: &dyn Fn() -> bool,
        ) -> Result<Option<CropRect>, AppError> {
            self.log.borrow_mut().push("select_area");
            self.selector_size.set(Some(size));
            Ok(self.area_crop.borrow_mut().take().unwrap_or(None))
        }
    }

    struct Source<'a> {
        stopped: bool,
        result: RefCell<Option<Result<Option<Pixels>, AppError>>>,
        screens: RefCell<Vec<Option<(i32, i32)>>>,
        captures: Cell<usize>,
        /// Runs during capture, e.g. a newer activation.
        during: Option<&'a dyn Fn()>,
    }

    impl<'a> Source<'a> {
        fn returning(result: Result<Option<Pixels>, AppError>) -> Self {
            Self {
                stopped: false,
                result: RefCell::new(Some(result)),
                screens: RefCell::default(),
                captures: Cell::new(0),
                during: None,
            }
        }
    }

    impl ScreenshotSource for Source<'_> {
        fn settle(&self) -> bool {
            self.stopped
        }
        fn is_stopped(&self) -> bool {
            self.stopped
        }
        fn capture(&self, screen: Option<Screen>) -> Result<Option<Pixels>, AppError> {
            self.captures.set(self.captures.get() + 1);
            self.screens.borrow_mut().push(screen.map(|s| (s.x, s.y)));
            if let Some(during) = self.during {
                during();
            }
            self.result.borrow_mut().take().unwrap()
        }
    }

    fn pixels(width: u32, height: u32) -> Pixels {
        Pixels {
            bytes: vec![128; width as usize * height as usize * 4],
            width,
            height,
        }
    }

    fn screen() -> Screen {
        Screen {
            x: -1920,
            y: 0,
            width: 1920,
            height: 1080,
        }
    }

    fn has_image(images: &ChatImages, id: &str) -> bool {
        images
            .lock()
            .get(std::path::Path::new("/nonexistent"), id)
            .is_ok()
    }

    #[test]
    fn windows_are_hidden_only_after_the_capture_is_reserved() {
        let coordinator = ActivationCoordinator::default();
        let windows = Windows::default();
        let request = begin(&coordinator, &windows).unwrap();
        assert_eq!(*windows.log.borrow(), ["hide"]);
        assert!(coordinator.is_current(&request));
        assert!(coordinator.is_screenshot_pending());
    }

    #[test]
    fn no_capture_starts_while_quitting_or_when_hiding_fails() {
        let coordinator = ActivationCoordinator::default();
        let quitting = Windows {
            quitting: true,
            ..Windows::default()
        };
        assert!(begin(&coordinator, &quitting).is_err());
        assert!(quitting.log.borrow().is_empty());

        let failing = Windows {
            hide_fails: true,
            ..Windows::default()
        };
        assert!(begin(&coordinator, &failing).is_err());
        assert_eq!(*failing.log.borrow(), ["hide", "restore"]);
        assert!(!coordinator.is_screenshot_pending());
    }

    #[test]
    fn the_monitor_resolved_before_hiding_is_captured_and_encoded_as_is() {
        let coordinator = ActivationCoordinator::default();
        let windows = Windows::default();
        let request = begin(&coordinator, &windows).unwrap();
        let source = Source::returning(Ok(Some(pixels(2048, 1024))));
        let (image, bytes) = capture(
            &coordinator,
            &request,
            &source,
            &windows,
            Some(screen()),
            ScreenshotCaptureMode::Screen,
        )
        .unwrap()
        .unwrap();
        assert_eq!(*source.screens.borrow(), [Some((-1920, 0))]);
        // Exact dimensions preserved without downscaling!
        assert_eq!((image.width_px, image.height_px), (2048, 1024));
        assert_eq!(image.size_bytes, bytes.len());
    }

    #[test]
    fn area_capture_with_ui_selection_crops_pixels() {
        let coordinator = ActivationCoordinator::default();
        let windows = Windows {
            area_crop: RefCell::new(Some(Some(CropRect {
                x: 10,
                y: 10,
                width: 100,
                height: 50,
            }))),
            ..Windows::default()
        };
        let request = begin(&coordinator, &windows).unwrap();
        let source = Source::returning(Ok(Some(pixels(1920, 1080))));
        let (image, bytes) = capture(
            &coordinator,
            &request,
            &source,
            &windows,
            Some(screen()),
            ScreenshotCaptureMode::Area,
        )
        .unwrap()
        .unwrap();
        assert_eq!((image.width_px, image.height_px), (100, 50));
        assert_eq!(image.size_bytes, bytes.len());
        assert_eq!(*windows.log.borrow(), ["hide", "select_area"]);
    }

    #[test]
    fn area_capture_cancellation_in_ui_returns_none() {
        let coordinator = ActivationCoordinator::default();
        let windows = Windows {
            area_crop: RefCell::new(Some(None)),
            ..Windows::default()
        };
        let request = begin(&coordinator, &windows).unwrap();
        let source = Source::returning(Ok(Some(pixels(1920, 1080))));
        let result = capture(
            &coordinator,
            &request,
            &source,
            &windows,
            Some(screen()),
            ScreenshotCaptureMode::Area,
        )
        .unwrap();
        assert!(result.is_none());
        assert_eq!(*windows.log.borrow(), ["hide", "select_area"]);
    }

    #[test]
    fn area_selection_runs_over_a_system_chosen_capture() {
        // Wayland: no monitor is known, the selector covers the frozen image.
        let coordinator = ActivationCoordinator::default();
        let windows = Windows {
            area_crop: RefCell::new(Some(Some(CropRect {
                x: 0,
                y: 0,
                width: 40,
                height: 30,
            }))),
            ..Windows::default()
        };
        let request = begin(&coordinator, &windows).unwrap();
        let source = Source::returning(Ok(Some(pixels(3840, 1080))));
        let (image, _) = capture(
            &coordinator,
            &request,
            &source,
            &windows,
            None,
            ScreenshotCaptureMode::Area,
        )
        .unwrap()
        .unwrap();
        assert_eq!((image.width_px, image.height_px), (40, 30));
        assert_eq!(windows.selector_size.get(), Some((3840, 1080)));
    }

    #[test]
    fn a_selection_out_of_the_image_is_rejected() {
        let coordinator = ActivationCoordinator::default();
        let windows = Windows {
            area_crop: RefCell::new(Some(Some(CropRect {
                x: 1900,
                y: 0,
                width: 40,
                height: 30,
            }))),
            ..Windows::default()
        };
        let request = begin(&coordinator, &windows).unwrap();
        let source = Source::returning(Ok(Some(pixels(1920, 1080))));
        assert!(capture(
            &coordinator,
            &request,
            &source,
            &windows,
            Some(screen()),
            ScreenshotCaptureMode::Area,
        )
        .is_err());
    }

    #[test]
    fn a_stale_or_stopped_capture_never_reaches_the_backend() {
        let coordinator = ActivationCoordinator::default();
        let windows = Windows::default();
        let request = begin(&coordinator, &windows).unwrap();
        coordinator.invalidate();
        let source = Source::returning(Ok(Some(pixels(4, 4))));
        assert!(capture(
            &coordinator,
            &request,
            &source,
            &windows,
            None,
            ScreenshotCaptureMode::Screen
        )
        .unwrap()
        .is_none());
        assert_eq!(source.captures.get(), 0);

        let request = begin(&coordinator, &windows).unwrap();
        let stopped = Source {
            stopped: true,
            ..Source::returning(Ok(Some(pixels(4, 4))))
        };
        assert!(capture(
            &coordinator,
            &request,
            &stopped,
            &windows,
            None,
            ScreenshotCaptureMode::Screen
        )
        .unwrap()
        .is_none());
        assert_eq!(stopped.captures.get(), 0);
    }

    #[test]
    fn a_result_that_arrives_after_a_newer_activation_is_discarded() {
        let coordinator = ActivationCoordinator::default();
        let windows = Windows::default();
        let images = ChatImages::default();
        let request = begin(&coordinator, &windows).unwrap();
        let newer = || {
            coordinator.reserve();
        };
        let source = Source {
            during: Some(&newer),
            ..Source::returning(Ok(Some(pixels(4, 4))))
        };
        let late = capture(
            &coordinator,
            &request,
            &source,
            &windows,
            None,
            ScreenshotCaptureMode::Screen,
        )
        .unwrap();
        assert!(late.is_none());

        // A result computed before invalidation is still dropped on publication.
        let stale = ChatImageStore::prepare_capture(&[1; 16], 2, 2).unwrap();
        let id = stale.0.id.clone();
        let outcome = finish(
            &coordinator,
            &request,
            Ok(Some(stale)),
            &windows,
            &images,
            |_| panic!("a stale capture must not be shown"),
        )
        .unwrap();
        assert!(outcome.is_none());
        assert!(!has_image(&images, &id));
        assert_eq!(*windows.log.borrow(), ["hide"]);
    }

    #[test]
    fn a_captured_image_is_owned_before_it_is_shown() {
        let coordinator = ActivationCoordinator::default();
        let windows = Windows::default();
        let images = ChatImages::default();
        let request = begin(&coordinator, &windows).unwrap();
        let captured = ChatImageStore::prepare_capture(&[1; 16], 2, 2).unwrap();
        let id = captured.0.id.clone();
        let outcome = finish(
            &coordinator,
            &request,
            Ok(Some(captured)),
            &windows,
            &images,
            |image| {
                assert!(has_image(&images, &image.id));
                Ok(())
            },
        )
        .unwrap();
        assert!(matches!(outcome, Some(Outcome::Captured(image)) if image.id == id));
        assert_eq!(*windows.log.borrow(), ["hide"]);
        assert!(!coordinator.is_screenshot_pending());

        images.lock().release_owner(OWNER);
        assert!(!has_image(&images, &id));
    }

    #[test]
    fn cancellation_and_failure_restore_the_window_and_keep_the_previous_image() {
        let images = ChatImages::default();
        let previous = images.lock().insert(&png_bytes(), None).unwrap();
        images
            .lock()
            .sync(OWNER, std::slice::from_ref(&previous.id))
            .unwrap();

        for capture in [Ok(None), Err(AppError::Failed("portal".into()))] {
            let coordinator = ActivationCoordinator::default();
            let windows = Windows::default();
            let request = begin(&coordinator, &windows).unwrap();
            let outcome = finish(&coordinator, &request, capture, &windows, &images, |_| {
                panic!("nothing was captured")
            })
            .unwrap();
            assert!(matches!(
                outcome,
                Some(Outcome::Cancelled | Outcome::Failed(_))
            ));
            assert_eq!(*windows.log.borrow(), ["hide", "restore"]);
            assert!(has_image(&images, &previous.id));
            assert!(!coordinator.is_screenshot_pending());
        }
    }

    #[test]
    fn a_failure_to_show_the_capture_is_reported_and_restores_the_window() {
        let coordinator = ActivationCoordinator::default();
        let windows = Windows::default();
        let images = ChatImages::default();
        let request = begin(&coordinator, &windows).unwrap();
        let captured = ChatImageStore::prepare_capture(&[1; 16], 2, 2).unwrap();
        let outcome = finish(
            &coordinator,
            &request,
            Ok(Some(captured)),
            &windows,
            &images,
            |_| Err(AppError::Failed("show".into())),
        )
        .unwrap();
        assert!(matches!(outcome, Some(Outcome::Failed(_))));
        assert_eq!(*windows.log.borrow(), ["hide", "restore"]);
    }

    fn png_bytes() -> Vec<u8> {
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut bytes, 1, 1);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(&[1, 2, 3, 255]).unwrap();
        }
        bytes
    }
}
