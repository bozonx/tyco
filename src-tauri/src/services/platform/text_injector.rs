use serde_json::Value;

use crate::errors::AppError;

pub(crate) trait TextInjector {
    fn inject(&self, user_config: &Value, source_window_id: Option<&str>) -> Result<(), AppError>;
}

struct SystemTextInjector;

impl TextInjector for SystemTextInjector {
    fn inject(&self, user_config: &Value, source_window_id: Option<&str>) -> Result<(), AppError> {
        inject_paste_impl(user_config, source_window_id)
    }
}

pub fn inject_paste(user_config: &Value, source_window_id: Option<&str>) -> Result<(), AppError> {
    SystemTextInjector.inject(user_config, source_window_id)
}

/// Fails with what is missing for pressing keys in other windows.
#[cfg(target_os = "linux")]
pub fn check_text_injection(user_config: &Value) -> Result<(), AppError> {
    super::linux::text_injector::SystemTextInjector::detect().check(user_config)
}

/// Nothing to install here; macOS asks for the Accessibility permission on
/// the first attempt.
#[cfg(not(target_os = "linux"))]
pub fn check_text_injection(_user_config: &Value) -> Result<(), AppError> {
    Ok(())
}

#[cfg(target_os = "linux")]
fn inject_paste_impl(user_config: &Value, source_window_id: Option<&str>) -> Result<(), AppError> {
    super::linux::inject_paste(user_config, source_window_id)
}

#[cfg(target_os = "windows")]
fn inject_paste_impl(_user_config: &Value, source_window_id: Option<&str>) -> Result<(), AppError> {
    super::windows::inject_paste(source_window_id)
}

#[cfg(target_os = "macos")]
fn inject_paste_impl(
    _user_config: &Value,
    _source_window_id: Option<&str>,
) -> Result<(), AppError> {
    super::macos::inject_paste()
}
