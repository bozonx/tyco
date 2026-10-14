use serde_json::Value;

use super::ForegroundTarget;
use crate::errors::AppError;

pub(crate) trait TextInjector {
    fn inject(
        &self,
        user_config: &Value,
        target: Option<&ForegroundTarget>,
    ) -> Result<(), AppError>;
}

pub(crate) struct SystemTextInjector;

impl TextInjector for SystemTextInjector {
    fn inject(
        &self,
        user_config: &Value,
        target: Option<&ForegroundTarget>,
    ) -> Result<(), AppError> {
        inject_paste_impl(user_config, target.map(ForegroundTarget::as_platform_id))
    }
}

/// Insert only after focus was released; preserve the result in the clipboard
/// on failure, and restore the previous clipboard only after a successful paste.
pub(crate) fn paste_after_focus(
    injector: &impl TextInjector,
    user_config: &Value,
    target: Option<&ForegroundTarget>,
    release_focus: impl FnOnce(),
    restore_clipboard: impl FnOnce(),
) -> Result<(), AppError> {
    release_focus();
    injector.inject(user_config, target)?;
    restore_clipboard();
    Ok(())
}

/// Fails with what is missing for pressing keys in other windows.
#[cfg(target_os = "linux")]
pub fn check_text_injection(user_config: &Value) -> Result<(), AppError> {
    super::linux::text_injector::SystemTextInjector::detect().check_text_injection(user_config)
}

#[cfg(target_os = "windows")]
pub fn check_text_injection(_user_config: &Value) -> Result<(), AppError> {
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn check_text_injection(_user_config: &Value) -> Result<(), AppError> {
    super::macos::check_text_injection()
}

#[cfg(target_os = "linux")]
fn inject_paste_impl(user_config: &Value, target_window_id: Option<&str>) -> Result<(), AppError> {
    super::linux::inject_paste(user_config, target_window_id)
}

#[cfg(target_os = "windows")]
fn inject_paste_impl(
    _user_config: &Value,
    target_platform_id: Option<&str>,
) -> Result<(), AppError> {
    super::windows::inject_paste(target_platform_id)
}

#[cfg(target_os = "macos")]
fn inject_paste_impl(
    _user_config: &Value,
    target_platform_id: Option<&str>,
) -> Result<(), AppError> {
    super::macos::inject_paste(target_platform_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct Injector<'a> {
        calls: &'a RefCell<Vec<&'static str>>,
        fail: bool,
    }

    impl TextInjector for Injector<'_> {
        fn inject(
            &self,
            config: &Value,
            window: Option<&ForegroundTarget>,
        ) -> Result<(), AppError> {
            assert_eq!(
                config,
                &serde_json::json!({"pasteShortcut": "shift+insert"})
            );
            assert_eq!(window.map(ForegroundTarget::as_platform_id), Some("target"));
            self.calls.borrow_mut().push("inject");
            if self.fail {
                Err(AppError::Message("injection failed".into()))
            } else {
                Ok(())
            }
        }
    }

    #[test]
    fn focus_is_released_before_injection_and_clipboard_restored_only_on_success() {
        for fail in [false, true] {
            let calls = RefCell::new(Vec::new());
            let injector = Injector {
                calls: &calls,
                fail,
            };
            let result = paste_after_focus(
                &injector,
                &serde_json::json!({"pasteShortcut": "shift+insert"}),
                Some(&ForegroundTarget::from_platform_id("target".into())),
                || calls.borrow_mut().push("release-focus"),
                || calls.borrow_mut().push("restore"),
            );
            assert_eq!(result.is_err(), fail);
            let expected = if fail {
                vec!["release-focus", "inject"]
            } else {
                vec!["release-focus", "inject", "restore"]
            };
            assert_eq!(*calls.borrow(), expected);
        }
    }
}
