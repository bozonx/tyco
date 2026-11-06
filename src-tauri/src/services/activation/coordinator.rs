//! Activation policy and stale capture protection, independent of the window runtime.
use crate::locks::MutexExt;
use std::sync::Mutex;

use serde_json::Value;

use crate::errors::AppError;
use crate::services::activation::{Activation, ActivationMode};
use crate::services::platform::ForegroundTarget;

pub(crate) trait ActivationHost {
    fn foreground_target(&self) -> Option<ForegroundTarget>;
    fn has_focused_window(&self) -> bool;
    fn user_config(&self) -> std::sync::Arc<Value>;
    fn activate(&self, activation: Activation) -> Result<(), AppError>;
}

pub(crate) struct CaptureRequest {
    pub generation: u64,
    pub foreground_target: Option<ForegroundTarget>,
}

#[derive(Default)]
pub(crate) struct ActivationCoordinator {
    generation: Mutex<u64>,
    screenshot_generation: std::sync::atomic::AtomicU64,
}

impl ActivationCoordinator {
    pub fn begin(
        &self,
        host: &impl ActivationHost,
        mut activation: Activation,
    ) -> Result<Option<CaptureRequest>, AppError> {
        // Call only on the window executor: host activation must never wait
        // for another thread that can publish through this coordinator.
        let mut generation = self.generation.locked();
        let foreground_target = activation
            .target_window_id
            .clone()
            .map(ForegroundTarget::from_platform_id)
            .or_else(|| host.foreground_target());
        activation.target_window_id = foreground_target
            .as_ref()
            .map(|target| target.as_platform_id().to_owned());
        let capture = activation.selected_text.is_none()
            && !(activation.mode == ActivationMode::Editor && host.has_focused_window())
            && activation.can_take_selection(&host.user_config());
        self.screenshot_generation
            .store(0, std::sync::atomic::Ordering::SeqCst);
        *generation += 1;
        let request_generation = *generation;
        host.activate(activation)?;
        Ok(capture.then_some(CaptureRequest {
            generation: request_generation,
            foreground_target,
        }))
    }

    /// Reserve a generation before asynchronous screenshot capture. Windows are
    /// hidden by the caller on the same executor, before the capture is started.
    pub fn reserve(&self) -> CaptureRequest {
        let mut generation = self.generation.locked();
        *generation += 1;
        self.screenshot_generation
            .store(*generation, std::sync::atomic::Ordering::SeqCst);
        CaptureRequest {
            generation: *generation,
            foreground_target: None,
        }
    }

    pub fn is_screenshot_pending(&self) -> bool {
        self.screenshot_generation
            .load(std::sync::atomic::Ordering::SeqCst)
            != 0
    }

    pub fn is_current(&self, request: &CaptureRequest) -> bool {
        *self.generation.locked() == request.generation
    }

    /// Discards the captures still running: the window now shows something
    /// other than what they were started for, e.g. the main window opened
    /// from the tray or with a transferred text.
    pub fn invalidate(&self) {
        *self.generation.locked() += 1;
        self.screenshot_generation
            .store(0, std::sync::atomic::Ordering::SeqCst);
    }

    /// Serialize publication with invalidation by a newer activation.
    pub fn publish(
        &self,
        request: &CaptureRequest,
        publish: impl FnOnce() -> Result<(), AppError>,
    ) -> Result<(), AppError> {
        let generation = self.generation.locked();
        if *generation == request.generation {
            let result = publish();
            self.screenshot_generation
                .store(0, std::sync::atomic::Ordering::SeqCst);
            result?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::activation::ActivationSource;
    use std::cell::RefCell;

    #[derive(Default)]
    struct Host {
        focused: bool,
        config: Value,
        fail: bool,
        activated: RefCell<Vec<Activation>>,
    }

    impl ActivationHost for Host {
        fn foreground_target(&self) -> Option<ForegroundTarget> {
            Some(ForegroundTarget::from_platform_id("foreground".into()))
        }
        fn has_focused_window(&self) -> bool {
            self.focused
        }
        fn user_config(&self) -> std::sync::Arc<Value> {
            std::sync::Arc::new(self.config.clone())
        }
        fn activate(&self, activation: Activation) -> Result<(), AppError> {
            self.activated.borrow_mut().push(activation);
            if self.fail {
                Err(AppError::Failed("activation failed".into()))
            } else {
                Ok(())
            }
        }
    }

    fn activation(mode: ActivationMode) -> Activation {
        Activation::new(mode, ActivationSource::Cli)
    }

    #[test]
    fn a_concurrent_activation_cannot_advance_generation_during_window_mutation() {
        struct BlockingHost<'a> {
            coordinator: &'a ActivationCoordinator,
        }
        impl ActivationHost for BlockingHost<'_> {
            fn foreground_target(&self) -> Option<ForegroundTarget> {
                None
            }
            fn has_focused_window(&self) -> bool {
                false
            }
            fn user_config(&self) -> std::sync::Arc<Value> {
                std::sync::Arc::new(serde_json::json!({}))
            }
            fn activate(&self, _: Activation) -> Result<(), AppError> {
                std::thread::scope(|scope| {
                    let attempted = scope.spawn(|| self.coordinator.generation.try_lock().is_err());
                    assert!(attempted.join().unwrap(), "another activation could advance generation before this window mutation finished");
                });
                Ok(())
            }
        }
        let coordinator = ActivationCoordinator::default();
        let host = BlockingHost {
            coordinator: &coordinator,
        };
        let request = coordinator
            .begin(&host, activation(ActivationMode::QuickInput))
            .unwrap()
            .unwrap();
        let mut published = false;
        coordinator
            .publish(&request, || {
                published = true;
                Ok(())
            })
            .unwrap();
        assert!(published);
    }

    #[test]
    fn late_capture_cannot_overwrite_a_newer_activation() {
        let coordinator = ActivationCoordinator::default();
        let host = Host::default();
        let first = coordinator
            .begin(&host, activation(ActivationMode::QuickInput))
            .unwrap()
            .unwrap();
        let second = coordinator
            .begin(&host, activation(ActivationMode::Chat))
            .unwrap()
            .unwrap();
        let mut published = Vec::new();
        coordinator
            .publish(&second, || {
                published.push("second");
                Ok(())
            })
            .unwrap();
        coordinator
            .publish(&first, || {
                published.push("first");
                Ok(())
            })
            .unwrap();
        assert_eq!(published, ["second"]);
        assert_eq!(
            first
                .foreground_target
                .as_ref()
                .map(ForegroundTarget::as_platform_id),
            Some("foreground")
        );
    }

    #[test]
    fn explicit_context_and_focused_editor_skip_capture_and_invalidate_old_results() {
        let coordinator = ActivationCoordinator::default();
        let host = Host {
            focused: true,
            ..Host::default()
        };
        let old = coordinator
            .begin(&host, activation(ActivationMode::QuickInput))
            .unwrap()
            .unwrap();
        assert!(coordinator
            .begin(&host, activation(ActivationMode::Editor))
            .unwrap()
            .is_none());
        coordinator
            .publish(&old, || panic!("stale capture published"))
            .unwrap();
        let mut explicit = activation(ActivationMode::Chat);
        explicit.target_window_id = Some("explicit".into());
        explicit.selected_text = Some("selected".into());
        assert!(coordinator.begin(&host, explicit).unwrap().is_none());
        assert_eq!(
            host.activated
                .borrow()
                .last()
                .unwrap()
                .target_window_id
                .as_deref(),
            Some("explicit")
        );
    }

    #[test]
    fn no_text_action_page_and_failed_activation_do_not_schedule_capture() {
        let coordinator = ActivationCoordinator::default();
        let host = Host {
            config: serde_json::json!({"actionPages": [{"inputMode":"selection"}, {"inputMode":"none"}]}),
            ..Host::default()
        };
        let mut act = activation(ActivationMode::SelectionActions);
        act.action_page_index = Some(1);
        assert!(coordinator.begin(&host, act).unwrap().is_none());
        let old = coordinator
            .begin(&host, activation(ActivationMode::Chat))
            .unwrap()
            .unwrap();
        let failing = Host {
            fail: true,
            ..Host::default()
        };
        assert!(coordinator
            .begin(&failing, activation(ActivationMode::QuickInput))
            .is_err());
        coordinator
            .publish(&old, || {
                panic!("failed activation left an old capture valid")
            })
            .unwrap();
    }

    #[test]
    fn showing_another_view_discards_a_running_capture() {
        let coordinator = ActivationCoordinator::default();
        let request = coordinator
            .begin(&Host::default(), activation(ActivationMode::QuickInput))
            .unwrap()
            .unwrap();
        coordinator.invalidate();
        coordinator
            .publish(&request, || panic!("stale capture published"))
            .unwrap();
    }

    #[test]
    fn publication_errors_are_returned() {
        let coordinator = ActivationCoordinator::default();
        let request = coordinator
            .begin(&Host::default(), activation(ActivationMode::Chat))
            .unwrap()
            .unwrap();
        assert!(coordinator
            .publish(&request, || Err(AppError::Failed("emit failed".into())))
            .is_err());
    }

    #[test]
    fn a_screenshot_capture_is_published_only_while_it_is_current() {
        let coordinator = ActivationCoordinator::default();
        let request = coordinator.reserve();
        assert!(coordinator.is_screenshot_pending());
        assert!(coordinator.is_current(&request));

        let mut published = false;
        coordinator
            .publish(&request, || {
                published = true;
                Ok(())
            })
            .unwrap();
        assert!(published);
        assert!(!coordinator.is_screenshot_pending());
    }

    #[test]
    fn hiding_or_a_newer_activation_discards_a_late_screenshot() {
        let coordinator = ActivationCoordinator::default();
        let hidden = coordinator.reserve();
        coordinator.invalidate();
        assert!(!coordinator.is_current(&hidden));
        assert!(!coordinator.is_screenshot_pending());

        let replaced = coordinator.reserve();
        let newer = coordinator.reserve();
        assert!(!coordinator.is_current(&replaced));
        let mut published = false;
        coordinator
            .publish(&replaced, || {
                published = true;
                Ok(())
            })
            .unwrap();
        assert!(!published);
        assert!(coordinator.is_current(&newer));

        coordinator
            .begin(&Host::default(), activation(ActivationMode::QuickAiRequest))
            .unwrap();
        assert!(!coordinator.is_current(&newer));
        assert!(!coordinator.is_screenshot_pending());
    }

    #[test]
    fn a_screenshot_activation_never_captures_the_selection() {
        let coordinator = ActivationCoordinator::default();
        for mode in [
            ActivationMode::ScreenshotQuickAiRequest,
            ActivationMode::VoiceScreenshotQuickAiRequest,
        ] {
            assert!(coordinator
                .begin(&Host::default(), activation(mode))
                .unwrap()
                .is_none());
        }
    }
}
