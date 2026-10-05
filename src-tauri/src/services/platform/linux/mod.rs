//! Linux backends. Which one serves a call depends on the session, see
//! `super::session`: X11 has the tools to find, activate and type into any
//! window, while on Wayland only KDE Plasma lets Tyco do that, via KWin scripts.

pub mod clipboard_restore;
mod foreground_context;
pub mod kwin;
pub mod layer_shell;
pub mod primary_selection;
pub mod text_injector;
pub mod x11;

use serde_json::Value;

use crate::errors::AppError;
use foreground_context::{ForegroundContext, SystemForegroundContext};

pub fn capture_source() -> Option<String> {
    SystemForegroundContext::detect().capture_source()
}

pub async fn capture_selection(source: Option<String>) -> Option<String> {
    SystemForegroundContext::detect()
        .capture_selection(source)
        .await
}

pub fn inject_paste(user_config: &Value, source_window_id: Option<&str>) -> Result<(), AppError> {
    text_injector::SystemTextInjector::detect().inject_paste(user_config, source_window_id)
}
