//! Audio capture for live transcription: the microphone for dictation, the
//! sound the computer plays for listening.
//!
//! Nothing is kept: the audio leaves as PCM16 mono chunks through the channel
//! the webview passed in, which hands it on to the speech provider's socket.
//! A dictation can therefore last as long as the user keeps talking.

pub mod apps;
mod audio_processing;
pub mod mixer;
pub mod session;
pub mod source;

pub use source::{
    silence_gap, AudioApp, AudioAppId, AudioInputDevice, CaptureSource, SourceStatus,
};

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
use crate::services::voice::session::VoiceSessionState;
use crate::services::voice::session::{SourceSwitch, SourceSwitchSlot, VoiceCaptureSession};

/// What speech models are trained on; a higher device rate is averaged down.
pub(crate) const TARGET_SAMPLE_RATE_HZ: u32 = 16_000;
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

pub async fn start_capture<S: EventSink>(
    app: &AppHandle,
    state: &VoiceSessionState,
    capture_source: CaptureSource,
    microphone_id: Option<String>,
    sink: S,
) -> Result<VoiceCaptureInfo, AppError> {
    if capture_source.is_playback() && !super::platform::audio::can_capture_playback() {
        return Err(AppError::ServiceUnavailable(
            "Recording the computer sound is not available on this system".into(),
        ));
    }
    start_capture_with(
        super::platform::audio::SystemAudioSource { microphone_id },
        capture_source,
        app.clone(),
        state,
        sink,
    )
    .await
}

/// Records another source in the running capture: the provider goes on
/// receiving one stream. Only a playback source changes to another one.
pub async fn switch_capture_source(
    state: &VoiceSessionState,
    session_id: u64,
    capture_source: CaptureSource,
) -> Result<(), AppError> {
    if !capture_source.is_playback() {
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
    supersede_capture_unlocked(state).await?;
    let session_id = state.allocate_session_id();
    let (session, sample_rate_hz) = tokio::task::spawn_blocking(move || {
        create_capture_session(
            source,
            capture_source,
            levels,
            sink,
            session_id,
            SETUP_TIMEOUT,
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

fn create_capture_session<A, L, S>(
    source: A,
    capture_source: CaptureSource,
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
    let superseded = Arc::new(AtomicBool::new(false));
    let thread_superseded = Arc::clone(&superseded);
    let switch: SourceSwitchSlot = Arc::default();
    let thread_switch = Arc::clone(&switch);
    let (setup_tx, setup_rx) = std_mpsc::sync_channel::<Result<u32, AppError>>(1);
    let thread = thread::spawn(move || {
        // only setup can fail; later failures go through the channel
        let control = CaptureControl {
            stop_flag: &thread_stop_flag,
            superseded: &thread_superseded,
            switch: &thread_switch,
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
        Ok(Ok(sample_rate_hz)) => Ok((
            VoiceCaptureSession {
                id,
                stop_flag,
                superseded,
                switch,
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

/// What the capture thread is told from outside while it records.
struct CaptureControl<'a> {
    stop_flag: &'a Arc<AtomicBool>,
    superseded: &'a AtomicBool,
    switch: &'a SourceSwitchSlot,
}

fn run_capture_thread<A: AudioSource, L: AudioLevelSink, S: EventSink>(
    source: &A,
    capture_source: CaptureSource,
    levels: &L,
    clock: &impl MonotonicClock,
    sink: &S,
    control: &CaptureControl<'_>,
    setup_tx: &std_mpsc::SyncSender<Result<u32, AppError>>,
) -> Result<(), AppError> {
    let stop_flag = control.stop_flag;
    let OpenedCapture {
        mut stream,
        mut context,
        output_sample_rate_hz,
    } = source.open(&capture_source, stop_flag)?;

    setup_tx
        .send(Ok(output_sample_rate_hz))
        .map_err(|error| AppError::Failed(error.to_string()))?;

    let mut active_source = capture_source;
    let chunk_samples = output_sample_rate_hz as usize * CHUNK_MS / 1_000;
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
                Ok(opened) if opened.output_sample_rate_hz == output_sample_rate_hz => {
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
            let gap = silence_gap(
                expected,
                delivered_samples + pending.len() as u64,
                output_sample_rate_hz,
            );
            pending.extend(std::iter::repeat_n(0, gap));
        }

        match flush_pending(&context.pending_pcm_samples, sink, chunk_samples) {
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
            levels.publish(VoiceAudioLevelPayload { level, peak });
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
    });

    // what was captured goes out first, whatever ended the capture: the
    // words spoken last are still transcribed
    if flush_pending(&context.pending_pcm_samples, sink, 1).is_none() {
        return Ok(());
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

/// Sends what has accumulated once it reaches `min_samples`: the number of
/// samples sent, `None` when the receiving side is gone.
fn flush_pending<S: EventSink>(
    pending_pcm_samples: &Mutex<Vec<i16>>,
    sink: &S,
    min_samples: usize,
) -> Option<usize> {
    let samples = match pending_pcm_samples.lock() {
        Ok(mut pending_pcm_samples) if pending_pcm_samples.len() >= min_samples => {
            std::mem::take(&mut *pending_pcm_samples)
        }
        _ => return Some(0),
    };
    let count = samples.len();
    sink.send_bytes(pcm16_to_le_bytes(&samples))
        .then_some(count)
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
    pub status: Arc<Mutex<SourceStatus>>,
}

/// Turns the interleaved float frames of a playback device into the
/// samples of a `StreamContext`: mixed down and brought to its rate.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub(crate) struct PlaybackConverter {
    downsampler: Downsampler,
    channels: usize,
    converted: Vec<i16>,
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
impl PlaybackConverter {
    pub(crate) fn new(
        device_sample_rate_hz: u32,
        output_sample_rate_hz: u32,
        channels: usize,
    ) -> Self {
        Self {
            downsampler: Downsampler::new(device_sample_rate_hz, output_sample_rate_hz),
            channels: channels.max(1),
            converted: Vec::new(),
        }
    }

    pub(crate) fn deliver(&mut self, context: &StreamContext, interleaved: &[f32]) {
        context.callback_count.fetch_add(1, Ordering::Relaxed);
        self.converted.clear();
        for frame in interleaved.chunks(self.channels) {
            self.downsampler.push(mix_frame(frame), &mut self.converted);
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
            status: Arc::default(),
        }
    }

    /// Adds samples a playback backend converted to the output format.
    pub(crate) fn deliver(&self, samples: &[f32]) {
        self.callback_count.fetch_add(1, Ordering::Relaxed);
        if samples.is_empty() {
            return;
        }
        let converted: Vec<i16> = samples
            .iter()
            .map(|sample| (sample.clamp(-1.0, 1.0) * f32::from(i16::MAX)) as i16)
            .collect();
        if let Ok(mut level) = self.current_level.lock() {
            let (rms, peak) = compute_audio_level(&converted);
            *level = (level.0.max(rms), level.1.max(peak));
        }
        if let Ok(mut pending) = self.pending_pcm_samples.lock() {
            pending.extend_from_slice(&converted);
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
