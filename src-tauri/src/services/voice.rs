//! Microphone capture for live dictation.
//!
//! Nothing is kept: the audio leaves as PCM16 mono chunks through the channel
//! the webview passed in, which hands it on to the speech provider's socket.
//! A dictation can therefore last as long as the user keeps talking.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc as std_mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::Sample;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::errors::AppError;
use crate::services::net::EventSink;
use crate::state::{AppState, VoiceCaptureSession};

pub const VOICE_AUDIO_LEVEL_EVENT: &str = "app://voice-audio-level";

/// What speech models are trained on; a higher device rate is averaged down.
const TARGET_SAMPLE_RATE: u32 = 16_000;
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
    pub sample_rate: u32,
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

pub async fn start_capture<S: EventSink>(
    app: &AppHandle,
    state: &AppState,
    sink: S,
) -> Result<VoiceCaptureInfo, AppError> {
    let _operation = state.lock_voice_capture().await;
    stop_capture_unlocked(state).await?;

    let app_handle = app.clone();
    let (session, sample_rate) =
        tokio::task::spawn_blocking(move || create_capture_session(app_handle, sink))
            .await
            .map_err(|error| AppError::Message(format!("capture setup task failed: {error}")))??;
    state.replace_voice_capture_session(Some(session));

    Ok(VoiceCaptureInfo { sample_rate })
}

/// Stops the microphone; returns once the last chunk and `end` are sent.
pub async fn stop_capture(state: &AppState) -> Result<(), AppError> {
    let _operation = state.lock_voice_capture().await;
    stop_capture_unlocked(state).await
}

async fn stop_capture_unlocked(state: &AppState) -> Result<(), AppError> {
    let Some(session) = state.replace_voice_capture_session(None) else {
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

fn create_capture_session<S: EventSink>(
    app: AppHandle,
    sink: S,
) -> Result<(VoiceCaptureSession, u32), AppError> {
    let stop_flag = Arc::new(AtomicBool::new(false));
    let thread_stop_flag = Arc::clone(&stop_flag);
    let (setup_tx, setup_rx) = std_mpsc::sync_channel::<Result<u32, String>>(1);
    let thread = thread::spawn(move || {
        // only setup can fail; later failures go through the channel
        if let Err(error) = run_capture_thread(&app, &sink, &thread_stop_flag, &setup_tx) {
            log::error!("Voice capture error: {error}");
            let _ = setup_tx.send(Err(error.to_string()));
        }
    });

    match setup_rx.recv_timeout(SETUP_TIMEOUT) {
        Ok(Ok(sample_rate)) => Ok((VoiceCaptureSession { stop_flag, thread }, sample_rate)),
        Ok(Err(error)) => {
            let _ = thread.join();
            Err(AppError::Message(error))
        }
        Err(error) => {
            stop_flag.store(true, Ordering::SeqCst);
            let _ = thread.join();
            Err(AppError::Message(error.to_string()))
        }
    }
}

fn run_capture_thread<S: EventSink>(
    app: &AppHandle,
    sink: &S,
    stop_flag: &Arc<AtomicBool>,
    setup_tx: &std_mpsc::SyncSender<Result<u32, String>>,
) -> Result<(), AppError> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| AppError::Message(String::from("No default input device found")))?;
    let supported_config = device
        .default_input_config()
        .map_err(|error| AppError::Message(error.to_string()))?;
    let device_rate = supported_config.sample_rate().0;
    let sample_rate = device_rate.min(TARGET_SAMPLE_RATE);
    let stream_config = supported_config.config();

    let context = StreamContext {
        pending: Arc::new(Mutex::new(Vec::new())),
        stream_error: Arc::new(Mutex::new(None)),
        current_level: Arc::new(Mutex::new((0.0, 0.0))),
        stop_flag: Arc::clone(stop_flag),
        device_rate,
        sample_rate,
    };

    let stream = match supported_config.sample_format() {
        cpal::SampleFormat::F32 => build_input_stream::<f32>(&device, &stream_config, &context)?,
        cpal::SampleFormat::I16 => build_input_stream::<i16>(&device, &stream_config, &context)?,
        cpal::SampleFormat::U16 => build_input_stream::<u16>(&device, &stream_config, &context)?,
        cpal::SampleFormat::I32 => build_input_stream::<i32>(&device, &stream_config, &context)?,
        sample_format => {
            return Err(AppError::Message(format!(
                "Unsupported sample format: {sample_format:?}"
            )))
        }
    };

    stream
        .play()
        .map_err(|error| AppError::Message(error.to_string()))?;

    setup_tx
        .send(Ok(sample_rate))
        .map_err(|error| AppError::Message(error.to_string()))?;

    let chunk_samples = sample_rate as usize * CHUNK_MS / 1_000;
    let mut last_level = Instant::now();
    while !stop_flag.load(Ordering::SeqCst) {
        thread::sleep(POLL_INTERVAL);

        if !flush_pending(&context.pending, sink, chunk_samples) {
            // nobody is listening any more: the webview went away
            stop_flag.store(true, Ordering::SeqCst);
            break;
        }

        if last_level.elapsed() >= LEVEL_INTERVAL {
            last_level = Instant::now();
            let (level, peak) = context
                .current_level
                .lock()
                .map(|level| *level)
                .unwrap_or((0.0, 0.0));
            let _ = app.emit(
                VOICE_AUDIO_LEVEL_EVENT,
                VoiceAudioLevelPayload { level, peak },
            );
        }
    }

    // no sample may arrive after the final flush
    drop(stream);
    let _ = app.emit(
        VOICE_AUDIO_LEVEL_EVENT,
        VoiceAudioLevelPayload {
            level: 0.0,
            peak: 0.0,
        },
    );

    let stream_error = context
        .stream_error
        .lock()
        .ok()
        .and_then(|mut error| error.take());
    if let Some(message) = stream_error {
        sink.event(&CaptureEvent::Error { message });
        return Ok(());
    }

    if flush_pending(&context.pending, sink, 1) {
        sink.event(&CaptureEvent::End);
    }
    Ok(())
}

/// Sends what has accumulated once it reaches `min_samples`; false when the
/// receiving side is gone.
fn flush_pending<S: EventSink>(pending: &Mutex<Vec<i16>>, sink: &S, min_samples: usize) -> bool {
    let samples = match pending.lock() {
        Ok(mut pending) if pending.len() >= min_samples => std::mem::take(&mut *pending),
        _ => return true,
    };
    sink.bytes(pcm16_to_bytes(&samples))
}

struct StreamContext {
    pending: Arc<Mutex<Vec<i16>>>,
    stream_error: Arc<Mutex<Option<String>>>,
    current_level: Arc<Mutex<(f32, f32)>>,
    stop_flag: Arc<AtomicBool>,
    device_rate: u32,
    sample_rate: u32,
}

fn build_input_stream<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    context: &StreamContext,
) -> Result<cpal::Stream, AppError>
where
    T: cpal::SizedSample,
    f32: cpal::FromSample<T>,
{
    let channels = usize::from(config.channels);
    let pending = Arc::clone(&context.pending);
    let level_monitor = Arc::clone(&context.current_level);
    let stream_error = Arc::clone(&context.stream_error);
    let error_stop_flag = Arc::clone(&context.stop_flag);
    let mut downsampler = Downsampler::new(context.device_rate, context.sample_rate);
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
                if let Ok(mut pending) = pending.lock() {
                    pending.extend_from_slice(&converted);
                }
            },
            error_callback,
            None,
        )
        .map_err(|error| AppError::Message(error.to_string()))
}

/// Averages each window of input samples into one output sample: a box
/// filter, enough to keep hiss above 8 kHz from folding into speech.
struct Downsampler {
    /// Input samples per output sample, at least 1.
    step: f64,
    phase: f64,
    sum: f32,
    count: u32,
}

impl Downsampler {
    fn new(input_rate: u32, output_rate: u32) -> Self {
        Self {
            step: (f64::from(input_rate) / f64::from(output_rate)).max(1.0),
            phase: 0.0,
            sum: 0.0,
            count: 0,
        }
    }

    fn push(&mut self, sample: f32, output: &mut Vec<i16>) {
        self.sum += sample;
        self.count += 1;
        self.phase += 1.0;
        if self.phase >= self.step {
            output.push(float_to_pcm16(self.sum / self.count as f32));
            self.phase -= self.step;
            self.sum = 0.0;
            self.count = 0;
        }
    }
}

fn mix_frame<T>(frame: &[T]) -> f32
where
    T: Copy,
    f32: cpal::FromSample<T>,
{
    frame
        .iter()
        .map(|sample| f32::from_sample(*sample))
        .sum::<f32>()
        / frame.len() as f32
}

fn float_to_pcm16(sample: f32) -> i16 {
    let clamped = sample.clamp(-1.0, 1.0);
    let value = if clamped < 0.0 {
        clamped * 32768.0
    } else {
        clamped * 32767.0
    };
    value.round() as i16
}

fn pcm16_to_bytes(samples: &[i16]) -> Vec<u8> {
    samples
        .iter()
        .flat_map(|sample| sample.to_le_bytes())
        .collect()
}

pub fn compute_audio_level(samples: &[i16]) -> (f32, f32) {
    if samples.is_empty() {
        return (0.0, 0.0);
    }
    let mut sum_sq = 0.0_f32;
    let mut peak = 0.0_f32;
    for &sample in samples {
        let norm = (sample as f32 / 32768.0).abs();
        if norm > peak {
            peak = norm;
        }
        sum_sq += norm * norm;
    }
    let rms = (sum_sq / samples.len() as f32).sqrt();
    (rms.clamp(0.0, 1.0), peak.clamp(0.0, 1.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct RecordingSink {
        chunks: Mutex<Vec<Vec<u8>>>,
        events: Mutex<Vec<String>>,
        closed: bool,
    }

    impl EventSink for RecordingSink {
        fn event<T: Serialize>(&self, event: &T) -> bool {
            self.events
                .lock()
                .unwrap()
                .push(serde_json::to_string(event).unwrap());
            !self.closed
        }

        fn bytes(&self, bytes: Vec<u8>) -> bool {
            self.chunks.lock().unwrap().push(bytes);
            !self.closed
        }
    }

    #[test]
    fn converts_float_samples_without_overflow() {
        assert_eq!(float_to_pcm16(-2.0), i16::MIN);
        assert_eq!(float_to_pcm16(0.0), 0);
        assert_eq!(float_to_pcm16(2.0), i16::MAX);
    }

    #[test]
    fn mixes_every_channel_in_a_frame() {
        assert_eq!(mix_frame(&[1.0_f32, -1.0_f32]), 0.0);
        assert_eq!(mix_frame(&[0.5_f32, 0.5_f32]), 0.5);
    }

    #[test]
    fn averages_each_window_when_downsampling() {
        let mut downsampler = Downsampler::new(48_000, 16_000);
        let mut output = Vec::new();
        for sample in [0.0, 0.3, 0.6, 1.0, 1.0, 1.0, -1.0] {
            downsampler.push(sample, &mut output);
        }
        assert_eq!(output, vec![float_to_pcm16(0.3), i16::MAX]);
    }

    #[test]
    fn keeps_the_output_rate_for_fractional_ratios() {
        let mut downsampler = Downsampler::new(44_100, 16_000);
        let mut output = Vec::new();
        for _ in 0..44_100 {
            downsampler.push(0.0, &mut output);
        }
        // the step is not exact in binary, so one sample either way is fine
        assert!(output.len().abs_diff(16_000) <= 1);
    }

    #[test]
    fn passes_audio_through_at_or_below_the_target_rate() {
        let mut downsampler = Downsampler::new(8_000, 8_000);
        let mut output = Vec::new();
        downsampler.push(0.5, &mut output);
        downsampler.push(-0.5, &mut output);
        assert_eq!(output, vec![float_to_pcm16(0.5), float_to_pcm16(-0.5)]);
    }

    #[test]
    fn encodes_pcm16_little_endian() {
        assert_eq!(pcm16_to_bytes(&[1, -2]), vec![1, 0, 0xfe, 0xff]);
    }

    #[test]
    fn flushes_only_full_chunks_until_forced() {
        let sink = RecordingSink::default();
        let pending = Mutex::new(vec![1_i16, 2, 3]);

        assert!(flush_pending(&pending, &sink, 4));
        assert!(sink.chunks.lock().unwrap().is_empty());

        assert!(flush_pending(&pending, &sink, 1));
        assert_eq!(sink.chunks.lock().unwrap().len(), 1);
        assert!(pending.lock().unwrap().is_empty());

        // nothing left: no empty frame goes out
        assert!(flush_pending(&pending, &sink, 1));
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

    #[test]
    fn computes_audio_level_for_empty_slice() {
        assert_eq!(compute_audio_level(&[]), (0.0, 0.0));
    }

    #[test]
    fn computes_audio_level_for_silence_and_signals() {
        assert_eq!(compute_audio_level(&[0, 0, 0]), (0.0, 0.0));

        let (level, peak) = compute_audio_level(&[16_384, -16_384]);
        assert!((peak - 0.5).abs() < 1e-3);
        assert!((level - 0.5).abs() < 1e-3);
    }
}
