use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc as std_mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::Sample;
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;
use tokio::runtime::Builder;
use tokio::sync::{mpsc, watch};
use tokio::time::timeout_at;
use tokio_tungstenite::{connect_async, tungstenite::Message};

use crate::errors::AppError;
use crate::services::runtime;
use crate::state::{AppState, LocalVoiceRecordingSession, VoiceSession};

pub struct WebSocketSttConfig {
    pub url: String,
    pub model: String,
    pub language: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalVoiceRecording {
    pub sample_rate: u32,
    pub samples: Vec<f32>,
}

pub async fn start(
    app: AppHandle,
    state: &AppState,
    config: WebSocketSttConfig,
) -> Result<(), AppError> {
    stop(state).await?;
    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let thread = thread::spawn(move || {
        if let Err(error) = run_voice_thread(app, config, shutdown_rx) {
            log::error!("Voice recognition error: {error}");
        }
    });

    state.replace_voice_session(Some(VoiceSession {
        shutdown_tx,
        thread,
    }));

    Ok(())
}

pub async fn stop(state: &AppState) -> Result<(), AppError> {
    if let Some(session) = state.replace_voice_session(None) {
        let _ = session.shutdown_tx.send(true);
        let _ = session.thread.join();
    }

    Ok(())
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

fn run_voice_thread(
    app: AppHandle,
    config: WebSocketSttConfig,
    shutdown_rx: watch::Receiver<bool>,
) -> Result<(), AppError> {
    let runtime = Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| AppError::Message(error.to_string()))?;

    runtime.block_on(async move {
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or_else(|| AppError::Message(String::from("No default input device found")))?;
        let supported_config = device
            .default_input_config()
            .map_err(|error| AppError::Message(error.to_string()))?;
        let sample_rate = supported_config.sample_rate().0;
        let stream_config = supported_config.config();
        let (audio_tx, audio_rx) = mpsc::unbounded_channel::<Vec<u8>>();

        let stream = match supported_config.sample_format() {
            cpal::SampleFormat::F32 => {
                build_input_stream::<f32>(&device, &stream_config, audio_tx)?
            }
            cpal::SampleFormat::I16 => {
                build_input_stream::<i16>(&device, &stream_config, audio_tx)?
            }
            cpal::SampleFormat::U16 => {
                build_input_stream::<u16>(&device, &stream_config, audio_tx)?
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

        run_voice_session(app, config, sample_rate, audio_rx, shutdown_rx).await
    })
}

async fn run_voice_session(
    app: AppHandle,
    config: WebSocketSttConfig,
    sample_rate: u32,
    mut audio_rx: mpsc::UnboundedReceiver<Vec<u8>>,
    mut shutdown_rx: watch::Receiver<bool>,
) -> Result<(), AppError> {
    let (mut ws, _) = connect_async(&config.url)
        .await
        .map_err(|error| AppError::Message(error.to_string()))?;
    let config_message = serde_json::json!({
        "type": "start",
        "audio": {
            "encoding": "pcm_s16le",
            "sampleRate": sample_rate,
            "channels": 1
        },
        "model": config.model,
        "language": config.language
    });

    ws.send(Message::Text(config_message.to_string()))
        .await
        .map_err(|error| AppError::Message(error.to_string()))?;

    let mut parts: Vec<String> = Vec::new();

    loop {
        tokio::select! {
            maybe_audio = audio_rx.recv() => {
                match maybe_audio {
                    Some(audio) => {
                        ws.send(Message::Binary(audio))
                            .await
                            .map_err(|error| AppError::Message(error.to_string()))?;
                    }
                    None => break,
                }
            }
            incoming = ws.next() => {
                match incoming {
                    Some(Ok(message)) => {
                        handle_ws_message(&app, &mut parts, message)?;
                    }
                    Some(Err(error)) => {
                        return Err(AppError::Message(error.to_string()));
                    }
                    None => break,
                }
            }
            changed = shutdown_rx.changed() => {
                if changed.is_ok() && *shutdown_rx.borrow() {
                    let _ = ws.send(Message::Text(String::from("{\"type\":\"stop\"}"))).await;
                    drain_final_messages(&app, &mut parts, &mut ws).await?;
                    break;
                }
            }
        }
    }

    let _ = ws.close(None).await;

    Ok(())
}

async fn drain_final_messages(
    app: &AppHandle,
    parts: &mut Vec<String>,
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> Result<(), AppError> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(2);

    loop {
        match timeout_at(deadline, ws.next()).await {
            Ok(Some(Ok(message))) => {
                handle_ws_message(app, parts, message)?;
            }
            Ok(Some(Err(error))) => {
                return Err(AppError::Message(error.to_string()));
            }
            Ok(None) | Err(_) => break,
        }
    }

    Ok(())
}

fn handle_ws_message(
    app: &AppHandle,
    parts: &mut Vec<String>,
    message: Message,
) -> Result<(), AppError> {
    let payload = match message {
        Message::Text(text) => text,
        Message::Binary(bytes) => {
            String::from_utf8(bytes).map_err(|error| AppError::Message(error.to_string()))?
        }
        _ => return Ok(()),
    };
    let json: Value = serde_json::from_str(&payload)?;

    if let Some(text) = json.get("text").and_then(Value::as_str) {
        if !text.trim().is_empty() {
            let message_type = json.get("type").and_then(Value::as_str).unwrap_or("final");
            if message_type == "partial" {
                let committed = parts.join(" ");
                let combined = format!("{committed} {text}").trim().to_string();
                let _ = runtime::emit_voice_text(app, combined);
            } else if message_type == "final" || json.get("type").is_none() {
                parts.push(text.to_string());
                let _ = runtime::emit_voice_text(app, parts.join(" ").trim().to_string());
            }
        }
    }

    Ok(())
}

fn build_input_stream<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    audio_tx: mpsc::UnboundedSender<Vec<u8>>,
) -> Result<cpal::Stream, AppError>
where
    T: cpal::SizedSample,
    i16: cpal::FromSample<T>,
{
    let channels = usize::from(config.channels);
    let error_callback = |error| {
        log::error!("Audio input stream error: {error}");
    };

    device
        .build_input_stream(
            config,
            move |data: &[T], _| {
                let mut bytes = Vec::with_capacity(data.len() * 2);

                for frame in data.chunks(channels) {
                    if let Some(sample) = frame.first() {
                        let sample_i16: i16 = i16::from_sample(*sample);
                        bytes.extend_from_slice(&sample_i16.to_le_bytes());
                    }
                }

                let _ = audio_tx.send(bytes);
            },
            error_callback,
            None,
        )
        .map_err(|error| AppError::Message(error.to_string()))
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

pub fn resolve_ws_config(params: &crate::models::InitParams) -> WebSocketSttConfig {
    let usage_id = params
        .user_config
        .get("aiModelUsage")
        .and_then(|usage| usage.get("stt"))
        .and_then(Value::as_str)
        .unwrap_or_default();

    let selected_model = params
        .user_config
        .get("sttModels")
        .and_then(Value::as_array)
        .and_then(|items| {
            items
                .iter()
                .find(|item| item.get("id").and_then(Value::as_str) == Some(usage_id))
        });
    let url = selected_model
        .and_then(|model| model.get("baseUrl"))
        .and_then(Value::as_str)
        .unwrap_or("ws://localhost:2700")
        .to_string();
    let model = selected_model
        .and_then(|value| value.get("model"))
        .and_then(Value::as_str)
        .unwrap_or("whisper")
        .to_string();
    let language = params
        .user_config
        .get("userLanguage")
        .and_then(Value::as_str)
        .filter(|value| *value != "auto")
        .and_then(|value| value.split(['_', '-']).next())
        .map(str::to_string);

    WebSocketSttConfig {
        url,
        model,
        language,
    }
}
