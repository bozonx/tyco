//! Puts text into the system clipboard through the platform's command line
//! tools, so that no clipboard owner has to stay alive in this process.

#[cfg(any(target_os = "linux", target_os = "macos"))]
use std::time::Duration;

use crate::errors::AppError;

pub fn copy_to_clipboard(text: &str) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        write_to_clipboard_command("pbcopy", &[], text)
    }

    #[cfg(target_os = "windows")]
    {
        super::windows::clipboard::write_text(text)
    }

    #[cfg(target_os = "linux")]
    {
        copy_to_clipboard_linux(text)
    }
}

#[cfg(target_os = "linux")]
fn copy_to_clipboard_linux(text: &str) -> Result<(), AppError> {
    let clipboard_commands: [(&str, &[&str]); 3] = [
        ("wl-copy", &["--type", "text/plain"]),
        ("xclip", &["-selection", "clipboard"]),
        ("xsel", &["--clipboard", "--input"]),
    ];

    let mut last_error: Option<AppError> = None;

    for (binary, args) in clipboard_commands {
        match write_to_clipboard_command(binary, args, text) {
            Ok(()) => return Ok(()),
            Err(AppError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => last_error = Some(error),
        }
    }

    if let Some(error) = last_error {
        return Err(error);
    }

    Err(AppError::ServiceUnavailable(String::from(
        "No clipboard utility found. Install wl-clipboard, xclip, or xsel.",
    )))
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn write_to_clipboard_command(binary: &str, args: &[&str], text: &str) -> Result<(), AppError> {
    let status = super::process::status(
        super::process::command(binary, args),
        Some(text.as_bytes()),
        Duration::from_secs(5),
    )?;
    if !status.success() {
        return Err(AppError::Message(format!(
            "Clipboard command `{binary}` failed with status {status}",
        )));
    }

    Ok(())
}

/// What the clipboard held before Tyco put text there to move it, so that
/// it can get it back. Only Linux and Windows can take one.
#[cfg(target_os = "linux")]
pub(crate) use super::linux::clipboard_restore::ClipboardSnapshot;
#[cfg(target_os = "windows")]
pub(crate) use super::windows::clipboard::ClipboardSnapshot;
#[cfg(not(any(target_os = "linux", target_os = "windows")))]
#[derive(Debug)]
pub(crate) enum ClipboardSnapshot {}

/// The clipboard content, if the platform can preserve it.
pub(crate) fn snapshot() -> Option<ClipboardSnapshot> {
    #[cfg(target_os = "linux")]
    {
        super::linux::clipboard_restore::snapshot()
    }
    #[cfg(target_os = "windows")]
    {
        super::windows::clipboard::snapshot()
            .inspect_err(|error| log::warn!("The clipboard will not be restored: {error}"))
            .ok()
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        None
    }
}

/// Puts `snapshot` back once the target window has had time to paste
/// `inserted`, unless the clipboard got something else meanwhile.
pub(crate) fn restore_later(snapshot: ClipboardSnapshot, inserted: String) {
    #[cfg(target_os = "linux")]
    super::linux::clipboard_restore::restore_later(snapshot, inserted);
    #[cfg(target_os = "windows")]
    {
        let _ = inserted;
        super::windows::clipboard::restore_later(snapshot);
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        let _ = inserted;
        match snapshot {}
    }
}

/// Puts `snapshot` back right away.
pub(crate) fn restore_now(snapshot: &ClipboardSnapshot) {
    #[cfg(target_os = "linux")]
    super::linux::clipboard_restore::restore_now(snapshot);
    #[cfg(target_os = "windows")]
    if let Err(error) = super::windows::clipboard::restore(snapshot) {
        log::warn!("Could not restore the clipboard: {error}");
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    match *snapshot {}
}

/// The plain text in the clipboard, if it holds any and the platform can
/// read it.
pub(crate) fn read_text() -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        super::linux::clipboard_restore::read_text()
    }
    #[cfg(target_os = "windows")]
    {
        super::windows::clipboard::read_text()
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        None
    }
}

/// Empties the clipboard; used when there is no snapshot to put back.
pub(crate) fn clear() {
    #[cfg(target_os = "linux")]
    super::linux::clipboard_restore::clear();
    #[cfg(target_os = "windows")]
    if let Err(error) = super::windows::clipboard::clear() {
        log::warn!("Could not clear the clipboard: {error}");
    }
}
