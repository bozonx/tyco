//! Clipboard snapshots preserve every available HGLOBAL-backed format.
//! Formats backed by GDI or metafile handles are left out: Windows
//! synthesizes most of them again from the formats that are kept, e.g. a
//! bitmap from its DIB.
use crate::errors::AppError;
use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::{GlobalFree, HWND};
use windows_sys::Win32::System::DataExchange::{
    CloseClipboard, CountClipboardFormats, EmptyClipboard, EnumClipboardFormats, GetClipboardData,
    GetClipboardSequenceNumber, OpenClipboard, SetClipboardData,
};
use windows_sys::Win32::System::Memory::{
    GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{CreateWindowExW, DestroyWindow, HWND_MESSAGE};

const UNICODE_TEXT: u32 = 13;
const MAX_SNAPSHOT_BYTES: usize = 16 * 1024 * 1024;

struct WindowsClipboardLock(HWND);
impl WindowsClipboardLock {
    fn open() -> Result<Self, AppError> {
        let class: Vec<u16> = "STATIC".encode_utf16().chain(Some(0)).collect();
        let window = unsafe {
            CreateWindowExW(
                0,
                class.as_ptr(),
                std::ptr::null(),
                0,
                0,
                0,
                0,
                0,
                HWND_MESSAGE,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null(),
            )
        };
        if window.is_null() {
            return Err(std::io::Error::last_os_error().into());
        }
        let deadline = Instant::now() + Duration::from_millis(250);
        loop {
            if unsafe { OpenClipboard(window) } != 0 {
                return Ok(Self(window));
            }
            if Instant::now() >= deadline {
                unsafe {
                    DestroyWindow(window);
                }
                return Err(AppError::Busy("Clipboard is busy".into()));
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}
impl Drop for WindowsClipboardLock {
    fn drop(&mut self) {
        unsafe {
            CloseClipboard();
            DestroyWindow(self.0);
        }
    }
}

#[derive(Clone)]
pub struct ClipboardSnapshot(Vec<(u32, Vec<u8>)>);

pub fn snapshot() -> Result<ClipboardSnapshot, AppError> {
    let _clipboard = WindowsClipboardLock::open()?;
    let mut formats = Vec::new();
    let mut format = 0;
    let mut total = 0;
    loop {
        format = unsafe { EnumClipboardFormats(format) };
        if format == 0 {
            break;
        }
        // These formats use GDI/metafile handles rather than global memory.
        if matches!(format, 2 | 3 | 9 | 14 | 0x80..=0x8e | 0x300..=0x3ff) {
            continue;
        }
        let handle = unsafe { GetClipboardData(format) };
        if handle.is_null() {
            // a delayed rendering the owner did not provide
            continue;
        }
        let size = unsafe { GlobalSize(handle) };
        if size == 0 {
            continue;
        }
        total += size;
        if total > MAX_SNAPSHOT_BYTES {
            return Err(AppError::ResourceLimit(
                "Clipboard content is too large to be preserved".into(),
            ));
        }
        let pointer = unsafe { GlobalLock(handle) };
        if pointer.is_null() {
            continue;
        }
        let bytes = unsafe { std::slice::from_raw_parts(pointer.cast::<u8>(), size).to_vec() };
        unsafe {
            GlobalUnlock(handle);
        }
        formats.push((format, bytes));
    }
    if formats.is_empty() && unsafe { CountClipboardFormats() } != 0 {
        return Err(AppError::Failed(
            "Clipboard holds no format that can be preserved".into(),
        ));
    }
    Ok(ClipboardSnapshot(formats))
}

fn set_bytes(format: u32, bytes: &[u8]) -> Result<(), AppError> {
    let handle = unsafe { GlobalAlloc(GMEM_MOVEABLE, bytes.len()) };
    if handle.is_null() {
        return Err(std::io::Error::last_os_error().into());
    }
    let pointer = unsafe { GlobalLock(handle) };
    if pointer.is_null() {
        unsafe {
            GlobalFree(handle);
        }
        return Err(std::io::Error::last_os_error().into());
    }
    unsafe {
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), pointer.cast(), bytes.len());
        GlobalUnlock(handle);
    }
    if unsafe { SetClipboardData(format, handle) }.is_null() {
        unsafe {
            GlobalFree(handle);
        }
        return Err(std::io::Error::last_os_error().into());
    }
    // Windows owns the handle after SetClipboardData succeeds.
    Ok(())
}

pub fn restore(snapshot: &ClipboardSnapshot) -> Result<(), AppError> {
    let _clipboard = WindowsClipboardLock::open()?;
    if unsafe { EmptyClipboard() } == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    for (format, bytes) in &snapshot.0 {
        set_bytes(*format, bytes)?;
    }
    Ok(())
}

pub fn clear() -> Result<(), AppError> {
    let _clipboard = WindowsClipboardLock::open()?;
    if unsafe { EmptyClipboard() } == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}

pub fn write_text(text: &str) -> Result<(), AppError> {
    let _clipboard = WindowsClipboardLock::open()?;
    if unsafe { EmptyClipboard() } == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    let bytes: Vec<u8> = text
        .encode_utf16()
        .chain(Some(0))
        .flat_map(u16::to_ne_bytes)
        .collect();
    set_bytes(UNICODE_TEXT, &bytes)
}

pub fn read_text() -> Option<String> {
    let _clipboard = WindowsClipboardLock::open().ok()?;
    let handle = unsafe { GetClipboardData(UNICODE_TEXT) };
    let size = unsafe { GlobalSize(handle) };
    if handle.is_null() || size == 0 || size > MAX_SNAPSHOT_BYTES {
        return None;
    }
    let pointer = unsafe { GlobalLock(handle) };
    if pointer.is_null() {
        return None;
    }
    let words = unsafe { std::slice::from_raw_parts(pointer.cast::<u16>(), size / 2) };
    let length = words
        .iter()
        .position(|word| *word == 0)
        .unwrap_or(words.len());
    let text = String::from_utf16(words.get(..length)?).ok();
    unsafe {
        GlobalUnlock(handle);
    }
    text
}

pub fn restore_later(snapshot: ClipboardSnapshot) {
    let sequence = unsafe { GetClipboardSequenceNumber() };
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(500));
        if unsafe { GetClipboardSequenceNumber() } == sequence {
            let _ = restore(&snapshot);
        }
    });
}
