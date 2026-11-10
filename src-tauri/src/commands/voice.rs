use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

use crate::errors::AppError;
use crate::services::voice;
use crate::services::voice::apps::AudioAppsWatches;
use crate::services::voice::session::VoiceSessionState;
use crate::services::voice::{AudioInputDevice, CaptureSource, VoiceCaptureInfo};

/// Lists the microphones available on this machine.
#[tauri::command]
pub async fn list_input_devices() -> Result<Vec<AudioInputDevice>, AppError> {
    tokio::task::spawn_blocking(voice::list_input_devices)
        .await
        .map_err(|error| AppError::Failed(format!("input device list task failed: {error}")))?
}

/// Starts recording `source`, the microphone by default; PCM16 chunks, then
/// `end` or `error`, arrive through `on_audio`.
#[tauri::command]
pub async fn start_voice_capture(
    app: tauri::AppHandle,
    state: State<'_, VoiceSessionState>,
    on_audio: Channel<InvokeResponseBody>,
    source: Option<CaptureSource>,
    microphone_id: Option<String>,
) -> Result<VoiceCaptureInfo, AppError> {
    voice::start_capture(
        &app,
        &state,
        source.unwrap_or_default(),
        microphone_id,
        on_audio,
    )
    .await
}

#[tauri::command]
pub async fn stop_voice_capture(
    state: State<'_, VoiceSessionState>,
    session_id: Option<u64>,
) -> Result<(), AppError> {
    voice::stop_capture(&state, session_id).await
}

/// Records another playback source in the running capture `session_id`.
#[tauri::command]
pub async fn switch_capture_source(
    state: State<'_, VoiceSessionState>,
    session_id: u64,
    source: CaptureSource,
) -> Result<(), AppError> {
    voice::switch_capture_source(&state, session_id, source).await
}

/// Sends the applications that play sound through `on_apps` until
/// `unwatch_audio_apps`; returns the watch id.
#[tauri::command]
pub async fn watch_audio_apps(
    watches: State<'_, AudioAppsWatches>,
    on_apps: Channel<InvokeResponseBody>,
) -> Result<u64, AppError> {
    let watches = watches.inner().clone();
    crate::services::background::run_blocking(move || voice::apps::watch(&watches, on_apps)).await?
}

#[tauri::command]
pub async fn unwatch_audio_apps(
    watches: State<'_, AudioAppsWatches>,
    watch_id: u64,
) -> Result<(), AppError> {
    let watches = watches.inner().clone();
    crate::services::background::run_blocking(move || voice::apps::unwatch(&watches, watch_id))
        .await
}
