use serde_json::Value;

use crate::errors::AppError;
use crate::services::foreground_context::{ForegroundContext, SystemForegroundContext};

pub fn capture_source() -> Option<String> {
    SystemForegroundContext::detect().capture_source()
}

pub async fn capture_selection(source: Option<String>) -> Option<String> {
    SystemForegroundContext::detect()
        .capture_selection(source)
        .await
}

pub fn inject_paste(user_config: &Value, source_window_id: Option<&str>) -> Result<(), AppError> {
    crate::services::text_injector::SystemTextInjector::detect()
        .inject_paste(user_config, source_window_id)
}
