use super::{pixel_bytes, Pixels, Screen};
use crate::errors::AppError;
use windows_sys::Win32::{Foundation::POINT, Graphics::Gdi::*};

fn failed() -> AppError {
    AppError::Failed(format!(
        "Screenshot capture failed: {}",
        std::io::Error::last_os_error()
    ))
}

pub(super) fn screen() -> Result<Screen, AppError> {
    unsafe {
        let mut point = POINT { x: 0, y: 0 };
        if windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos(&mut point) == 0 {
            return Err(failed());
        }
        let monitor = MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST);
        let mut info: MONITORINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(monitor, &mut info) == 0 {
            return Err(failed());
        }
        let rect = info.rcMonitor;
        let screen = Screen {
            x: rect.left,
            y: rect.top,
            width: (rect.right - rect.left) as u32,
            height: (rect.bottom - rect.top) as u32,
        };
        pixel_bytes(screen.width, screen.height)?;
        Ok(screen)
    }
}

pub(super) fn capture(screen: Screen) -> Result<Pixels, AppError> {
    let size = pixel_bytes(screen.width, screen.height)?;
    unsafe {
        let desktop = GetDC(std::ptr::null_mut());
        if desktop.is_null() {
            return Err(failed());
        }
        let memory = CreateCompatibleDC(desktop);
        let bitmap = CreateCompatibleBitmap(desktop, screen.width as i32, screen.height as i32);
        let result = (|| {
            if memory.is_null() || bitmap.is_null() {
                return Err(failed());
            }
            let previous = SelectObject(memory, bitmap);
            if previous.is_null() || previous == HGDI_ERROR {
                return Err(failed());
            }
            let copied = BitBlt(
                memory,
                0,
                0,
                screen.width as i32,
                screen.height as i32,
                desktop,
                screen.x,
                screen.y,
                SRCCOPY | CAPTUREBLT,
            );
            SelectObject(memory, previous);
            if copied == 0 {
                return Err(failed());
            }
            let mut info: BITMAPINFO = std::mem::zeroed();
            info.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
            info.bmiHeader.biWidth = screen.width as i32;
            info.bmiHeader.biHeight = -(screen.height as i32);
            info.bmiHeader.biPlanes = 1;
            info.bmiHeader.biBitCount = 32;
            info.bmiHeader.biCompression = BI_RGB;
            let mut bytes = vec![0; size];
            if GetDIBits(
                memory,
                bitmap,
                0,
                screen.height,
                bytes.as_mut_ptr().cast(),
                &mut info,
                DIB_RGB_COLORS,
            ) != screen.height as i32
            {
                return Err(failed());
            }
            for pixel in bytes.chunks_exact_mut(4) {
                pixel.swap(0, 2);
                pixel[3] = 255;
            }
            Ok(Pixels {
                bytes,
                width: screen.width,
                height: screen.height,
            })
        })();
        if !bitmap.is_null() {
            DeleteObject(bitmap);
        }
        if !memory.is_null() {
            DeleteDC(memory);
        }
        ReleaseDC(std::ptr::null_mut(), desktop);
        result
    }
}
