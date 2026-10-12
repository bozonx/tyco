//! Activation policy and stale capture protection, independent of the window runtime.
use std::sync::Mutex;

use serde_json::Value;

use super::activation::{Activation, StartMode};
use crate::errors::AppError;

pub(crate) trait ActivationHost {
    fn source_window(&self) -> Option<String>;
    fn has_focused_window(&self) -> bool;
    fn user_config(&self) -> Value;
    fn activate(&self, activation: Activation) -> Result<(), AppError>;
}

pub(crate) struct CaptureRequest {
    pub generation: u64,
    pub source: Option<String>,
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
        let source = activation
            .window_id
            .clone()
            .or_else(|| host.source_window());
        activation.window_id.clone_from(&source);
        let capture = activation.selected_text.is_none()
            && !(activation.mode == StartMode::Editor && host.has_focused_window())
            && activation.takes_selection(&host.user_config());
        let generation = {
            let mut generation = self.generation.lock().expect("activation lock poisoned");
            *generation += 1;
            *generation
        };
        host.activate(activation)?;
        Ok(capture.then_some(CaptureRequest { generation, source }))
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
        fn source_window(&self) -> Option<String> {
            Some("foreground".into())
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

    fn activation(mode: StartMode) -> Activation {
        Activation::new(mode, ActivationSource::Cli)
    }

    #[test]
    fn late_capture_cannot_overwrite_a_newer_activation() {
        let coordinator = ActivationCoordinator::default();
        let host = Host::default();
        let first = coordinator
            .begin(&host, activation(StartMode::Write))
            .unwrap()
            .unwrap();
        let second = coordinator
            .begin(&host, activation(StartMode::Chat))
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
        assert_eq!(first.source.as_deref(), Some("foreground"));
    }

    #[test]
    fn explicit_context_and_focused_editor_skip_capture_and_invalidate_old_results() {
        let coordinator = ActivationCoordinator::default();
        let host = Host {
            focused: true,
            ..Host::default()
        };
        let old = coordinator
            .begin(&host, activation(StartMode::Write))
            .unwrap()
            .unwrap();
        assert!(coordinator
            .begin(&host, activation(StartMode::Editor))
            .unwrap()
            .is_none());
        coordinator
            .publish(&old, || panic!("stale capture published"))
            .unwrap();
        let mut explicit = activation(StartMode::Chat);
        explicit.window_id = Some("explicit".into());
        explicit.selected_text = Some("selected".into());
        assert!(coordinator.begin(&host, explicit).unwrap().is_none());
        assert_eq!(
            host.activated.borrow().last().unwrap().window_id.as_deref(),
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
            .begin(&host, activation(StartMode::CommandLauncher))
            .unwrap()
            .is_none());
        let old = coordinator
            .begin(&host, activation(StartMode::Chat))
            .unwrap()
            .unwrap();
        let failing = Host {
            fail: true,
            ..Host::default()
        };
        assert!(coordinator
            .begin(&failing, activation(StartMode::Write))
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
            .begin(&Host::default(), activation(StartMode::Chat))
            .unwrap()
            .unwrap();
        assert!(coordinator
            .publish(&request, || Err(AppError::Message("emit failed".into())))
            .is_err());
    }
}
