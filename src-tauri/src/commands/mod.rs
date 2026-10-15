pub mod actions;
pub mod app;
pub mod history;
pub mod net;
pub mod notes;
pub mod plugins;
pub mod secrets;
pub mod selection;
pub mod voice;
pub mod window;

use crate::errors::AppError;

/// Runs work that waits — for the disk, a lock, a process or a dialog — on
/// the blocking pool. A synchronous `#[tauri::command(async)]` would run it on
/// an async worker instead, and a few long waits there stall every request,
/// socket and stream of the app.
pub async fn run_blocking<T: Send + 'static>(
    task: impl FnOnce() -> T + Send + 'static,
) -> Result<T, AppError> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| AppError::Message(error.to_string()))
}

pub mod activation;
pub mod ai_vault;
pub mod desktop_state;
pub mod diagnostics;
pub mod hotkeys;
pub mod settings;
pub mod storage;

pub mod chat_images;
pub mod chats;
pub mod editor_history;

pub mod action_logs;
pub mod external_jobs;
pub mod script_actions;
