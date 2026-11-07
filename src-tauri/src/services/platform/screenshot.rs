//! Bounded, single-monitor capture. No window/runtime state crosses this boundary.
use crate::{errors::AppError, models::CropRect, services::chat_images::within_capture_limits};

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "windows")]
mod windows;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
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
    if !within_capture_limits(width, height) {
        return Err(AppError::FileTooLarge(
            "Screenshot dimensions limit exceeded".into(),
        ));
    }
    Ok(width as usize * height as usize * 4)
}

pub(crate) fn crop_pixels(pixels: &Pixels, rect: CropRect) -> Result<Pixels, AppError> {
    if rect.width == 0 || rect.height == 0 {
        return Err(AppError::InvalidInput(
            "Crop rectangle cannot be empty".into(),
        ));
    }
    let right = rect
        .x
        .checked_add(rect.width)
        .ok_or_else(|| AppError::InvalidInput("Crop bounds overflow".into()))?;
    let bottom = rect
        .y
        .checked_add(rect.height)
        .ok_or_else(|| AppError::InvalidInput("Crop bounds overflow".into()))?;
    if right > pixels.width || bottom > pixels.height {
        return Err(AppError::InvalidInput(
            "Crop rectangle out of bounds".into(),
        ));
    }
    let out_size = pixel_bytes(rect.width, rect.height)?;
    let mut out_bytes = vec![0u8; out_size];
    let src_stride = pixels.width as usize * 4;
    let dst_stride = rect.width as usize * 4;
    for row in 0..rect.height as usize {
        let src_start = (rect.y as usize + row) * src_stride + rect.x as usize * 4;
        let dst_start = row * dst_stride;
        out_bytes[dst_start..dst_start + dst_stride]
            .copy_from_slice(&pixels.bytes[src_start..src_start + dst_stride]);
    }
    Ok(Pixels {
        bytes: out_bytes,
        width: rect.width,
        height: rect.height,
    })
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

/// Captures one entire screen; area selection crops the result afterwards.
pub(crate) fn capture(screen: Option<Screen>) -> Result<Option<Pixels>, AppError> {
    #[cfg(target_os = "linux")]
    return linux::capture(screen);
    #[cfg(target_os = "windows")]
    {
        windows::capture(screen.ok_or_else(|| AppError::invalid_input("Missing monitor"))?)
            .map(Some)
    }
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
        for (w, h) in [(0, 10), (10, 0), (u32::MAX, 10), (16384, 16384), (16385, 1)] {
            assert!(pixel_bytes(w, h).is_err());
        }
    }

    #[test]
    fn cropping_pixels_extracts_correct_bounds() {
        // 4x4 image with unique values for every pixel
        let mut bytes = vec![0u8; 4 * 4 * 4];
        for y in 0..4 {
            for x in 0..4 {
                let idx = (y * 4 + x) * 4;
                bytes[idx] = x as u8;
                bytes[idx + 1] = y as u8;
                bytes[idx + 2] = (x + y) as u8;
                bytes[idx + 3] = 255;
            }
        }
        let pixels = Pixels {
            bytes,
            width: 4,
            height: 4,
        };

        let cropped = crop_pixels(
            &pixels,
            CropRect {
                x: 1,
                y: 1,
                width: 2,
                height: 2,
            },
        )
        .unwrap();
        assert_eq!(cropped.width, 2);
        assert_eq!(cropped.height, 2);
        assert_eq!(cropped.bytes.len(), 2 * 2 * 4);

        // Row 0 of crop = (1, 1), (2, 1)
        assert_eq!(&cropped.bytes[0..4], &[1, 1, 2, 255]);
        assert_eq!(&cropped.bytes[4..8], &[2, 1, 3, 255]);
        // Row 1 of crop = (1, 2), (2, 2)
        assert_eq!(&cropped.bytes[8..12], &[1, 2, 3, 255]);
        assert_eq!(&cropped.bytes[12..16], &[2, 2, 4, 255]);
    }

    #[test]
    fn cropping_rejects_empty_and_out_of_bounds() {
        let pixels = Pixels {
            bytes: vec![0; 4 * 4 * 4],
            width: 4,
            height: 4,
        };
        assert!(crop_pixels(
            &pixels,
            CropRect {
                x: 0,
                y: 0,
                width: 0,
                height: 2
            }
        )
        .is_err());
        assert!(crop_pixels(
            &pixels,
            CropRect {
                x: 0,
                y: 0,
                width: 2,
                height: 0
            }
        )
        .is_err());
        assert!(crop_pixels(
            &pixels,
            CropRect {
                x: 3,
                y: 3,
                width: 2,
                height: 2
            }
        )
        .is_err());
        assert!(crop_pixels(
            &pixels,
            CropRect {
                x: 4,
                y: 0,
                width: 1,
                height: 1
            }
        )
        .is_err());
    }
}
