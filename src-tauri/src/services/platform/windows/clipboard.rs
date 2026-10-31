//! Clipboard snapshots preserve every available HGLOBAL-backed format.
//! Formats backed by GDI or metafile handles are left out: Windows
//! synthesizes most of them again from the formats that are kept, e.g. a
//! bitmap from its DIB.
use crate::errors::AppError;
use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::{GlobalFree, HWND};
use windows_sys::Win32::System::DataExchange::{
    CloseClipboard, CountClipboardFormats, EmptyClipboard, EnumClipboardFormats, GetClipboardData,
    GetClipboardSequenceNumber, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
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
const CF_PRIVATE_FIRST: u32 = 0x0200;
const CF_PRIVATE_LAST: u32 = 0x02FF;
const CF_GDIOBJ_FIRST: u32 = 0x0300;
const CF_GDIOBJ_LAST: u32 = 0x03FF;
const UNICODE_TEXT: u32 = CF_UNICODETEXT;
/// How long to wait for another application to release the clipboard.
const OPEN_TIMEOUT: Duration = Duration::from_millis(250);
const OPEN_RETRY_INTERVAL: Duration = Duration::from_millis(10);
/// The pasting application reads the clipboard within this time. Nothing
/// tells when it has, so the delay leaves room for slow targets: a remote
/// desktop, a busy Office document. Pasting the result twice is harmless;
/// pasting the old content, which may be a password, is not.
const RESTORE_DELAY: Duration = Duration::from_millis(2500);
/// How long after a capture gave up a late copy is still expected.
const LATE_COPY_WINDOW: Duration = Duration::from_millis(1500);
const LATE_COPY_POLL_INTERVAL: Duration = Duration::from_millis(100);
/// Registered formats that keep the text Tyco moves through the clipboard
/// out of clipboard managers, the clipboard history and its cloud sync.
const EXCLUDE_FROM_MONITORS: &str = "ExcludeClipboardContentFromMonitorProcessing";
const CAN_INCLUDE_IN_HISTORY: &str = "CanIncludeInClipboardHistory";
const CAN_UPLOAD_TO_CLOUD: &str = "CanUploadToCloudClipboard";
const MAX_SNAPSHOT_BYTES: usize = 16 * 1024 * 1024;

/// Formats whose handle may be no global memory: GDI and metafile handles,
/// and the private formats, which may hold any handle the owner likes.
fn is_non_global_memory_format(format: u32) -> bool {
    matches!(
        format,
        CF_BITMAP
            | CF_METAFILEPICT
            | CF_PALETTE
            | CF_ENHMETAFILE
            | CF_DSP_FIRST..=CF_DSP_LAST
            | CF_PRIVATE_FIRST..=CF_PRIVATE_LAST
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
    set_bytes(UNICODE_TEXT, &bytes)?;
    // the probe, the selection and the result are no content of the user's:
    // they stay out of the history, which would keep them for good
    for (name, value) in [
        (EXCLUDE_FROM_MONITORS, 0u32),
        (CAN_INCLUDE_IN_HISTORY, 0),
        (CAN_UPLOAD_TO_CLOUD, 0),
    ] {
        let format = registered_format(name);
        if format == 0 || set_bytes(format, &value.to_ne_bytes()).is_err() {
            log::debug!("Could not mark the clipboard text with {name}");
        }
    }
    Ok(())
}

fn registered_format(name: &str) -> u32 {
    let name: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
    unsafe { RegisterClipboardFormatW(name.as_ptr()) }
}

/// Changes with every change of the clipboard; reading it takes no lock, so
/// waiting on it leaves the clipboard free for the application that copies.
pub fn sequence_number() -> u32 {
    unsafe { GetClipboardSequenceNumber() }
}

pub fn read_text() -> Option<String> {
    let _clipboard = WindowsClipboardLock::open().ok()?;
    let handle = unsafe { GetClipboardData(UNICODE_TEXT) };
    if handle.is_null() {
        return None;
    }
    let size = unsafe { GlobalSize(handle) };
    if size == 0 || size > MAX_SNAPSHOT_BYTES {
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
    // lossy: a lone surrogate must not make a copied selection look absent
    let text = words.get(..length).map(String::from_utf16_lossy);
    unsafe {
        GlobalUnlock(handle);
    }
    text
}

/// Puts `snapshot` back again if the clipboard changes soon after it was
/// restored: an application that copied too late for a capture would
/// otherwise leave its copy there in place of the user's content.
pub fn guard_restored(snapshot: ClipboardSnapshot) {
    let sequence = sequence_number();
    std::thread::spawn(move || {
        let deadline = Instant::now() + LATE_COPY_WINDOW;
        while Instant::now() < deadline {
            std::thread::sleep(LATE_COPY_POLL_INTERVAL);
            if sequence_number() != sequence {
                log::debug!("A late copy replaced the restored clipboard; restoring it again");
                if let Err(error) = restore(&snapshot) {
                    log::warn!("Could not restore the clipboard: {error}");
                }
                return;
            }
        }
    });
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
