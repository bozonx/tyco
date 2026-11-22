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
/// `end` or `error`, arrive through `on_audio`. A dialog with `is_recorded`
/// is also recorded to a new file, see `VoiceCaptureInfo::recording_file`.
#[tauri::command]
pub async fn start_voice_capture(
    app: tauri::AppHandle,
    state: State<'_, VoiceSessionState>,
    on_audio: Channel<InvokeResponseBody>,
    source: Option<CaptureSource>,
    microphone_id: Option<String>,
    is_recorded: Option<bool>,
) -> Result<VoiceCaptureInfo, AppError> {
    voice::start_capture(
        &app,
        &state,
        source.unwrap_or_default(),
        microphone_id,
        is_recorded.unwrap_or(false),
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

/// Opens the folder of the call recordings in the data folder, creating it.
#[tauri::command]
pub async fn open_recordings_folder(app: tauri::AppHandle) -> Result<(), AppError> {
    crate::services::background::run_blocking(move || {
        crate::services::storage::recordings::open_folder(&app)
    })
    .await?
}

/// Which of the recordings `files` are there.
#[tauri::command]
pub async fn check_dialog_recordings(
    app: tauri::AppHandle,
    files: Vec<String>,
) -> Result<Vec<bool>, AppError> {
    crate::services::background::run_blocking(move || {
        crate::services::storage::recordings::check(&app, &files)
    })
    .await?
}

/// Opens the folder of the recording `file` in the file manager.
#[tauri::command]
pub async fn show_dialog_recording(app: tauri::AppHandle, file: String) -> Result<(), AppError> {
    crate::services::background::run_blocking(move || {
        crate::services::storage::recordings::show(&app, &file)
    })
    .await?
}

/// The bytes of a finished call recording `file`.
#[tauri::command]
pub async fn read_dialog_recording(
    app: tauri::AppHandle,
    file: String,
) -> Result<tauri::ipc::Response, AppError> {
    crate::services::background::run_blocking(move || {
        crate::services::storage::recordings::read_file(&app, &file).map(tauri::ipc::Response::new)
    })
    .await?
}

/// Removes the recording `file` of a removed history entry once the undo of
/// the removal is over; one an entry still names stays.
#[tauri::command]
pub async fn discard_dialog_recording(app: tauri::AppHandle, file: String) -> Result<(), AppError> {
    crate::services::background::run_blocking(move || {
        crate::services::storage::discard_dialog_recording(&app, file)
    })
    .await?
}
