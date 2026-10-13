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
        super::windows_clipboard::write_text(text)
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

    Err(AppError::Message(String::from(
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
