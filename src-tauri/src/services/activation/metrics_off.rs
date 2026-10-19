//! The activation benchmark is left out of this build; see `metrics.rs` and
//! the `activation-bench` feature. Every mark is a no-op.
use tauri::{App, AppHandle};

use crate::errors::AppError;

pub fn setup(_app: &mut App) -> Result<(), AppError> {
    if std::env::var("TYCO_ACTIVATION_BENCH").is_ok_and(|value| value == "1") {
        log::warn!("TYCO_ACTIVATION_BENCH needs a build with the `activation-bench` feature");
    }
    Ok(())
}

pub fn mark_show(_app: &AppHandle) {}

pub fn mark_os_focus(_app: &AppHandle) {}

pub use super::metric_mark::ActivationMetricMark;

pub fn mark_from_frontend(_app: &AppHandle, _id: u64, _mark: ActivationMetricMark) {}

pub fn submit_received_text(_app: &AppHandle, _id: u64, _received_text: String) {}
