//! Bounded, single-monitor capture. No window/runtime state crosses this boundary.
use crate::{
    desktop_contract::{MAX_CHAT_IMAGE_DIMENSION, MAX_CHAT_IMAGE_PIXELS},
    errors::AppError,
};

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "windows")]
mod windows;

#[derive(Clone, Copy, Debug)]
pub(crate) struct Screen {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

pub(crate) struct Pixels {
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

pub(crate) fn pixel_bytes(width: u32, height: u32) -> Result<usize, AppError> {
    if width == 0
        || height == 0
        || width > MAX_CHAT_IMAGE_DIMENSION
        || height > MAX_CHAT_IMAGE_DIMENSION
        || u64::from(width) * u64::from(height) > MAX_CHAT_IMAGE_PIXELS
    {
        return Err(AppError::FileTooLarge(
            "Screenshot dimensions limit exceeded".into(),
        ));
    }
    Ok(width as usize * height as usize * 4)
}

/// Resolve the monitor before hiding application windows. Wayland delegates
/// monitor access to the portal and may use a system picker instead.
pub(crate) fn screen() -> Result<Option<Screen>, AppError> {
    #[cfg(target_os = "linux")]
    return linux::screen();
    #[cfg(target_os = "windows")]
    return windows::screen().map(Some);
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    Err(AppError::ServiceUnavailable(
        "Screenshot capture is unsupported on this platform".into(),
    ))
}

pub(crate) fn capture(screen: Option<Screen>) -> Result<Option<Pixels>, AppError> {
    #[cfg(target_os = "linux")]
    return linux::capture(screen);
    #[cfg(target_os = "windows")]
    return windows::capture(screen.ok_or_else(|| AppError::invalid_input("Missing monitor"))?)
        .map(Some);
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        let _ = screen;
        Err(AppError::ServiceUnavailable(
            "Screenshot capture is unsupported on this platform".into(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounds_are_checked_before_allocating_pixels() {
        assert_eq!(pixel_bytes(3840, 2160).unwrap(), 3840 * 2160 * 4);
        for (w, h) in [(0, 10), (10, 0), (u32::MAX, 10), (16384, 16384)] {
            assert!(pixel_bytes(w, h).is_err());
        }
    }
}
