//! macOS source identity and selection through AppKit and Accessibility.
use std::ffi::{c_char, c_void, CString};
use std::sync::atomic::{AtomicI32, Ordering};
use std::time::Duration;

use crate::errors::AppError;

type CFTypeRef = *const c_void;
const UTF8_ENCODING: u32 = 0x0800_0100;
const MAX_SELECTION_BYTES: isize = 16 * 1024 * 1024;

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
    fn AXUIElementCreateApplication(pid: i32) -> CFTypeRef;
    fn AXUIElementSetMessagingTimeout(element: CFTypeRef, timeout: f32) -> i32;
    fn AXUIElementCopyAttributeValue(
        element: CFTypeRef,
        attribute: CFTypeRef,
        value: *mut CFTypeRef,
    ) -> i32;
    fn AXUIElementGetTypeID() -> usize;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(value: CFTypeRef);
    fn CFGetTypeID(value: CFTypeRef) -> usize;
    fn CFStringGetTypeID() -> usize;
    fn CFStringCreateWithCString(
        allocator: CFTypeRef,
        value: *const c_char,
        encoding: u32,
    ) -> CFTypeRef;
    fn CFStringGetLength(value: CFTypeRef) -> isize;
    fn CFStringGetMaximumSizeForEncoding(length: isize, encoding: u32) -> isize;
    fn CFStringGetCString(value: CFTypeRef, buffer: *mut c_char, size: isize, encoding: u32) -> u8;
}

/// Every Create/Copy result has one reference, released on every exit path.
struct OwnedValue(CFTypeRef);

impl OwnedValue {
    fn new(value: CFTypeRef) -> Option<Self> {
        (!value.is_null()).then(|| Self(value))
    }
}

impl Drop for OwnedValue {
    fn drop(&mut self) {
        unsafe { CFRelease(self.0) };
    }
}

fn attribute(element: CFTypeRef, name: &str) -> Option<OwnedValue> {
    let name = CString::new(name).ok()?;
    let name = OwnedValue::new(unsafe {
        CFStringCreateWithCString(std::ptr::null(), name.as_ptr(), UTF8_ENCODING)
    })?;
    let mut value = std::ptr::null();
    let status = unsafe { AXUIElementCopyAttributeValue(element, name.0, &mut value) };
    let value = OwnedValue::new(value);
    if status == 0 {
        value
    } else {
        None
    }
}

pub fn capture_source() -> Option<String> {
    static LAST_SOURCE: AtomicI32 = AtomicI32::new(0);
    const SCRIPT: &str = r#"
ObjC.import('AppKit');
function run() {
    var app = $.NSWorkspace.sharedWorkspace.frontmostApplication;
    return app ? String(app.processIdentifier) : '';
}
"#;
    let (status, output) = super::process::run(
        super::process::command("osascript", &["-l", "JavaScript", "-e", SCRIPT]),
        None,
        Duration::from_secs(2),
    )
    .ok()?;
    if !status.success() {
        return None;
    }
    let pid = String::from_utf8(output).ok()?.trim().parse::<i32>().ok()?;
    let source = if pid as u32 == std::process::id() {
        LAST_SOURCE.load(Ordering::SeqCst)
    } else {
        LAST_SOURCE.store(pid, Ordering::SeqCst);
        pid
    };
    (source > 0).then(|| source.to_string())
}

pub async fn capture_selection(source: Option<String>) -> Option<String> {
    let pid = source?.parse::<i32>().ok()?;
    if pid <= 0 || pid as u32 == std::process::id() || !unsafe { AXIsProcessTrusted() } {
        return None;
    }
    let app = OwnedValue::new(unsafe { AXUIElementCreateApplication(pid) })?;
    // A hung application must not keep a selection request alive indefinitely.
    unsafe { AXUIElementSetMessagingTimeout(app.0, 1.0) };
    let focused = attribute(app.0, "AXFocusedUIElement")?;
    if unsafe { CFGetTypeID(focused.0) } != unsafe { AXUIElementGetTypeID() } {
        return None;
    }
    let selected = attribute(focused.0, "AXSelectedText")?;
    if unsafe { CFGetTypeID(selected.0) } != unsafe { CFStringGetTypeID() } {
        return None;
    }
    let size =
        unsafe { CFStringGetMaximumSizeForEncoding(CFStringGetLength(selected.0), UTF8_ENCODING) }
            .checked_add(1)?;
    if !(1..=MAX_SELECTION_BYTES).contains(&size) {
        return None;
    }
    let mut buffer = vec![0u8; size as usize];
    if unsafe { CFStringGetCString(selected.0, buffer.as_mut_ptr().cast(), size, UTF8_ENCODING) }
        == 0
    {
        return None;
    }
    let length = buffer.iter().position(|byte| *byte == 0)?;
    buffer.truncate(length);
    let text = String::from_utf8(buffer).ok()?;
    (!text.trim().is_empty()).then_some(text)
}

pub fn inject_paste(source_window_id: Option<&str>) -> Result<(), AppError> {
    let pid = source_window_id
        .and_then(|value| value.parse::<i32>().ok())
        .filter(|pid| *pid > 0 && *pid as u32 != std::process::id())
        .ok_or_else(|| AppError::Message("Target application is not available".into()))?;
    check_text_injection()?;
    const SCRIPT: &str = r#"
ObjC.import('AppKit');
function run(argv) {
    var pid = Number(argv[0]);
    var target = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
    if (!target || target.terminated || !target.activateWithOptions(2)) {
        throw new Error('Could not activate the target application');
    }
    var deadline = Date.now() + 1000;
    while ($.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier !== pid) {
        if (Date.now() >= deadline) throw new Error('The target application did not receive focus');
        delay(0.025);
    }
    Application('System Events').keystroke('v', { using: 'command down' });
}
"#;
    let (status, _) = super::process::run(
        super::process::command(
            "osascript",
            &["-l", "JavaScript", "-e", SCRIPT, &pid.to_string()],
        ),
        None,
        Duration::from_secs(3),
    )?;
    if !status.success() {
        return Err(AppError::Message("Could not paste into the target application; check Accessibility and Automation permissions".into()));
    }
    Ok(())
}

pub(super) fn check_text_injection() -> Result<(), AppError> {
    if unsafe { AXIsProcessTrusted() } {
        return Ok(());
    }
    Err(AppError::Message(
        "Text insertion requires Accessibility permission".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paste_rejects_missing_invalid_and_own_targets_before_sending_keys() {
        for target in [
            None,
            Some("invalid"),
            Some("0"),
            Some("-1"),
            Some(std::process::id().to_string().as_str()),
        ] {
            assert!(inject_paste(target).is_err());
        }
    }
}
