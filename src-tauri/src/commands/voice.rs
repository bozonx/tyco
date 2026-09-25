use tauri::State;

use crate::errors::AppError;
use crate::services::voice;
use crate::services::voice::LocalVoiceRecording;
use crate::state::AppState;

#[tauri::command]
pub async fn start_local_voice_recording(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    voice::start_local_recording(&app, &state).await
}

#[tauri::command]
pub async fn stop_local_voice_recording(
    state: State<'_, AppState>,
) -> Result<LocalVoiceRecording, AppError> {
    voice::stop_local_recording(&state).await
}
