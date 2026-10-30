//! Microphone capture for live dictation.
//!
//! Nothing is kept: the audio leaves as PCM16 mono chunks through the channel
//! the webview passed in, which hands it on to the speech provider's socket.
//! A dictation can therefore last as long as the user keeps talking.

mod audio_processing;
pub mod session;

pub use audio_processing::compute_audio_level;
use audio_processing::{mix_frame, pcm16_to_le_bytes, Downsampler};

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
use crate::services::voice::session::VoiceCaptureSession;
use crate::services::voice::session::VoiceSessionState;

/// What speech models are trained on; a higher device rate is averaged down.
pub(crate) const TARGET_SAMPLE_RATE_HZ: u32 = 16_000;
/// Chunks of about 100 ms: what Deepgram recommends, and few enough IPC calls.
const CHUNK_MS: usize = 100;
const POLL_INTERVAL: Duration = Duration::from_millis(20);
const LEVEL_INTERVAL: Duration = Duration::from_millis(40);
const SETUP_TIMEOUT: Duration = Duration::from_secs(10);
/// Generous: a Bluetooth headset switching profiles pauses for seconds.
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(10);
const STOP_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Clone, Serialize, Debug, PartialEq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct VoiceAudioLevelPayload {
    pub level: f32,
    pub peak: f32,
}

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct VoiceCaptureInfo {
    /// Rate of the PCM16 mono chunks that follow.
    #[serde(rename = "sampleRate")]
    pub sample_rate_hz: u32,
    /// What `stop_capture` takes to stop this capture and no other.
    pub session_id: u64,
}

/// Control messages on the audio channel; the audio itself goes as raw bytes.
#[derive(Serialize, Debug, PartialEq, ts_rs::TS)]
#[serde(tag = "type", rename_all = "camelCase")]
#[ts(rename = "VoiceCaptureEvent")]
pub enum CaptureEvent {
    /// Every captured sample has been sent.
    End,
    Error {
        message: String,
    },
}

/// Device setup is separate from the capture lifecycle and its outputs.
pub(crate) trait AudioSource {
    type Stream;
    fn open(&self, stop_flag: &Arc<AtomicBool>) -> Result<OpenedCapture<Self::Stream>, AppError>;
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

pub async fn start_capture<S: EventSink>(
    app: &AppHandle,
    state: &VoiceSessionState,
    sink: S,
) -> Result<VoiceCaptureInfo, AppError> {
    start_capture_with(
        super::platform::audio::SystemAudioSource,
        app.clone(),
        state,
        sink,
    )
    .await
}

async fn start_capture_with<A, L, S>(
    source: A,
    levels: L,
    state: &VoiceSessionState,
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
    // One microphone: a new dictation ends the previous one.
    stop_capture_unlocked(state, None).await?;
    let session_id = state.allocate_session_id();
    let (session, sample_rate_hz) = tokio::task::spawn_blocking(move || {
        create_capture_session(source, levels, sink, session_id, SETUP_TIMEOUT)
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
        sample_rate_hz,
        session_id,
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

/// Shutdown cannot wait indefinitely for a stalled device or event sink.
pub fn stop_capture_on_shutdown(state: &VoiceSessionState, deadline: Instant) {
    if let Some(session) = state.shutdown() {
        if let Err(error) = session.stop_until(deadline) {
            log::warn!("Could not finish voice capture during shutdown: {error}");
        }
    }
}

fn create_capture_session<A, L, S>(
    source: A,
    levels: L,
    sink: S,
    id: u64,
    setup_timeout: Duration,
) -> Result<(VoiceCaptureSession, u32), AppError>
where
    A: AudioSource + Send + 'static,
    L: AudioLevelSink + Send + 'static,
    S: EventSink,
{
    let stop_flag = Arc::new(AtomicBool::new(false));
    let thread_stop_flag = Arc::clone(&stop_flag);
    let (setup_tx, setup_rx) = std_mpsc::sync_channel::<Result<u32, AppError>>(1);
    let thread = thread::spawn(move || {
        // only setup can fail; later failures go through the channel
        if let Err(error) = run_capture_thread(
            &source,
            &levels,
            &SystemClock,
            &sink,
            &thread_stop_flag,
            &setup_tx,
        ) {
            log::error!("Voice capture error: {error}");
            let _ = setup_tx.send(Err(error));
        }
    });

    match setup_rx.recv_timeout(setup_timeout) {
        Ok(Ok(sample_rate_hz)) => Ok((
            VoiceCaptureSession {
                id,
                stop_flag,
                thread,
            },
            sample_rate_hz,
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

fn run_capture_thread<A: AudioSource, L: AudioLevelSink, S: EventSink>(
    source: &A,
    levels: &L,
    clock: &impl MonotonicClock,
    sink: &S,
    stop_flag: &Arc<AtomicBool>,
    setup_tx: &std_mpsc::SyncSender<Result<u32, AppError>>,
) -> Result<(), AppError> {
    let OpenedCapture {
        stream,
        context,
        output_sample_rate_hz,
    } = source.open(stop_flag)?;

    setup_tx
        .send(Ok(output_sample_rate_hz))
        .map_err(|error| AppError::Failed(error.to_string()))?;

    let chunk_samples = output_sample_rate_hz as usize * CHUNK_MS / 1_000;
    let mut last_level = clock.now();
    let mut last_callback = last_level;
    let mut callback_count = context.callback_count.load(Ordering::Relaxed);
    while !stop_flag.load(Ordering::SeqCst) {
        clock.sleep(POLL_INTERVAL);

        let received = context.callback_count.load(Ordering::Relaxed);
        if received != callback_count {
            callback_count = received;
            last_callback = clock.now();
        } else if !stop_flag.load(Ordering::SeqCst)
            && clock.now().saturating_duration_since(last_callback) >= CALLBACK_TIMEOUT
        {
            // Some audio backends cork a disconnected device without invoking
            // CPAL's error callback. Silence still produces callbacks.
            *context.stream_error.locked() = Some("Audio input stopped delivering samples".into());
            stop_flag.store(true, Ordering::SeqCst);
            break;
        }

        if !flush_pending(&context.pending_pcm_samples, sink, chunk_samples) {
            // nobody is listening any more: the webview went away
            stop_flag.store(true, Ordering::SeqCst);
            break;
        }

        if clock.now().saturating_duration_since(last_level) >= LEVEL_INTERVAL {
            last_level = clock.now();
            // the loudest moment since the last publish, not just the latest
            let (level, peak) = std::mem::take(&mut *context.current_level.locked());
            levels.publish(VoiceAudioLevelPayload { level, peak });
        }
    }

    // no sample may arrive after the final flush
    drop(stream);
    levels.publish(VoiceAudioLevelPayload {
        level: 0.0,
        peak: 0.0,
    });

    let stream_error = context.stream_error.locked().take();
    if let Some(message) = stream_error {
        sink.send_event(&CaptureEvent::Error { message });
        return Ok(());
    }

    if flush_pending(&context.pending_pcm_samples, sink, 1) {
        sink.send_event(&CaptureEvent::End);
    }
    Ok(())
}

/// Sends what has accumulated once it reaches `min_samples`; false when the
/// receiving side is gone.
fn flush_pending<S: EventSink>(
    pending_pcm_samples: &Mutex<Vec<i16>>,
    sink: &S,
    min_samples: usize,
) -> bool {
    let samples = match pending_pcm_samples.lock() {
        Ok(mut pending_pcm_samples) if pending_pcm_samples.len() >= min_samples => {
            std::mem::take(&mut *pending_pcm_samples)
        }
        _ => return true,
    };
    sink.send_bytes(pcm16_to_le_bytes(&samples))
}

pub(crate) struct StreamContext {
    pub pending_pcm_samples: Arc<Mutex<Vec<i16>>>,
    pub stream_error: Arc<Mutex<Option<String>>>,
    pub current_level: Arc<Mutex<(f32, f32)>>,
    pub callback_count: Arc<AtomicU64>,
    pub stop_flag: Arc<AtomicBool>,
    pub device_sample_rate_hz: u32,
    pub output_sample_rate_hz: u32,
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
    let error_stop_flag = Arc::clone(&context.stop_flag);
    let mut downsampler =
        Downsampler::new(context.device_sample_rate_hz, context.output_sample_rate_hz);
    let mut converted = Vec::new();
    let error_callback = move |error| {
        log::error!("Voice capture audio input stream error: {error}");
        if let Ok(mut current_error) = stream_error.lock() {
            *current_error = Some(format!("Audio input stream failed: {error}"));
        }
        error_stop_flag.store(true, Ordering::SeqCst);
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
                        downsampler.push(mix_frame(frame), &mut converted);
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
