//! Microphone capture for live dictation.
//!
//! Nothing is kept: the audio leaves as PCM16 mono chunks through the channel
//! the webview passed in, which hands it on to the speech provider's socket.
//! A dictation can therefore last as long as the user keeps talking.

mod audio_processing;

pub use audio_processing::compute_audio_level;
use audio_processing::{mix_frame, pcm16_to_le_bytes, Downsampler};

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc as std_mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use cpal::traits::DeviceTrait;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::errors::AppError;
use crate::services::net::EventSink;
use crate::services::voice_session::VoiceCaptureSession;
use crate::state::AppState;

pub const VOICE_AUDIO_LEVEL_EVENT: &str = "app://voice-audio-level";

/// What speech models are trained on; a higher device rate is averaged down.
pub(crate) const TARGET_SAMPLE_RATE_HZ: u32 = 16_000;
/// Chunks of about 100 ms: what Deepgram recommends, and few enough IPC calls.
const CHUNK_MS: usize = 100;
const POLL_INTERVAL: Duration = Duration::from_millis(20);
const LEVEL_INTERVAL: Duration = Duration::from_millis(40);
const SETUP_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VoiceAudioLevelPayload {
    pub level: f32,
    pub peak: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceCaptureInfo {
    /// Rate of the PCM16 mono chunks that follow.
    #[serde(rename = "sampleRate")]
    pub sample_rate_hz: u32,
    /// What `stop_capture` takes to stop this capture and no other.
    pub session_id: u64,
}

/// Control messages on the audio channel; the audio itself goes as raw bytes.
#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
enum CaptureEvent {
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
        let _ = self.emit(VOICE_AUDIO_LEVEL_EVENT, payload);
    }
}

trait CaptureRuntime {
    fn now(&self) -> Instant;
    fn sleep_poll_interval(&self);
}

struct SystemCaptureRuntime;

impl CaptureRuntime for SystemCaptureRuntime {
    fn now(&self) -> Instant {
        Instant::now()
    }
    fn sleep_poll_interval(&self) {
        thread::sleep(POLL_INTERVAL);
    }
}

pub async fn start_capture<S: EventSink>(
    app: &AppHandle,
    state: &AppState,
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
    state: &AppState,
    sink: S,
) -> Result<VoiceCaptureInfo, AppError>
where
    A: AudioSource + Send + 'static,
    L: AudioLevelSink + Send + 'static,
    S: EventSink,
{
    let _operation = state.voice_session.lock_capture_operation().await;
    // One microphone: a new dictation ends the previous one.
    stop_capture_unlocked(state, None).await?;
    let session_id = state.voice_session.allocate_session_id();
    let (session, sample_rate_hz) = tokio::task::spawn_blocking(move || {
        create_capture_session(source, levels, sink, session_id, SETUP_TIMEOUT)
    })
    .await
    .map_err(|error| AppError::Message(format!("capture setup task failed: {error}")))??;
    state.voice_session.replace(Some(session));
    Ok(VoiceCaptureInfo {
        sample_rate_hz,
        session_id,
    })
}

/// Stops the microphone; returns once the last chunk and `end` are sent.
/// With `session_id`, only that capture is stopped: a newer one goes on.
pub async fn stop_capture(state: &AppState, session_id: Option<u64>) -> Result<(), AppError> {
    let _operation = state.voice_session.lock_capture_operation().await;
    stop_capture_unlocked(state, session_id).await
}

async fn stop_capture_unlocked(state: &AppState, session_id: Option<u64>) -> Result<(), AppError> {
    let Some(session) = state.voice_session.take(session_id) else {
        return Ok(());
    };
    tokio::task::spawn_blocking(move || {
        session.stop_flag.store(true, Ordering::SeqCst);
        session
            .thread
            .join()
            .map_err(|_| AppError::Message(String::from("voice capture thread panicked")))
    })
    .await
    .map_err(|error| AppError::Message(format!("capture stop task failed: {error}")))?
}

/// Signals the active voice capture thread to stop on shutdown.
pub fn stop_capture_on_shutdown(state: &AppState) {
    if let Some(session) = state.voice_session.replace(None) {
        session.stop_flag.store(true, Ordering::SeqCst);
        let _ = session.thread.join();
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
    let (setup_tx, setup_rx) = std_mpsc::sync_channel::<Result<u32, String>>(1);
    let thread = thread::spawn(move || {
        // only setup can fail; later failures go through the channel
        if let Err(error) = run_capture_thread(
            &source,
            &levels,
            &SystemCaptureRuntime,
            &sink,
            &thread_stop_flag,
            &setup_tx,
        ) {
            log::error!("Voice capture error: {error}");
            let _ = setup_tx.send(Err(error.to_string()));
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
            Err(AppError::Message(error))
        }
        Err(error) => {
            // the thread is most likely stuck opening the device; joining it
            // would hang this call and every later start behind the capture
            // lock, so it is left to finish on its own
            stop_flag.store(true, Ordering::SeqCst);
            drop(thread);
            Err(AppError::Message(format!(
                "The microphone did not start in time: {error}"
            )))
        }
    }
}

fn run_capture_thread<A: AudioSource, L: AudioLevelSink, S: EventSink>(
    source: &A,
    levels: &L,
    runtime: &impl CaptureRuntime,
    sink: &S,
    stop_flag: &Arc<AtomicBool>,
    setup_tx: &std_mpsc::SyncSender<Result<u32, String>>,
) -> Result<(), AppError> {
    let OpenedCapture {
        stream,
        context,
        output_sample_rate_hz,
    } = source.open(stop_flag)?;

    setup_tx
        .send(Ok(output_sample_rate_hz))
        .map_err(|error| AppError::Message(error.to_string()))?;

    let chunk_samples = output_sample_rate_hz as usize * CHUNK_MS / 1_000;
    let mut last_level = runtime.now();
    while !stop_flag.load(Ordering::SeqCst) {
        runtime.sleep_poll_interval();

        if !flush_pending(&context.pending_pcm_samples, sink, chunk_samples) {
            // nobody is listening any more: the webview went away
            stop_flag.store(true, Ordering::SeqCst);
            break;
        }

        if runtime.now().saturating_duration_since(last_level) >= LEVEL_INTERVAL {
            last_level = runtime.now();
            let (level, peak) = context
                .current_level
                .lock()
                .map(|level| *level)
                .unwrap_or((0.0, 0.0));
            levels.publish(VoiceAudioLevelPayload { level, peak });
        }
    }

    // no sample may arrive after the final flush
    drop(stream);
    levels.publish(VoiceAudioLevelPayload {
        level: 0.0,
        peak: 0.0,
    });

    let stream_error = context
        .stream_error
        .lock()
        .ok()
        .and_then(|mut error| error.take());
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
                    *level = compute_audio_level(&converted);
                }
                if let Ok(mut pending_pcm_samples) = pending_pcm_samples.lock() {
                    pending_pcm_samples.extend_from_slice(&converted);
                }
            },
            error_callback,
            None,
        )
        .map_err(|error| AppError::Message(error.to_string()))
}

#[cfg(test)]
mod tests {
    #[test]
    fn capture_info_preserves_the_frontend_wire_names() {
        let info = super::VoiceCaptureInfo {
            sample_rate_hz: 16_000,
            session_id: 7,
        };
        assert_eq!(
            serde_json::to_value(info).unwrap(),
            serde_json::json!({"sampleRate": 16_000, "sessionId": 7})
        );
    }

    use super::*;

    #[derive(Default)]
    struct RecordingSink {
        chunks: Mutex<Vec<Vec<u8>>>,
        events: Mutex<Vec<String>>,
        closed: bool,
    }

    impl EventSink for RecordingSink {
        fn send_event<T: Serialize>(&self, event: &T) -> bool {
            self.events
                .lock()
                .unwrap()
                .push(serde_json::to_string(event).unwrap());
            !self.closed
        }

        fn send_bytes(&self, bytes: Vec<u8>) -> bool {
            self.chunks.lock().unwrap().push(bytes);
            !self.closed
        }
    }

    #[derive(Clone, Default)]
    struct Trace(Arc<Mutex<Vec<String>>>);

    impl Trace {
        fn push(&self, value: impl Into<String>) {
            self.0.lock().unwrap().push(value.into());
        }
        fn values(&self) -> Vec<String> {
            self.0.lock().unwrap().clone()
        }
    }

    impl AudioLevelSink for Trace {
        fn publish(&self, payload: VoiceAudioLevelPayload) {
            self.push(format!("level:{}", payload.level));
        }
    }

    impl EventSink for Trace {
        fn send_event<T: Serialize>(&self, event: &T) -> bool {
            self.push(serde_json::to_string(event).unwrap());
            true
        }
        fn send_bytes(&self, bytes: Vec<u8>) -> bool {
            self.push(format!("bytes:{}", bytes.len()));
            true
        }
    }

    struct TestStream {
        pending_pcm_samples: Arc<Mutex<Vec<i16>>>,
        trace: Trace,
    }

    impl Drop for TestStream {
        fn drop(&mut self) {
            self.trace.push("drop-stream");
            // Simulate the last callback completing when the stream shuts down.
            self.pending_pcm_samples.lock().unwrap().push(7);
        }
    }

    #[derive(Default)]
    struct TestSource {
        trace: Trace,
        fail: bool,
        stop_on_open: bool,
        stream_error: Option<String>,
    }

    impl AudioSource for TestSource {
        type Stream = TestStream;
        fn open(&self, stop_flag: &Arc<AtomicBool>) -> Result<OpenedCapture<TestStream>, AppError> {
            self.trace.push("open");
            if self.fail {
                return Err(AppError::Message("device unavailable".into()));
            }
            stop_flag.store(self.stop_on_open, Ordering::SeqCst);
            let pending_pcm_samples = Arc::new(Mutex::new(vec![1; 1600]));
            Ok(OpenedCapture {
                stream: TestStream {
                    pending_pcm_samples: Arc::clone(&pending_pcm_samples),
                    trace: self.trace.clone(),
                },
                output_sample_rate_hz: TARGET_SAMPLE_RATE_HZ,
                context: StreamContext {
                    pending_pcm_samples,
                    stream_error: Arc::new(Mutex::new(self.stream_error.clone())),
                    current_level: Arc::new(Mutex::new((0.5, 0.75))),
                    stop_flag: Arc::clone(stop_flag),
                    device_sample_rate_hz: TARGET_SAMPLE_RATE_HZ,
                    output_sample_rate_hz: TARGET_SAMPLE_RATE_HZ,
                },
            })
        }
    }

    struct TestRuntime {
        now: std::cell::Cell<Instant>,
        stop: Arc<AtomicBool>,
    }

    impl CaptureRuntime for TestRuntime {
        fn now(&self) -> Instant {
            self.now.get()
        }
        fn sleep_poll_interval(&self) {
            self.now.set(self.now.get() + LEVEL_INTERVAL);
            self.stop.store(true, Ordering::SeqCst);
        }
    }

    #[test]
    fn stream_stops_before_final_samples_and_end_and_resets_the_audio_level() {
        let trace = Trace::default();
        let source = TestSource {
            trace: trace.clone(),
            ..TestSource::default()
        };
        let stop = Arc::new(AtomicBool::new(false));
        let runtime = TestRuntime {
            now: std::cell::Cell::new(Instant::now()),
            stop: Arc::clone(&stop),
        };
        let (tx, rx) = std_mpsc::sync_channel(1);
        run_capture_thread(&source, &trace, &runtime, &trace, &stop, &tx).unwrap();
        assert_eq!(rx.try_recv().unwrap().unwrap(), TARGET_SAMPLE_RATE_HZ);
        assert_eq!(
            trace.values(),
            [
                "open",
                "bytes:3200",
                "level:0.5",
                "drop-stream",
                "level:0",
                "bytes:2",
                r#"{"type":"end"}"#
            ]
        );
    }

    #[test]
    fn stream_failure_emits_error_instead_of_final_audio_and_end() {
        let trace = Trace::default();
        let source = TestSource {
            trace: trace.clone(),
            stop_on_open: true,
            stream_error: Some("stream failed".into()),
            ..TestSource::default()
        };
        let stop = Arc::new(AtomicBool::new(false));
        let runtime = TestRuntime {
            now: std::cell::Cell::new(Instant::now()),
            stop: Arc::clone(&stop),
        };
        let (tx, _rx) = std_mpsc::sync_channel(1);
        run_capture_thread(&source, &trace, &runtime, &trace, &stop, &tx).unwrap();
        assert_eq!(
            trace.values(),
            [
                "open",
                "drop-stream",
                "level:0",
                r#"{"type":"error","message":"stream failed"}"#
            ]
        );
    }

    #[test]
    fn a_closed_listener_stops_capture_without_sending_end() {
        let trace = Trace::default();
        let source = TestSource {
            trace: trace.clone(),
            ..TestSource::default()
        };
        let sink = RecordingSink {
            closed: true,
            ..RecordingSink::default()
        };
        let stop = Arc::new(AtomicBool::new(false));
        let runtime = TestRuntime {
            now: std::cell::Cell::new(Instant::now()),
            stop: Arc::clone(&stop),
        };
        let (tx, _rx) = std_mpsc::sync_channel(1);
        run_capture_thread(&source, &trace, &runtime, &sink, &stop, &tx).unwrap();
        assert!(stop.load(Ordering::SeqCst));
        assert!(sink.events.lock().unwrap().is_empty());
        assert_eq!(trace.values(), ["open", "drop-stream", "level:0"]);
    }

    #[test]
    fn device_setup_errors_are_returned_without_a_tauri_runtime() {
        let source = TestSource {
            fail: true,
            ..TestSource::default()
        };
        let error = create_capture_session(
            source,
            Trace::default(),
            Trace::default(),
            1,
            Duration::from_secs(1),
        )
        .err()
        .unwrap();
        assert_eq!(error.to_string(), "device unavailable");
    }

    #[test]
    fn setup_timeout_signals_stop_without_joining_a_blocked_device() {
        struct BlockedSource {
            release: Mutex<std_mpsc::Receiver<()>>,
            done: std_mpsc::Sender<bool>,
        }
        impl AudioSource for BlockedSource {
            type Stream = ();
            fn open(&self, stop: &Arc<AtomicBool>) -> Result<OpenedCapture<()>, AppError> {
                self.release.lock().unwrap().recv().unwrap();
                self.done.send(stop.load(Ordering::SeqCst)).unwrap();
                Err(AppError::Message("device released".into()))
            }
        }
        let (release_tx, release_rx) = std_mpsc::channel();
        let (done_tx, done_rx) = std_mpsc::channel();
        let source = BlockedSource {
            release: Mutex::new(release_rx),
            done: done_tx,
        };
        let error = create_capture_session(
            source,
            Trace::default(),
            Trace::default(),
            1,
            Duration::ZERO,
        )
        .err()
        .unwrap();
        assert!(error.to_string().contains("did not start in time"));
        release_tx.send(()).unwrap();
        assert!(done_rx.recv_timeout(Duration::from_secs(1)).unwrap());
    }

    #[tokio::test]
    async fn new_capture_replaces_the_old_one_and_a_stale_stop_leaves_it_running() {
        let state = AppState::new(crate::models::default_desktop_snapshot(
            serde_json::Value::Null,
            Default::default(),
        ));
        let trace = Trace::default();
        let first = start_capture_with(
            TestSource {
                stop_on_open: true,
                trace: trace.clone(),
                ..TestSource::default()
            },
            trace.clone(),
            &state,
            trace.clone(),
        )
        .await
        .unwrap();
        let second = start_capture_with(
            TestSource {
                stop_on_open: true,
                trace: trace.clone(),
                ..TestSource::default()
            },
            trace.clone(),
            &state,
            trace.clone(),
        )
        .await
        .unwrap();
        assert_ne!(first.session_id, second.session_id);
        stop_capture(&state, Some(first.session_id)).await.unwrap();
        let session = state
            .voice_session
            .take(Some(second.session_id))
            .expect("new capture was stopped");
        state.voice_session.replace(Some(session));
        stop_capture(&state, Some(second.session_id)).await.unwrap();
        assert!(state.voice_session.take(None).is_none());
        let values = trace.values();
        let second_open = values
            .iter()
            .enumerate()
            .filter(|(_, value)| *value == "open")
            .nth(1)
            .unwrap()
            .0;
        let first_end = values
            .iter()
            .position(|value| value == r#"{"type":"end"}"#)
            .unwrap();
        assert!(
            first_end < second_open,
            "old capture must finish before the new device opens"
        );
    }

    #[test]
    fn flushes_only_full_chunks_until_forced() {
        let sink = RecordingSink::default();
        let pending_pcm_samples = Mutex::new(vec![1_i16, 2, 3]);

        assert!(flush_pending(&pending_pcm_samples, &sink, 4));
        assert!(sink.chunks.lock().unwrap().is_empty());

        assert!(flush_pending(&pending_pcm_samples, &sink, 1));
        assert_eq!(sink.chunks.lock().unwrap().len(), 1);
        assert!(pending_pcm_samples.lock().unwrap().is_empty());

        // nothing left: no empty frame goes out
        assert!(flush_pending(&pending_pcm_samples, &sink, 1));
        assert_eq!(sink.chunks.lock().unwrap().len(), 1);
    }

    #[test]
    fn reports_a_gone_listener() {
        let sink = RecordingSink {
            closed: true,
            ..RecordingSink::default()
        };
        assert!(!flush_pending(&Mutex::new(vec![1_i16]), &sink, 1));
    }

    #[test]
    fn serializes_control_events() {
        assert_eq!(
            serde_json::to_string(&CaptureEvent::End).unwrap(),
            r#"{"type":"end"}"#
        );
        assert_eq!(
            serde_json::to_string(&CaptureEvent::Error {
                message: "boom".into()
            })
            .unwrap(),
            r#"{"type":"error","message":"boom"}"#
        );
    }
}
