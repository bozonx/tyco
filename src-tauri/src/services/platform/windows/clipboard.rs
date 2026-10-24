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

const CF_BITMAP: u32 = 2;
const CF_METAFILEPICT: u32 = 3;
const CF_PALETTE: u32 = 9;
const CF_UNICODETEXT: u32 = 13;
const CF_ENHMETAFILE: u32 = 14;
const CF_DSP_FIRST: u32 = 0x0080;
const CF_DSP_LAST: u32 = 0x008E;
const CF_GDIOBJ_FIRST: u32 = 0x0300;
const CF_GDIOBJ_LAST: u32 = 0x03FF;
const UNICODE_TEXT: u32 = CF_UNICODETEXT;
/// How long to wait for another application to release the clipboard.
const OPEN_TIMEOUT: Duration = Duration::from_millis(250);
const OPEN_RETRY_INTERVAL: Duration = Duration::from_millis(10);
/// The pasting application reads the clipboard within this time.
const RESTORE_DELAY: Duration = Duration::from_millis(500);
const MAX_SNAPSHOT_BYTES: usize = 16 * 1024 * 1024;

fn is_non_global_memory_format(format: u32) -> bool {
    matches!(
        format,
        CF_BITMAP
            | CF_METAFILEPICT
            | CF_PALETTE
            | CF_ENHMETAFILE
            | CF_DSP_FIRST..=CF_DSP_LAST
            | CF_GDIOBJ_FIRST..=CF_GDIOBJ_LAST
    )
}

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
        let deadline = Instant::now() + OPEN_TIMEOUT;
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
            std::thread::sleep(OPEN_RETRY_INTERVAL);
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
        if is_non_global_memory_format(format) {
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
        std::thread::sleep(RESTORE_DELAY);
        if unsafe { GetClipboardSequenceNumber() } == sequence {
            let _ = restore(&snapshot);
        }
    });
}
