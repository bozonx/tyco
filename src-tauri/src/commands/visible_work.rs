use tauri::AppHandle;

/// The window has ended its visible work for the request `id`, see
/// `services::visible_work`.
#[tauri::command]
pub fn visible_work_ended(app: AppHandle, window: tauri::WebviewWindow, id: u64) {
    crate::services::visible_work::answer(&app, id, window.label());
}
