//! CPAL device adapter. Capture policy and delivery live in the voice service.
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

use crate::errors::AppError;
use crate::services::voice::{
    build_input_stream, AudioSource, OpenedCapture, StreamContext, TARGET_SAMPLE_RATE,
};

pub(crate) struct SystemAudioSource;

impl AudioSource for SystemAudioSource {
    type Stream = cpal::Stream;

    fn open(&self, stop_flag: &Arc<AtomicBool>) -> Result<OpenedCapture<Self::Stream>, AppError> {
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or_else(|| AppError::Message("No default input device found".into()))?;
        let supported_config = device
            .default_input_config()
            .map_err(|error| AppError::Message(error.to_string()))?;
        let device_rate = supported_config.sample_rate().0;
        let sample_rate = device_rate.min(TARGET_SAMPLE_RATE);
        let context = StreamContext {
            pending: Arc::new(Mutex::new(Vec::new())),
            stream_error: Arc::new(Mutex::new(None)),
            current_level: Arc::new(Mutex::new((0.0, 0.0))),
            stop_flag: Arc::clone(stop_flag),
            device_rate,
            sample_rate,
        };
        let config = supported_config.config();
        let stream = match supported_config.sample_format() {
            cpal::SampleFormat::F32 => build_input_stream::<f32>(&device, &config, &context)?,
            cpal::SampleFormat::I16 => build_input_stream::<i16>(&device, &config, &context)?,
            cpal::SampleFormat::U16 => build_input_stream::<u16>(&device, &config, &context)?,
            cpal::SampleFormat::I32 => build_input_stream::<i32>(&device, &config, &context)?,
            format => {
                return Err(AppError::Message(format!(
                    "Unsupported sample format: {format:?}"
                )))
            }
        };
        stream
            .play()
            .map_err(|error| AppError::Message(error.to_string()))?;
        Ok(OpenedCapture {
            stream,
            context,
            sample_rate,
        })
    }
}
