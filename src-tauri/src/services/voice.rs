use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc as std_mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;

use base64::Engine;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::Sample;
use serde::Serialize;

use crate::errors::AppError;
use crate::state::{AppState, LocalVoiceRecordingSession};

const MAX_RECORDING_SECONDS: usize = 300;
const SETUP_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalVoiceRecording {
    pub sample_rate: u32,
    pub duration_ms: u64,
    pub wav_base64: String,
    pub limit_reached: bool,
}

pub async fn start_local_recording(state: &AppState) -> Result<(), AppError> {
    let _ = stop_local_recording(state).await;

    let session = tokio::task::spawn_blocking(create_local_recording_session)
        .await
        .map_err(|error| AppError::Message(format!("recording setup task failed: {error}")))??;
    state.replace_local_voice_recording_session(Some(session));

    Ok(())
}

fn create_local_recording_session() -> Result<LocalVoiceRecordingSession, AppError> {
    let stop_flag = Arc::new(AtomicBool::new(false));
    let samples = Arc::new(Mutex::new(Vec::<i16>::new()));
    let stream_error = Arc::new(Mutex::new(None));
    let limit_reached = Arc::new(AtomicBool::new(false));
    let thread_stop_flag = Arc::clone(&stop_flag);
    let thread_samples = Arc::clone(&samples);
    let thread_stream_error = Arc::clone(&stream_error);
    let thread_limit_reached = Arc::clone(&limit_reached);
    let (setup_tx, setup_rx) = std_mpsc::sync_channel::<Result<u32, String>>(1);
    let thread = thread::spawn(move || {
        if let Err(error) = run_local_recording_thread(
            thread_stop_flag,
            thread_samples,
            thread_stream_error,
            thread_limit_reached,
            &setup_tx,
        ) {
            let _ = setup_tx.send(Err(error.to_string()));
            log::error!("Local voice recording error: {error}");
        }
    });

    let sample_rate = match setup_rx.recv_timeout(SETUP_TIMEOUT) {
        Ok(Ok(sample_rate)) => sample_rate,
        Ok(Err(error)) => {
            let _ = thread.join();
            return Err(AppError::Message(error));
        }
        Err(error) => {
            stop_flag.store(true, Ordering::SeqCst);
            let _ = thread.join();
            return Err(AppError::Message(error.to_string()));
        }
    };

    Ok(LocalVoiceRecordingSession {
        stop_flag,
        thread,
        samples,
        stream_error,
        limit_reached,
        sample_rate,
    })
}

pub async fn stop_local_recording(state: &AppState) -> Result<LocalVoiceRecording, AppError> {
    if let Some(session) = state.replace_local_voice_recording_session(None) {
        return tokio::task::spawn_blocking(move || finish_local_recording_session(session))
            .await
            .map_err(|error| AppError::Message(format!("recording stop task failed: {error}")))?;
    }

    Ok(LocalVoiceRecording {
        sample_rate: 16_000,
        duration_ms: 0,
        wav_base64: base64::engine::general_purpose::STANDARD.encode(pcm16_to_wav(&[], 16_000)?),
        limit_reached: false,
    })
}

fn finish_local_recording_session(
    session: LocalVoiceRecordingSession,
) -> Result<LocalVoiceRecording, AppError> {
    let LocalVoiceRecordingSession {
        stop_flag,
        thread,
        samples,
        stream_error,
        limit_reached,
        sample_rate,
    } = session;
    stop_flag.store(true, Ordering::SeqCst);
    thread
        .join()
        .map_err(|_| AppError::Message(String::from("local recording thread panicked")))?;
    if let Some(error) = stream_error
        .lock()
        .map_err(|_| AppError::Message(String::from("local recording error lock poisoned")))?
        .take()
    {
        return Err(AppError::Message(error));
    }
    let samples = Arc::try_unwrap(samples)
        .map_err(|_| AppError::Message(String::from("local recording samples are still in use")))?
        .into_inner()
        .map_err(|_| AppError::Message(String::from("local recording samples lock poisoned")))?;
    let duration_ms = samples.len() as u64 * 1_000 / u64::from(sample_rate);
    let wav = pcm16_to_wav(&samples, sample_rate)?;

    Ok(LocalVoiceRecording {
        sample_rate,
        duration_ms,
        wav_base64: base64::engine::general_purpose::STANDARD.encode(wav),
        limit_reached: limit_reached.load(Ordering::SeqCst),
    })
}

fn run_local_recording_thread(
    stop_flag: Arc<AtomicBool>,
    samples: Arc<Mutex<Vec<i16>>>,
    stream_error: Arc<Mutex<Option<String>>>,
    limit_reached: Arc<AtomicBool>,
    setup_tx: &std_mpsc::SyncSender<Result<u32, String>>,
) -> Result<(), AppError> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| AppError::Message(String::from("No default input device found")))?;
    let supported_config = device
        .default_input_config()
        .map_err(|error| AppError::Message(error.to_string()))?;
    let sample_rate = supported_config.sample_rate().0;
    let stream_config = supported_config.config();

    let stream = match supported_config.sample_format() {
        cpal::SampleFormat::F32 => build_local_recording_stream::<f32>(
            &device,
            &stream_config,
            samples,
            Arc::clone(&stop_flag),
            stream_error,
            limit_reached,
            sample_rate,
        )?,
        cpal::SampleFormat::I16 => build_local_recording_stream::<i16>(
            &device,
            &stream_config,
            samples,
            Arc::clone(&stop_flag),
            stream_error,
            limit_reached,
            sample_rate,
        )?,
        cpal::SampleFormat::U16 => build_local_recording_stream::<u16>(
            &device,
            &stream_config,
            samples,
            Arc::clone(&stop_flag),
            stream_error,
            limit_reached,
            sample_rate,
        )?,
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

    while !stop_flag.load(Ordering::SeqCst) {
        thread::sleep(Duration::from_millis(20));
    }

    Ok(())
}

fn build_local_recording_stream<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    samples: Arc<Mutex<Vec<i16>>>,
    stop_flag: Arc<AtomicBool>,
    stream_error: Arc<Mutex<Option<String>>>,
    limit_reached: Arc<AtomicBool>,
    sample_rate: u32,
) -> Result<cpal::Stream, AppError>
where
    T: cpal::SizedSample,
    f32: cpal::FromSample<T>,
{
    let channels = usize::from(config.channels);
    let max_samples = sample_rate as usize * MAX_RECORDING_SECONDS;
    let error_stop_flag = Arc::clone(&stop_flag);
    let error_callback = move |error| {
        log::error!("Local recording audio input stream error: {error}");
        if let Ok(mut current_error) = stream_error.lock() {
            *current_error = Some(format!("Audio input stream failed: {error}"));
        }
        error_stop_flag.store(true, Ordering::SeqCst);
    };

    device
        .build_input_stream(
            config,
            move |data: &[T], _| {
                if let Ok(mut samples) = samples.lock() {
                    let remaining = max_samples.saturating_sub(samples.len());
                    samples.reserve((data.len() / channels).min(remaining));

                    for frame in data.chunks(channels) {
                        if samples.len() >= max_samples {
                            limit_reached.store(true, Ordering::SeqCst);
                            stop_flag.store(true, Ordering::SeqCst);
                            break;
                        }
                        if !frame.is_empty() {
                            samples.push(mix_frame_to_pcm16(frame));
                        }
                    }
                }
            },
            error_callback,
            None,
        )
        .map_err(|error| AppError::Message(error.to_string()))
}

fn mix_frame_to_pcm16<T>(frame: &[T]) -> i16
where
    T: Copy,
    f32: cpal::FromSample<T>,
{
    let mixed = frame
        .iter()
        .map(|sample| f32::from_sample(*sample))
        .sum::<f32>()
        / frame.len() as f32;
    float_to_pcm16(mixed)
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

fn pcm16_to_wav(samples: &[i16], sample_rate: u32) -> Result<Vec<u8>, AppError> {
    let data_len = samples
        .len()
        .checked_mul(2)
        .and_then(|length| u32::try_from(length).ok())
        .ok_or_else(|| AppError::Message(String::from("recording is too large for WAV")))?;
    let mut wav = Vec::with_capacity(44 + data_len as usize);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_len).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16_u32.to_le_bytes());
    wav.extend_from_slice(&1_u16.to_le_bytes());
    wav.extend_from_slice(&1_u16.to_le_bytes());
    wav.extend_from_slice(&sample_rate.to_le_bytes());
    wav.extend_from_slice(&(sample_rate * 2).to_le_bytes());
    wav.extend_from_slice(&2_u16.to_le_bytes());
    wav.extend_from_slice(&16_u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_len.to_le_bytes());
    for sample in samples {
        wav.extend_from_slice(&sample.to_le_bytes());
    }
    Ok(wav)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_float_samples_without_overflow() {
        assert_eq!(float_to_pcm16(-2.0), i16::MIN);
        assert_eq!(float_to_pcm16(0.0), 0);
        assert_eq!(float_to_pcm16(2.0), i16::MAX);
    }

    #[test]
    fn mixes_every_channel_in_a_frame() {
        assert_eq!(mix_frame_to_pcm16(&[1.0_f32, -1.0_f32]), 0);
        assert_eq!(mix_frame_to_pcm16(&[0.5_f32, 0.5_f32]), 16_384);
    }

    #[test]
    fn writes_a_mono_pcm16_wav() {
        let wav = pcm16_to_wav(&[i16::MIN, 0, i16::MAX], 16_000).unwrap();
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(u32::from_le_bytes(wav[24..28].try_into().unwrap()), 16_000);
        assert_eq!(u32::from_le_bytes(wav[40..44].try_into().unwrap()), 6);
        assert_eq!(wav.len(), 50);
    }
}
