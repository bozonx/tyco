//! Activation policy and stale capture protection, independent of the window runtime.
use std::sync::Mutex;

use serde_json::Value;

use super::activation::{Activation, ActivationMode};
use super::platform::ForegroundTarget;
use crate::errors::AppError;

pub(crate) trait ActivationHost {
    fn foreground_target(&self) -> Option<ForegroundTarget>;
    fn has_focused_window(&self) -> bool;
    fn user_config(&self) -> Value;
    fn activate(&self, activation: Activation) -> Result<(), AppError>;
}

pub(crate) struct CaptureRequest {
    pub generation: u64,
    pub foreground_target: Option<ForegroundTarget>,
}

#[derive(Default)]
pub(crate) struct ActivationCoordinator {
    generation: Mutex<u64>,
}

impl ActivationCoordinator {
    pub fn begin(
        &self,
        host: &impl ActivationHost,
        mut activation: Activation,
    ) -> Result<Option<CaptureRequest>, AppError> {
        // Call only on the window executor: host activation must never wait
        // for another thread that can publish through this coordinator.
        let mut generation = self.generation.lock().expect("activation lock poisoned");
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
        *generation += 1;
        let request_generation = *generation;
        host.activate(activation)?;
        Ok(capture.then_some(CaptureRequest {
            generation: request_generation,
            foreground_target,
        }))
    }

    /// Serialize publication with invalidation by a newer activation.
    pub fn publish(
        &self,
        request: &CaptureRequest,
        publish: impl FnOnce() -> Result<(), AppError>,
    ) -> Result<(), AppError> {
        let generation = self.generation.lock().expect("activation lock poisoned");
        if *generation == request.generation {
            publish()?;
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
        fn user_config(&self) -> Value {
            self.config.clone()
        }
        fn activate(&self, activation: Activation) -> Result<(), AppError> {
            self.activated.borrow_mut().push(activation);
            if self.fail {
                Err(AppError::Message("activation failed".into()))
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
            fn user_config(&self) -> Value {
                serde_json::json!({})
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
            .begin(&host, activation(ActivationMode::Write))
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
            .begin(&host, activation(ActivationMode::Write))
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
            .begin(&host, activation(ActivationMode::Write))
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
    fn no_text_launcher_and_failed_activation_do_not_schedule_capture() {
        let coordinator = ActivationCoordinator::default();
        let host = Host {
            config: serde_json::json!({"launcherPagesWithoutText": [0]}),
            ..Host::default()
        };
        assert!(coordinator
            .begin(&host, activation(ActivationMode::CommandLauncher))
            .unwrap()
            .is_none());
        let old = coordinator
            .begin(&host, activation(ActivationMode::Chat))
            .unwrap()
            .unwrap();
        let failing = Host {
            fail: true,
            ..Host::default()
        };
        assert!(coordinator
            .begin(&failing, activation(ActivationMode::Write))
            .is_err());
        coordinator
            .publish(&old, || {
                panic!("failed activation left an old capture valid")
            })
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
            .publish(&request, || Err(AppError::Message("emit failed".into())))
            .is_err());
    }
}
