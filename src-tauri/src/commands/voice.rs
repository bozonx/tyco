use tauri::{AppHandle, State};

use crate::errors::AppError;
use crate::services::voice;
use crate::services::voice::LocalVoiceRecording;
use crate::state::AppState;

#[tauri::command]
pub async fn start_voice_recognition(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let params = state.params();
    let ws_config = voice::resolve_ws_config(&params);

    voice::start(app, &state, ws_config).await
}

#[tauri::command]
pub async fn stop_voice_recognition(state: State<'_, AppState>) -> Result<(), AppError> {
    voice::stop(&state).await
}

#[tauri::command]
pub async fn start_local_voice_recording(state: State<'_, AppState>) -> Result<(), AppError> {
    voice::start_local_recording(&state).await
}

#[tauri::command]
pub async fn stop_local_voice_recording(
    state: State<'_, AppState>,
) -> Result<LocalVoiceRecording, AppError> {
    voice::stop_local_recording(&state).await
}
