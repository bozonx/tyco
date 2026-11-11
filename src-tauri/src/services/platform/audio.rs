//! Audio capture devices: the microphone through CPAL, the sound the computer
//! plays natively (PipeWire on Linux, WASAPI loopback on Windows). Capture
//! policy and delivery live in the voice service.
use std::any::Any;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use crate::errors::AppError;
use crate::services::voice::{
    AudioApp, AudioInputDevice, AudioSource, CaptureSource, OpenedCapture,
};

mod microphone;
#[cfg(target_os = "linux")]
mod pipewire;
mod process_tree;
#[cfg(target_os = "windows")]
mod wasapi;

/// Whatever keeps a capture running; dropping it ends the capture.
pub(crate) type CaptureStream = Box<dyn Any>;

pub(crate) struct SystemAudioSource {
    pub microphone_id: Option<String>,
}

impl AudioSource for SystemAudioSource {
    type Stream = CaptureStream;

    fn open(
        &self,
        source: &CaptureSource,
        stop_flag: &Arc<AtomicBool>,
    ) -> Result<OpenedCapture<Self::Stream>, AppError> {
        match source {
            CaptureSource::Microphone => {
                microphone::open_microphone(self.microphone_id.as_deref(), stop_flag).map(boxed)
            }
            playback => open_playback(playback, stop_flag),
        }
    }
}

pub(crate) fn list_input_devices() -> Result<Vec<AudioInputDevice>, AppError> {
    microphone::list_input_devices()
}

fn boxed<T: 'static>(opened: OpenedCapture<T>) -> OpenedCapture<CaptureStream> {
    OpenedCapture {
        stream: Box::new(opened.stream),
        context: opened.context,
        output_sample_rate_hz: opened.output_sample_rate_hz,
    }
}

#[cfg(target_os = "linux")]
fn open_playback(
    source: &CaptureSource,
    stop_flag: &Arc<AtomicBool>,
) -> Result<OpenedCapture<CaptureStream>, AppError> {
    pipewire::open_playback(source, stop_flag).map(boxed)
}

#[cfg(target_os = "windows")]
fn open_playback(
    source: &CaptureSource,
    stop_flag: &Arc<AtomicBool>,
) -> Result<OpenedCapture<CaptureStream>, AppError> {
    wasapi::open_playback(source, stop_flag)
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
fn open_playback(
    _source: &CaptureSource,
    _stop_flag: &Arc<AtomicBool>,
) -> Result<OpenedCapture<CaptureStream>, AppError> {
    Err(unsupported())
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
fn unsupported() -> AppError {
    AppError::ServiceUnavailable("Recording the computer sound is not supported here".into())
}

/// Whether the sound the computer plays can be recorded: on Linux only with
/// a PipeWire server, see `dev_docs/cross-platform.md`.
pub(crate) fn can_capture_playback() -> bool {
    #[cfg(target_os = "linux")]
    return pipewire::is_available();
    #[cfg(target_os = "windows")]
    return wasapi::has_device_loopback();
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    return false;
}

/// Whether a single application can be recorded: Windows needs process
/// loopback, checked by actual activation and initialization.
pub(crate) fn can_capture_apps() -> bool {
    #[cfg(target_os = "linux")]
    return pipewire::is_available();
    #[cfg(target_os = "windows")]
    return wasapi::has_process_loopback();
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    return false;
}

/// Watches the applications that play sound; dropping it stops watching.
pub(crate) type AudioAppsWatch = Box<dyn Any + Send>;

/// Calls `on_change` with the applications that play sound, now and on each
/// change, until the returned watch is dropped.
pub(crate) fn watch_audio_apps(
    on_change: Box<dyn Fn(Vec<AudioApp>) + Send>,
) -> Result<AudioAppsWatch, AppError> {
    #[cfg(target_os = "linux")]
    return pipewire::watch_apps(on_change).map(|watch| Box::new(watch) as AudioAppsWatch);
    #[cfg(target_os = "windows")]
    return wasapi::watch_apps(on_change).map(|watch| Box::new(watch) as AudioAppsWatch);
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        let _ = on_change;
        Err(unsupported())
    }
}
