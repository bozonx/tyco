//! CPAL microphone adapter. Capture policy and delivery live in the voice
//! service.
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

use crate::errors::AppError;
use crate::services::voice::{
    build_input_stream, OpenedCapture, StreamContext, TARGET_SAMPLE_RATE_HZ,
};

/// Opens the default input device.
pub(super) fn open_microphone(
    stop_flag: &Arc<AtomicBool>,
) -> Result<OpenedCapture<cpal::Stream>, AppError> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| AppError::ServiceUnavailable("No default input device found".into()))?;
    open_input_device(&device, stop_flag)
}

/// Opens `device` for input; on Windows an output device records what it
/// plays, see `windows_loopback`.
pub(super) fn open_input_device(
    device: &cpal::Device,
    stop_flag: &Arc<AtomicBool>,
) -> Result<OpenedCapture<cpal::Stream>, AppError> {
    let default_config = device
        .default_input_config()
        .map_err(|error| AppError::ServiceUnavailable(error.to_string()))?;
    // the device or the sound server converts better than our filter, and
    // a mono stream is mixed down properly by it
    let speech = device
        .supported_input_configs()
        .ok()
        .and_then(|configs| speech_config(configs, &default_config));
    if let Some(config) = speech {
        match open_with(device, config, stop_flag) {
            Ok(opened) => return Ok(opened),
            // a device may list a rate it then refuses
            Err(error) => log::warn!(
                "Could not record at {TARGET_SAMPLE_RATE_HZ} Hz, using the default: {error}"
            ),
        }
    }
    open_with(device, default_config, stop_flag)
}

fn open_with(
    device: &cpal::Device,
    supported_config: cpal::SupportedStreamConfig,
    stop_flag: &Arc<AtomicBool>,
) -> Result<OpenedCapture<cpal::Stream>, AppError> {
    let device_sample_rate_hz = supported_config.sample_rate().0;
    let output_sample_rate_hz = device_sample_rate_hz.min(TARGET_SAMPLE_RATE_HZ);
    let context = StreamContext::new(stop_flag, device_sample_rate_hz, output_sample_rate_hz);
    let config = supported_config.config();
    let stream = match supported_config.sample_format() {
        cpal::SampleFormat::F32 => build_input_stream::<f32>(device, &config, &context)?,
        cpal::SampleFormat::I16 => build_input_stream::<i16>(device, &config, &context)?,
        cpal::SampleFormat::U16 => build_input_stream::<u16>(device, &config, &context)?,
        cpal::SampleFormat::I32 => build_input_stream::<i32>(device, &config, &context)?,
        format => {
            return Err(AppError::ServiceUnavailable(format!(
                "Unsupported sample format: {format:?}"
            )))
        }
    };
    stream
        .play()
        .map_err(|error| AppError::ServiceUnavailable(error.to_string()))?;
    Ok(OpenedCapture {
        stream,
        context,
        output_sample_rate_hz,
    })
}

/// Records what `device`, an output device, plays: WASAPI loopback.
#[cfg(target_os = "windows")]
pub(super) fn open_loopback_device(
    device: &cpal::Device,
    stop_flag: &Arc<AtomicBool>,
) -> Result<OpenedCapture<cpal::Stream>, AppError> {
    let config = device
        .default_output_config()
        .map_err(|error| AppError::ServiceUnavailable(error.to_string()))?;
    open_with(device, config, stop_flag)
}

/// Sample formats the capture can read, see `build_input_stream`
const READABLE_FORMATS: [cpal::SampleFormat; 4] = [
    cpal::SampleFormat::F32,
    cpal::SampleFormat::I16,
    cpal::SampleFormat::U16,
    cpal::SampleFormat::I32,
];

/// A configuration that records at the speech rate itself, mono where the
/// device offers it; `None` leaves the default one.
fn speech_config(
    configs: impl Iterator<Item = cpal::SupportedStreamConfigRange>,
    default_config: &cpal::SupportedStreamConfig,
) -> Option<cpal::SupportedStreamConfig> {
    let target = cpal::SampleRate(TARGET_SAMPLE_RATE_HZ);
    configs
        .filter(|range| {
            range.min_sample_rate() <= target
                && target <= range.max_sample_rate()
                && range.channels() > 0
                && READABLE_FORMATS.contains(&range.sample_format())
        })
        .min_by_key(|range| {
            (
                range.channels(),
                range.sample_format() != default_config.sample_format(),
            )
        })
        .map(|range| range.with_sample_rate(target))
}

#[cfg(test)]
mod tests {
    use super::*;
    use cpal::{SampleFormat, SampleRate, SupportedBufferSize, SupportedStreamConfigRange};

    fn range(
        channels: u16,
        min: u32,
        max: u32,
        format: SampleFormat,
    ) -> SupportedStreamConfigRange {
        SupportedStreamConfigRange::new(
            channels,
            SampleRate(min),
            SampleRate(max),
            SupportedBufferSize::Unknown,
            format,
        )
    }

    fn default_config() -> cpal::SupportedStreamConfig {
        cpal::SupportedStreamConfig::new(
            2,
            SampleRate(48_000),
            SupportedBufferSize::Unknown,
            SampleFormat::F32,
        )
    }

    #[test]
    fn prefers_mono_at_the_speech_rate() {
        let config = speech_config(
            [
                range(2, 8_000, 48_000, SampleFormat::F32),
                range(1, 8_000, 48_000, SampleFormat::I16),
            ]
            .into_iter(),
            &default_config(),
        )
        .unwrap();
        assert_eq!(config.channels(), 1);
        assert_eq!(config.sample_rate(), SampleRate(TARGET_SAMPLE_RATE_HZ));
    }

    #[test]
    fn keeps_the_default_when_the_speech_rate_is_not_offered() {
        assert!(speech_config(
            [range(2, 44_100, 48_000, SampleFormat::F32)].into_iter(),
            &default_config(),
        )
        .is_none());
    }

    #[test]
    fn skips_formats_the_capture_cannot_read() {
        assert!(speech_config(
            [range(1, 8_000, 48_000, SampleFormat::U8)].into_iter(),
            &default_config(),
        )
        .is_none());
    }
}
