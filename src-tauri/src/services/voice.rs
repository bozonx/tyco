//! Audio capture for live transcription: the microphone for dictation, the
//! sound the computer plays for listening.
//!
//! The audio leaves as PCM16 chunks through the channel the webview passed
//! in, which hands it on to the speech provider's socket; nothing is kept
//! but a dialog's call recording, which holds the very samples sent.
//! A dictation can therefore last as long as the user keeps talking. The
//! chunks are mono, but for a dialog with the microphone: two interleaved
//! channels, the microphone and the computer sound.

pub mod apps;
mod audio_processing;
mod debug_dump;
mod echo_gate;
mod limiter;
pub(crate) mod microphone_mix;
pub mod mixer;
pub mod recording;
pub mod session;
pub mod source;

pub use source::{
    silence_gap, AudioApp, AudioAppId, AudioInputDevice, CaptureSource, SourceStatus,
};

pub use audio_processing::compute_audio_level;
use audio_processing::{mix_frame, pcm16_to_le_bytes, Downsampler, StartupFadeIn};

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc as std_mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use cpal::traits::DeviceTrait;
use serde::Serialize;
use tauri::AppHandle;

use crate::errors::AppError;
use crate::locks::MutexExt;
use crate::services::clock::{MonotonicClock, SystemClock};
use crate::services::net::EventSink;
use crate::services::voice::debug_dump::CaptureDump;
use crate::services::voice::recording::{RecordingRequest, RecordingSink};
use crate::services::voice::session::VoiceSessionState;
use crate::services::voice::session::{SourceSwitch, SourceSwitchSlot, VoiceCaptureSession};

/// What speech models are trained on; a higher device rate is averaged down.
pub(crate) const TARGET_SAMPLE_RATE_HZ: u32 = 16_000;
/// Suppresses the hardware DC pop / power-up transient when an input device
/// wakes from power-saving mode (~25 ms in practice).
const MICROPHONE_FADE_IN_MS: u32 = 40;
/// Smooths the initial sample when attaching to an active playback stream.
const PLAYBACK_FADE_IN_MS: u32 = 10;
/// Chunks of about 100 ms: what Deepgram recommends, and few enough IPC calls.
const CHUNK_MS: usize = 100;
const POLL_INTERVAL: Duration = Duration::from_millis(20);
const LEVEL_INTERVAL: Duration = Duration::from_millis(40);
const SETUP_TIMEOUT: Duration = Duration::from_secs(10);
/// Generous: a Bluetooth headset switching profiles pauses for seconds.
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(10);
/// After a stream error the samples must go on soon: some backends recover
/// on their own (ALSA retries a failed read), others end the stream with it.
const STREAM_ERROR_GRACE: Duration = Duration::from_secs(1);
const STOP_TIMEOUT: Duration = Duration::from_secs(2);
/// How long a switch of the source may take before the request gives up.
const SWITCH_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone, Serialize, Debug, PartialEq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct VoiceAudioLevelPayload {
    pub level: f32,
    pub peak: f32,
    /// The level of each channel of a capture of several, in their order.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channels: Option<Vec<f32>>,
}

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct VoiceCaptureInfo {
    /// Rate of the PCM16 chunks that follow.
    #[serde(rename = "sampleRate")]
    pub sample_rate_hz: u32,
    /// How many interleaved channels the chunks hold: 2 for a dialog with
    /// the microphone (the microphone, then the computer sound), else 1.
    pub channels: u16,
    /// What `stop_capture` takes to stop this capture and no other.
    pub session_id: u64,
    /// The file name of the call recording, when it was asked for; see
    /// `storage::recordings`.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recording_file: Option<String>,
}

/// Control messages on the audio channel; the audio itself goes as raw bytes.
#[derive(Serialize, Debug, PartialEq, ts_rs::TS)]
#[serde(tag = "type", rename_all = "camelCase")]
#[ts(rename = "VoiceCaptureEvent")]
pub enum CaptureEvent {
    /// Every captured sample has been sent.
    End,
    /// Every captured sample has been sent, and the microphone went to a
    /// newer capture, possibly of another window.
    Superseded,
    Error {
        message: String,
    },
    /// The application a playback source records plays nothing yet, or has
    /// started to.
    #[serde(rename_all = "camelCase")]
    SourceStatus {
        is_waiting: bool,
    },
    /// The application quit: capture waits for the same source without
    /// recording other applications.
    SourceLost {
        source: CaptureSource,
    },
    /// The recording to a file stopped, e.g. the disk is full; the capture
    /// goes on.
    RecordingFailed {
        message: String,
    },
}

/// Device setup is separate from the capture lifecycle and its outputs.
pub(crate) trait AudioSource {
    type Stream;
    fn open(
        &self,
        source: &CaptureSource,
        stop_flag: &Arc<AtomicBool>,
    ) -> Result<OpenedCapture<Self::Stream>, AppError>;
}

pub(crate) struct OpenedCapture<T> {
    pub stream: T,
    pub context: StreamContext,
    pub output_sample_rate_hz: u32,
}

trait AudioLevelSink {
    fn publish(&self, payload: VoiceAudioLevelPayload);
}

impl AudioLevelSink for AppHandle {
    fn publish(&self, payload: VoiceAudioLevelPayload) {
        let _ = crate::events::emit::<crate::events::VoiceAudioLevel, _>(self, payload);
    }
}

pub fn list_input_devices() -> Result<Vec<AudioInputDevice>, AppError> {
    super::platform::audio::list_input_devices()
}

#[allow(clippy::too_many_arguments)]
pub async fn start_capture<S: EventSink>(
    app: &AppHandle,
    state: &VoiceSessionState,
    capture_source: CaptureSource,
    microphone_id: Option<String>,
    is_recorded: bool,
    dialog_id: Option<String>,
    is_microphone_muted: Option<bool>,
    sink: S,
) -> Result<VoiceCaptureInfo, AppError> {
    if capture_source.is_playback() && !super::platform::audio::can_capture_playback() {
        return Err(AppError::ServiceUnavailable(
            "Recording the computer sound is not available on this system".into(),
        ));
    }
    let recording = if is_recorded {
        if !capture_source.is_dialog() {
            return Err(AppError::InvalidInput(
                "Only a dialog is recorded to a file".into(),
            ));
        }
        let dialog_id = dialog_id
            .filter(|id| !id.trim().is_empty())
            .ok_or_else(|| AppError::InvalidInput("A recording requires a dialog id".into()))?;
        Some(new_recording(app, &dialog_id)?)
    } else {
        None
    };
    start_capture_with(
        super::platform::audio::SystemAudioSource { microphone_id },
        capture_source,
        app.clone(),
        state,
        recording,
        is_microphone_muted.unwrap_or(false),
        sink,
    )
    .await
}

/// A recording belongs to its dialog history entry: without dialog history
/// kept on disk, nothing would ever name or remove the file.
fn new_recording(app: &AppHandle, dialog_id: &str) -> Result<RecordingRequest, AppError> {
    use tauri::Manager;
    let config = app.state::<crate::state::AppState>().user_config();
    let policy = super::storage::HistorySettings::from_config(&config).dialog;
    if policy.is_session {
        return Err(AppError::InvalidInput(
            "A call is recorded only while dialog history is saved on disk".into(),
        ));
    }
    let dirs = super::storage::recordings::RecordingDirs::of_app(app)?;
    let local_time = chrono::Local::now().format("%Y-%m-%d %H-%M-%S").to_string();
    let options = crate::models::user_config::dialog_recording(&config);
    Ok(RecordingRequest {
        target: super::storage::recordings::new_recording(&dirs, dialog_id, &local_time)?,
        is_mixed_down: options.is_mixed_down,
        is_processed: options.is_processed,
    })
}

/// Records another source in the running capture: the provider goes on
/// receiving one stream. Only a playback source changes to another one.
pub async fn switch_capture_source(
    state: &VoiceSessionState,
    session_id: u64,
    capture_source: CaptureSource,
) -> Result<(), AppError> {
    if !capture_source.is_playback() || capture_source.is_dialog() {
        return Err(AppError::InvalidInput(
            "A capture switches only between playback sources".into(),
        ));
    }
    let receiver = {
        let _operation = state.lock_capture_operation().await;
        let slot = state
            .switch_slot(session_id)
            .ok_or_else(|| AppError::Stale("The capture to switch is no longer running".into()))?;
        let (reply, receiver) = std_mpsc::sync_channel(1);
        *slot.locked() = Some(SourceSwitch {
            deadline: Instant::now() + Duration::from_secs(10),
            source: capture_source,
            reply,
        });
        receiver
    };
    tokio::task::spawn_blocking(move || {
        receiver
            .recv_timeout(SWITCH_TIMEOUT)
            .unwrap_or_else(|_| Err(AppError::Failed("The source did not switch in time".into())))
    })
    .await
    .map_err(|error| AppError::Failed(format!("source switch task failed: {error}")))?
}

async fn start_capture_with<A, L, S>(
    source: A,
    capture_source: CaptureSource,
    levels: L,
    state: &VoiceSessionState,
    recording: Option<RecordingRequest>,
    is_microphone_muted: bool,
    sink: S,
) -> Result<VoiceCaptureInfo, AppError>
where
    A: AudioSource + Send + 'static,
    L: AudioLevelSink + Send + 'static,
    S: EventSink,
{
    let _operation = state.lock_capture_operation().await;
    if !state.can_start() {
        return Err(AppError::ServiceUnavailable(
            "Voice service is stopping".into(),
        ));
    }
    // The dialog keeps the sound until it is stopped: nothing takes it over
    // but another dialog.
    let is_dialog = capture_source.is_dialog();
    if !is_dialog && state.is_dialog_running() {
        return Err(AppError::CaptureBusy(
            "The sound is taken by the dialog".into(),
        ));
    }
    // One microphone: a new dictation ends the previous one.
    supersede_capture_unlocked(state).await?;
    let session_id = state.allocate_session_id();
    let recording_file = recording
        .as_ref()
        .map(|recording| recording.target.name.clone());
    let (session, format) = tokio::task::spawn_blocking(move || {
        create_capture_session(
            source,
            capture_source,
            levels,
            sink,
            CaptureSessionOptions {
                id: session_id,
                setup_timeout: SETUP_TIMEOUT,
                recording,
                is_microphone_muted,
            },
        )
    })
    .await
    .map_err(|error| AppError::Failed(format!("capture setup task failed: {error}")))??;
    if let Err(session) = state.install(session) {
        let _ =
            tokio::task::spawn_blocking(move || session.stop_until(Instant::now() + STOP_TIMEOUT))
                .await;
        return Err(AppError::ServiceUnavailable(
            "Voice service is stopping".into(),
        ));
    }
    Ok(VoiceCaptureInfo {
        sample_rate_hz: format.sample_rate_hz,
        channels: format.channels,
        session_id,
        recording_file,
    })
}

/// Stops the microphone; returns once the last chunk and `end` are sent.
/// With `session_id`, only that capture is stopped: a newer one goes on.
pub async fn stop_capture(
    state: &VoiceSessionState,
    session_id: Option<u64>,
) -> Result<(), AppError> {
    let _operation = state.lock_capture_operation().await;
    stop_capture_unlocked(state, session_id).await
}

/// Sets whether the microphone channel is muted in the running capture.
pub async fn set_microphone_muted(
    state: &VoiceSessionState,
    session_id: Option<u64>,
    is_muted: bool,
) -> Result<(), AppError> {
    state.set_microphone_muted(session_id, is_muted)
}

async fn stop_capture_unlocked(
    state: &VoiceSessionState,
    session_id: Option<u64>,
) -> Result<(), AppError> {
    let Some(session) = state.take(session_id) else {
        return Ok(());
    };
    tokio::task::spawn_blocking(move || session.stop_until(Instant::now() + STOP_TIMEOUT))
        .await
        .map_err(|error| AppError::Failed(format!("capture stop task failed: {error}")))?
}

/// Stops whatever capture runs, telling its listener that a newer capture
/// took the microphone over.
async fn supersede_capture_unlocked(state: &VoiceSessionState) -> Result<(), AppError> {
    let Some(session) = state.take(None) else {
        return Ok(());
    };
    session.superseded.store(true, Ordering::SeqCst);
    let stopped =
        tokio::task::spawn_blocking(move || session.stop_until(Instant::now() + STOP_TIMEOUT))
            .await
            .map_err(|error| AppError::Failed(format!("capture stop task failed: {error}")))?;
    // the old capture has its stop flag set and gives the device up once its
    // backend lets go: the new one must not fail for that
    if let Err(error) = stopped {
        log::warn!("The previous voice capture did not stop in time: {error}");
    }
    Ok(())
}

/// Shutdown cannot wait indefinitely for a stalled device or event sink.
pub fn stop_capture_on_shutdown(state: &VoiceSessionState, deadline: Instant) {
    if let Some(session) = state.shutdown() {
        if let Err(error) = session.stop_until(deadline) {
            log::warn!("Could not finish voice capture during shutdown: {error}");
        }
    }
}

/// What a capture delivers, known once it records.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct CaptureFormat {
    sample_rate_hz: u32,
    channels: u16,
}

struct CaptureSessionOptions {
    id: u64,
    setup_timeout: Duration,
    is_microphone_muted: bool,
    /// The file the capture is recorded to, if any.
    recording: Option<RecordingRequest>,
}

fn create_capture_session<A, L, S>(
    source: A,
    capture_source: CaptureSource,
    levels: L,
    sink: S,
    options: CaptureSessionOptions,
) -> Result<(VoiceCaptureSession, CaptureFormat), AppError>
where
    A: AudioSource + Send + 'static,
    L: AudioLevelSink + Send + 'static,
    S: EventSink,
{
    let stop_flag = Arc::new(AtomicBool::new(false));
    let thread_stop_flag = Arc::clone(&stop_flag);
    let superseded = Arc::new(AtomicBool::new(false));
    let thread_superseded = Arc::clone(&superseded);
    let switch: SourceSwitchSlot = Arc::default();
    let thread_switch = Arc::clone(&switch);
    let is_dialog = capture_source.is_dialog();
    let CaptureSessionOptions {
        id,
        setup_timeout,
        is_microphone_muted,
        recording,
    } = options;
    let is_microphone_muted = Arc::new(AtomicBool::new(is_microphone_muted));
    let thread_is_microphone_muted = Arc::clone(&is_microphone_muted);
    let (setup_tx, setup_rx) = std_mpsc::sync_channel::<Result<CaptureFormat, AppError>>(1);
    let thread = thread::spawn(move || {
        // only setup can fail; later failures go through the channel
        let control = CaptureControl {
            stop_flag: &thread_stop_flag,
            superseded: &thread_superseded,
            switch: &thread_switch,
            is_microphone_muted: &thread_is_microphone_muted,
            recording,
        };
        if let Err(error) = run_capture_thread(
            &source,
            capture_source,
            &levels,
            &SystemClock,
            &sink,
            &control,
            &setup_tx,
        ) {
            log::error!("Voice capture error: {error}");
            let _ = setup_tx.send(Err(error));
        }
    });

    match setup_rx.recv_timeout(setup_timeout) {
        Ok(Ok(format)) => Ok((
            VoiceCaptureSession {
                id,
                stop_flag,
                superseded,
                is_dialog,
                switch,
                is_microphone_muted,
                thread,
            },
            format,
        )),
        Ok(Err(error)) => {
            let _ = thread.join();
            Err(error)
        }
        Err(error) => {
            // the thread is most likely stuck opening the device; joining it
            // would hang this call and every later start behind the capture
            // lock, so it is left to finish on its own
            stop_flag.store(true, Ordering::SeqCst);
            drop(thread);
            Err(AppError::Failed(format!(
                "The microphone did not start in time: {error}"
            )))
        }
    }
}

/// What the capture thread is told from outside while it records.
struct CaptureControl<'a> {
    stop_flag: &'a Arc<AtomicBool>,
    superseded: &'a AtomicBool,
    switch: &'a SourceSwitchSlot,
    is_microphone_muted: &'a AtomicBool,
    recording: Option<RecordingRequest>,
}

fn run_capture_thread<A: AudioSource, L: AudioLevelSink, S: EventSink>(
    source: &A,
    capture_source: CaptureSource,
    levels: &L,
    clock: &impl MonotonicClock,
    sink: &S,
    control: &CaptureControl<'_>,
    setup_tx: &std_mpsc::SyncSender<Result<CaptureFormat, AppError>>,
) -> Result<(), AppError> {
    let stop_flag = control.stop_flag;
    let OpenedCapture {
        mut stream,
        mut context,
        output_sample_rate_hz,
    } = source.open(&capture_source, stop_flag)?;
    let channel_count = context.channel_count.max(1);
    // the file exists before the capture is reported started: a folder that
    // cannot be written fails the start
    let mut recording = control
        .recording
        .clone()
        .map(|recording| RecordingSink::start(recording, output_sample_rate_hz, channel_count))
        .transpose()?;
    let mut dump = CaptureDump::from_env(output_sample_rate_hz, channel_count);

    setup_tx
        .send(Ok(CaptureFormat {
            sample_rate_hz: output_sample_rate_hz,
            channels: channel_count,
        }))
        .map_err(|error| AppError::Failed(error.to_string()))?;

    let mut active_source = capture_source;
    let channels = usize::from(channel_count);
    let chunk_samples = output_sample_rate_hz as usize * CHUNK_MS / 1_000 * channels;
    let mut channel_levels = ChannelLevels::new(channels);
    let started = clock.now();
    let mut delivered_samples: u64 = 0;
    let mut last_level = started;
    let mut last_callback = last_level;
    let mut callback_count = context.callback_count.load(Ordering::Relaxed);
    let mut reported_status = SourceStatus::default();
    let mut has_reported_status = !active_source.is_playback();
    while !stop_flag.load(Ordering::SeqCst) {
        clock.sleep(POLL_INTERVAL);

        let requested = control.switch.locked().take();
        let lost = context.status.locked().is_lost;
        if lost {
            // Losing an application must not expand recording to other apps.
            context.status.locked().is_lost = false;
            sink.send_event(&CaptureEvent::SourceLost {
                source: active_source.clone(),
            });
        }
        if let Some(SourceSwitch {
            deadline,
            source: next_source,
            reply,
        }) = requested
        {
            match source.open(&next_source, stop_flag) {
                Ok(opened) if Instant::now() >= deadline => {
                    drop(opened);
                    let _ = reply.send(Err(AppError::Stale("Source switch expired".into())));
                }
                Ok(opened)
                    if opened.output_sample_rate_hz == output_sample_rate_hz
                        && opened.context.channel_count.max(1) == channel_count =>
                {
                    // the old stream's last samples go out before the new ones
                    drop(std::mem::replace(&mut stream, opened.stream));
                    // The new stream ran during setup while the old stream still
                    // recorded. Discard that overlap at the handover boundary.
                    opened.context.pending_pcm_samples.locked().clear();
                    active_source = next_source;
                    let old = std::mem::replace(&mut context, opened.context);
                    let tail = std::mem::take(&mut *old.pending_pcm_samples.locked());
                    context.pending_pcm_samples.locked().splice(0..0, tail);
                    callback_count = context.callback_count.load(Ordering::Relaxed);
                    last_callback = clock.now();
                    reported_status = SourceStatus::default();
                    has_reported_status = false;
                    let _ = reply.send(Ok(()));
                }
                Ok(_) => {
                    let error = AppError::Failed("The new source records at another rate".into());
                    let _ = reply.send(Err(error));
                }
                Err(error) => {
                    let _ = reply.send(Err(error));
                }
            }
        }

        let received = context.callback_count.load(Ordering::Relaxed);
        if received != callback_count {
            callback_count = received;
            last_callback = clock.now();
            if let Some(message) = context.recoverable_error.locked().take() {
                log::info!("Voice capture recovered from: {message}");
            }
        } else if !stop_flag.load(Ordering::SeqCst) {
            let silent_for = clock.now().saturating_duration_since(last_callback);
            let recoverable_error = context.recoverable_error.locked().clone();
            let is_failed = match recoverable_error {
                Some(_) => silent_for >= STREAM_ERROR_GRACE,
                // a playback source has no callbacks while nothing plays
                None => !context.fills_gaps && silent_for >= CALLBACK_TIMEOUT,
            };
            if is_failed {
                // Some audio backends cork a disconnected device without
                // invoking CPAL's error callback. Silence still produces
                // callbacks.
                *context.stream_error.locked() = Some(
                    recoverable_error
                        .unwrap_or_else(|| "Audio input stopped delivering samples".into()),
                );
                stop_flag.store(true, Ordering::SeqCst);
                break;
            }
        }
        if context.stream_error.locked().is_some() {
            stop_flag.store(true, Ordering::SeqCst);
            break;
        }

        let status = *context.status.locked();
        if !has_reported_status || status.is_waiting != reported_status.is_waiting {
            sink.send_event(&CaptureEvent::SourceStatus {
                is_waiting: status.is_waiting,
            });
        }
        reported_status = status;
        has_reported_status = true;

        if context.fills_gaps {
            let elapsed = clock.now().saturating_duration_since(started);
            let expected = elapsed.as_millis() as u64 * u64::from(output_sample_rate_hz) / 1_000;
            let mut pending = context.pending_pcm_samples.locked();
            let frames = (delivered_samples + pending.len() as u64) / channels as u64;
            let gap = silence_gap(expected, frames, output_sample_rate_hz);
            pending.extend(std::iter::repeat_n(0, gap * channels));
        }

        let is_muted = control.is_microphone_muted.load(Ordering::Relaxed);
        if channels > 1 {
            let mut pending = context.pending_pcm_samples.locked();
            if is_muted {
                for sample in pending.iter_mut().step_by(channels) {
                    *sample = 0;
                }
            }
            channel_levels.measure(&pending);
        }
        if let Some(message) = recording.as_mut().and_then(RecordingSink::take_failure) {
            sink.send_event(&CaptureEvent::RecordingFailed { message });
        }
        match flush_pending(
            &context,
            sink,
            chunk_samples,
            recording.as_mut(),
            Some(&mut dump),
            is_muted,
            channels,
        ) {
            Some(sent) => delivered_samples += sent as u64,
            None => {
                // nobody is listening any more: the webview went away
                stop_flag.store(true, Ordering::SeqCst);
                break;
            }
        }

        if clock.now().saturating_duration_since(last_level) >= LEVEL_INTERVAL {
            last_level = clock.now();
            // the loudest moment since the last publish, not just the latest
            let (level, peak) = std::mem::take(&mut *context.current_level.locked());
            levels.publish(VoiceAudioLevelPayload {
                level,
                peak,
                channels: channel_levels.take(),
            });
        }
    }
    // a switch that came too late is answered: the capture is over
    if let Some(request) = control.switch.locked().take() {
        let _ = request.reply.send(Err(AppError::Stale(
            "The capture stopped before the source switched".into(),
        )));
    }

    // no sample may arrive after the final flush
    drop(stream);
    levels.publish(VoiceAudioLevelPayload {
        level: 0.0,
        peak: 0.0,
        channels: (channels > 1).then(|| vec![0.0; channels]),
    });

    // what was captured goes out first, whatever ended the capture: the
    // words spoken last are still transcribed
    let is_delivered = flush_pending(
        &context,
        sink,
        1,
        recording.as_mut(),
        Some(&mut dump),
        control.is_microphone_muted.load(Ordering::Relaxed),
        channels,
    )
    .is_some();
    // the file is complete whether or not anyone still listens
    let late_failure = recording.and_then(RecordingSink::finish);
    if !is_delivered {
        return Ok(());
    }
    // before the end: the listener still knows the session to mark
    if let Some(message) = late_failure {
        sink.send_event(&CaptureEvent::RecordingFailed { message });
    }
    let stream_error = context.stream_error.locked().take();
    let event = match stream_error {
        Some(message) => CaptureEvent::Error { message },
        None if control.superseded.load(Ordering::SeqCst) => CaptureEvent::Superseded,
        None => CaptureEvent::End,
    };
    sink.send_event(&event);
    Ok(())
}

/// The loudest level of each channel of interleaved samples since it was
/// last taken. Samples still pending are measured again on the next poll,
/// which leaves a maximum as it is.
struct ChannelLevels {
    levels: Vec<f32>,
}

impl ChannelLevels {
    fn new(channels: usize) -> Self {
        Self {
            levels: vec![0.0; channels],
        }
    }

    fn measure(&mut self, interleaved: &[i16]) {
        let channels = self.levels.len();
        for (channel, level) in self.levels.iter_mut().enumerate() {
            let samples: Vec<i16> = interleaved
                .iter()
                .skip(channel)
                .step_by(channels)
                .copied()
                .collect();
            if !samples.is_empty() {
                *level = level.max(compute_audio_level(&samples).0);
            }
        }
    }

    /// `None` for mono: its level is the capture's.
    fn take(&mut self) -> Option<Vec<f32>> {
        if self.levels.len() < 2 {
            return None;
        }
        let channels = self.levels.len();
        Some(std::mem::replace(&mut self.levels, vec![0.0; channels]))
    }
}

/// Sends what has accumulated once it reaches `min_samples`: the number of
/// samples sent, `None` when the receiving side is gone. A processed
/// recording gets the very same samples: the file is what the speech
/// provider was sent; an unprocessed one gets them as they were before the
/// echo gate and the limiter, where the capture has them. A debugging dump
/// gets what is sent, see `debug_dump`.
fn flush_pending<S: EventSink>(
    context: &StreamContext,
    sink: &S,
    min_samples: usize,
    recording: Option<&mut RecordingSink>,
    dump: Option<&mut CaptureDump>,
    is_microphone_muted: bool,
    channels: usize,
) -> Option<usize> {
    let mut samples = match context.pending_pcm_samples.lock() {
        Ok(mut pending_pcm_samples) if pending_pcm_samples.len() >= min_samples => {
            std::mem::take(&mut *pending_pcm_samples)
        }
        _ => return Some(0),
    };
    let count = samples.len();
    if is_microphone_muted && channels > 1 {
        for sample in samples.iter_mut().step_by(channels) {
            *sample = 0;
        }
    }
    // taken whatever the recording, so that it does not pile up
    let mut unprocessed = context
        .unprocessed_pcm_samples
        .as_ref()
        .map(|unprocessed| std::mem::take(&mut *unprocessed.locked()));
    if is_microphone_muted && channels > 1 {
        if let Some(unprocessed) = unprocessed.as_mut() {
            for sample in unprocessed.iter_mut().step_by(channels) {
                *sample = 0;
            }
        }
    }
    if let Some(recording) = recording {
        match unprocessed {
            Some(unprocessed) if !recording.is_processed() => recording.push(&unprocessed),
            _ => recording.push(&samples),
        }
    }
    let bytes = pcm16_to_le_bytes(&samples);
    if let Some(dump) = dump {
        dump.push(&bytes);
    }
    sink.send_bytes(bytes).then_some(count)
}

pub(crate) struct StreamContext {
    pub pending_pcm_samples: Arc<Mutex<Vec<i16>>>,
    /// Ends the capture as soon as the capture loop sees it
    pub stream_error: Arc<Mutex<Option<String>>>,
    /// A stream error the backend may recover from: it ends the capture only
    /// when no samples follow, see `STREAM_ERROR_GRACE`
    pub recoverable_error: Arc<Mutex<Option<String>>>,
    pub current_level: Arc<Mutex<(f32, f32)>>,
    pub callback_count: Arc<AtomicU64>,
    pub stop_flag: Arc<AtomicBool>,
    pub device_sample_rate_hz: u32,
    pub output_sample_rate_hz: u32,
    /// A playback source: silence stands in for the samples it does not
    /// deliver while nothing plays, see `silence_gap`
    pub fills_gaps: bool,
    /// Interleaved channels of `pending_pcm_samples`, 1 for mono
    pub channel_count: u16,
    pub status: Arc<Mutex<SourceStatus>>,
    /// The same samples before the echo gate and the limiter, for a call
    /// recording that is not processed; only a dialog with the microphone
    /// has them, see `microphone_mix`.
    pub unprocessed_pcm_samples: Option<Arc<Mutex<Vec<i16>>>>,
}

/// Turns the interleaved float frames of a playback device into the
/// samples of a `StreamContext`: mixed down and brought to its rate.
pub(crate) struct PlaybackConverter {
    downsampler: Downsampler,
    fade_in: StartupFadeIn,
    channels: usize,
    converted: Vec<i16>,
}

impl PlaybackConverter {
    pub(crate) fn new(
        device_sample_rate_hz: u32,
        output_sample_rate_hz: u32,
        channels: usize,
    ) -> Self {
        Self {
            downsampler: Downsampler::new(device_sample_rate_hz, output_sample_rate_hz),
            fade_in: StartupFadeIn::new(device_sample_rate_hz, PLAYBACK_FADE_IN_MS),
            channels: channels.max(1),
            converted: Vec::new(),
        }
    }

    pub(crate) fn deliver(&mut self, context: &StreamContext, interleaved: &[f32]) {
        context.callback_count.fetch_add(1, Ordering::Relaxed);
        self.converted.clear();
        for frame in interleaved.chunks(self.channels) {
            let sample = self.fade_in.apply_f32(mix_frame(frame));
            self.downsampler.push(sample, &mut self.converted);
        }
        if self.converted.is_empty() {
            return;
        }
        if let Ok(mut level) = context.current_level.lock() {
            let (rms, peak) = compute_audio_level(&self.converted);
            *level = (level.0.max(rms), level.1.max(peak));
        }
        if let Ok(mut pending) = context.pending_pcm_samples.lock() {
            pending.extend_from_slice(&self.converted);
        }
    }
}

impl StreamContext {
    pub(crate) fn new(
        stop_flag: &Arc<AtomicBool>,
        device_sample_rate_hz: u32,
        output_sample_rate_hz: u32,
    ) -> Self {
        Self {
            pending_pcm_samples: Arc::default(),
            stream_error: Arc::default(),
            recoverable_error: Arc::default(),
            current_level: Arc::default(),
            callback_count: Arc::default(),
            stop_flag: Arc::clone(stop_flag),
            device_sample_rate_hz,
            output_sample_rate_hz,
            fills_gaps: false,
            channel_count: 1,
            status: Arc::default(),
            unprocessed_pcm_samples: None,
        }
    }
}

/// A device that is gone does not come back; other errors may pass, see
/// `STREAM_ERROR_GRACE`.
fn is_fatal_stream_error(error: &cpal::StreamError) -> bool {
    matches!(error, cpal::StreamError::DeviceNotAvailable)
}

pub(crate) fn build_input_stream<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    context: &StreamContext,
) -> Result<cpal::Stream, AppError>
where
    T: cpal::SizedSample,
    f32: cpal::FromSample<T>,
{
    let channels = usize::from(config.channels);
    if channels == 0 {
        return Err(AppError::ServiceUnavailable(
            "The input device reports no channels".into(),
        ));
    }
    let callback_count = Arc::clone(&context.callback_count);
    let pending_pcm_samples = Arc::clone(&context.pending_pcm_samples);
    let level_monitor = Arc::clone(&context.current_level);
    let stream_error = Arc::clone(&context.stream_error);
    let recoverable_error = Arc::clone(&context.recoverable_error);
    let error_stop_flag = Arc::clone(&context.stop_flag);
    let mut downsampler =
        Downsampler::new(context.device_sample_rate_hz, context.output_sample_rate_hz);
    let mut fade_in = StartupFadeIn::new(context.device_sample_rate_hz, MICROPHONE_FADE_IN_MS);
    let mut converted = Vec::new();
    let error_callback = move |error: cpal::StreamError| {
        let message = format!("Audio input stream failed: {error}");
        if is_fatal_stream_error(&error) {
            log::error!("Voice capture audio input stream error: {error}");
            *stream_error.locked() = Some(message);
            error_stop_flag.store(true, Ordering::SeqCst);
        } else {
            log::warn!("Voice capture audio input stream error: {error}");
            *recoverable_error.locked() = Some(message);
        }
    };
    device
        .build_input_stream(
            config,
            move |data: &[T], _| {
                if !data.is_empty() {
                    callback_count.fetch_add(1, Ordering::Relaxed);
                }
                converted.clear();
                for frame in data.chunks(channels) {
                    if !frame.is_empty() {
                        let sample = fade_in.apply_f32(mix_frame(frame));
                        downsampler.push(sample, &mut converted);
                    }
                }
                if converted.is_empty() {
                    return;
                }
                if let Ok(mut level) = level_monitor.lock() {
                    // kept until published: a short loud callback must show
                    let (rms, peak) = compute_audio_level(&converted);
                    *level = (level.0.max(rms), level.1.max(peak));
                }
                if let Ok(mut pending_pcm_samples) = pending_pcm_samples.lock() {
                    pending_pcm_samples.extend_from_slice(&converted);
                }
            },
            error_callback,
            None,
        )
        .map_err(|error| AppError::ServiceUnavailable(error.to_string()))
}

#[cfg(test)]
mod tests;
