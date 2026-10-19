use tauri::AppHandle;

use crate::services::activation::metrics::{self, ActivationMetricMark};

#[tauri::command]
pub fn mark_activation_metric(app: AppHandle, id: u64, mark: ActivationMetricMark) {
    metrics::mark_from_frontend(&app, id, mark);
}

#[tauri::command]
pub fn submit_activation_metric_value(app: AppHandle, id: u64, value: String) {
    metrics::submit_received_text(&app, id, value);
}
