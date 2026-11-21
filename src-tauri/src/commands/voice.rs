use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

use crate::errors::AppError;
use crate::services::voice;
use crate::services::voice::apps::AudioAppsWatches;
use crate::services::voice::session::VoiceSessionState;
use crate::services::voice::{AudioInputDevice, CaptureSource, DialogRecording, VoiceCaptureInfo};

/// Lists the microphones available on this machine.
#[tauri::command]
pub async fn list_input_devices() -> Result<Vec<AudioInputDevice>, AppError> {
    tokio::task::spawn_blocking(voice::list_input_devices)
        .await
        .map_err(|error| AppError::Failed(format!("input device list task failed: {error}")))?
}

/// Starts recording `source`, the microphone by default; PCM16 chunks, then
/// `end` or `error`, arrive through `on_audio`. A dialog with `recording` is
/// also recorded to a new file, see `VoiceCaptureInfo::recording_path`.
#[tauri::command]
pub async fn start_voice_capture(
    app: tauri::AppHandle,
    state: State<'_, VoiceSessionState>,
    on_audio: Channel<InvokeResponseBody>,
    source: Option<CaptureSource>,
    microphone_id: Option<String>,
    recording: Option<DialogRecording>,
) -> Result<VoiceCaptureInfo, AppError> {
    voice::start_capture(
        &app,
        &state,
        source.unwrap_or_default(),
        microphone_id,
        recording,
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

/// The folder recordings go to when the setting is empty.
#[tauri::command]
pub fn get_default_recordings_folder() -> Option<String> {
    crate::services::platform::recordings::default_recordings_folder()
        .map(|folder| folder.to_string_lossy().into_owned())
}

/// Opens the recordings folder, `folder` or the default one, creating it.
#[tauri::command]
pub async fn open_recordings_folder(folder: Option<String>) -> Result<(), AppError> {
    crate::services::background::run_blocking(move || {
        crate::services::platform::recordings::open_recordings_folder(folder.as_deref())
    })
    .await?
}

/// Which of the recordings `paths` are still there.
#[tauri::command]
pub async fn check_dialog_recordings(paths: Vec<String>) -> Result<Vec<bool>, AppError> {
    crate::services::background::run_blocking(move || {
        crate::services::platform::recordings::recordings_exist(&paths)
    })
    .await
}

/// Opens the folder of the recording `path` in the file manager.
#[tauri::command]
pub async fn show_dialog_recording(path: String) -> Result<(), AppError> {
    crate::services::background::run_blocking(move || {
        crate::services::platform::recordings::show_recording(&path)
    })
    .await?
}
