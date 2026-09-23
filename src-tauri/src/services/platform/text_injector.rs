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
