use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

use crate::errors::AppError;
use crate::services::voice;
use crate::services::voice::VoiceCaptureInfo;
use crate::state::AppState;

/// Starts the microphone; PCM16 chunks, then `end` or `error`, arrive
/// through `on_audio`.
#[tauri::command]
pub async fn start_voice_capture(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    on_audio: Channel<InvokeResponseBody>,
) -> Result<VoiceCaptureInfo, AppError> {
    voice::start_capture(&app, &state, on_audio).await
}

#[tauri::command]
pub async fn stop_voice_capture(state: State<'_, AppState>) -> Result<(), AppError> {
    voice::stop_capture(&state).await
}
