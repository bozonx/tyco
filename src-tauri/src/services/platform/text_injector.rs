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
