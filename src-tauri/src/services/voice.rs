use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc as std_mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::Sample;
use serde::Serialize;

use crate::errors::AppError;
use crate::state::{AppState, LocalVoiceRecordingSession};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalVoiceRecording {
    pub sample_rate: u32,
    pub samples: Vec<f32>,
}

pub async fn start_local_recording(state: &AppState) -> Result<(), AppError> {
    let _ = stop_local_recording(state).await;

    let stop_flag = Arc::new(AtomicBool::new(false));
    let samples = Arc::new(Mutex::new(Vec::<f32>::new()));
    let thread_stop_flag = Arc::clone(&stop_flag);
    let thread_samples = Arc::clone(&samples);
    let (setup_tx, setup_rx) = std_mpsc::sync_channel::<Result<u32, String>>(1);
    let thread = thread::spawn(move || {
        if let Err(error) =
            run_local_recording_thread(thread_stop_flag, thread_samples, setup_tx.clone())
        {
            let _ = setup_tx.send(Err(error.to_string()));
            log::error!("Local voice recording error: {error}");
        }
    });

    let sample_rate = setup_rx
        .recv()
        .map_err(|error| AppError::Message(error.to_string()))?
        .map_err(AppError::Message)?;

    state.replace_local_voice_recording_session(Some(LocalVoiceRecordingSession {
        stop_flag,
        thread,
        samples,
        sample_rate,
    }));

    Ok(())
}

pub async fn stop_local_recording(state: &AppState) -> Result<LocalVoiceRecording, AppError> {
    if let Some(session) = state.replace_local_voice_recording_session(None) {
        session.stop_flag.store(true, Ordering::SeqCst);
        let _ = session.thread.join();
        let samples = session
            .samples
            .lock()
            .map_err(|_| AppError::Message(String::from("local recording samples lock poisoned")))?
            .clone();

        return Ok(LocalVoiceRecording {
            sample_rate: session.sample_rate,
            samples,
        });
    }

    Ok(LocalVoiceRecording {
        sample_rate: 16_000,
        samples: Vec::new(),
    })
}

fn run_local_recording_thread(
    stop_flag: Arc<AtomicBool>,
    samples: Arc<Mutex<Vec<f32>>>,
    setup_tx: std_mpsc::SyncSender<Result<u32, String>>,
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
        cpal::SampleFormat::F32 => {
            build_local_recording_stream::<f32>(&device, &stream_config, samples)?
        }
        cpal::SampleFormat::I16 => {
            build_local_recording_stream::<i16>(&device, &stream_config, samples)?
        }
        cpal::SampleFormat::U16 => {
            build_local_recording_stream::<u16>(&device, &stream_config, samples)?
        }
        sample_format => {
            return Err(AppError::Message(format!(
                "Unsupported sample format: {sample_format:?}"
            )))
        }
    };

    stream
        .play()
        .map_err(|error| AppError::Message(error.to_string()))?;

    let _ = setup_tx.send(Ok(sample_rate));

    while !stop_flag.load(Ordering::SeqCst) {
        thread::sleep(Duration::from_millis(20));
    }

    Ok(())
}

fn build_local_recording_stream<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    samples: Arc<Mutex<Vec<f32>>>,
) -> Result<cpal::Stream, AppError>
where
    T: cpal::SizedSample,
    f32: cpal::FromSample<T>,
{
    let channels = usize::from(config.channels);
    let error_callback = |error| {
        log::error!("Local recording audio input stream error: {error}");
    };

    device
        .build_input_stream(
            config,
            move |data: &[T], _| {
                if let Ok(mut samples) = samples.lock() {
                    samples.reserve(data.len() / channels);

                    for frame in data.chunks(channels) {
                        if let Some(sample) = frame.first() {
                            samples.push(f32::from_sample(*sample));
                        }
                    }
                }
            },
            error_callback,
            None,
        )
        .map_err(|error| AppError::Message(error.to_string()))
}
