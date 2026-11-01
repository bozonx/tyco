//! Puts text into the system clipboard through the platform's command line
//! tools, so that no clipboard owner has to stay alive in this process.

#[cfg(any(target_os = "linux", target_os = "macos"))]
use std::time::Duration;

use crate::errors::AppError;

mod session;

pub(crate) use session::{session, SystemClipboardOperation};

/// Whether clipboard managers and the clipboard history may keep a text.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Retention {
    /// The user asked for the text and may want it again later.
    History,
    /// A probe, a selection or a result Tyco moves through the clipboard:
    /// no content of the user's, and a history would keep it for good.
    Transient,
}

/// Puts text the user asked for into the clipboard. Content an earlier
/// capture or paste still owes back is forgotten: the user replaced it.
pub fn copy_for_user(text: &str) -> Result<(), AppError> {
    let operation = session().begin();
    operation.discard_owed();
    write_text(text, Retention::History)
}

/// Puts text Tyco moves through the clipboard there, kept out of clipboard
/// managers where the platform allows. Captures and pastes call it while
/// they hold a clipboard operation, see `session`.
pub fn copy_to_clipboard(text: &str) -> Result<(), AppError> {
    write_text(text, Retention::Transient)
}

fn write_text(text: &str, retention: Retention) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        let _ = retention;
        write_to_clipboard_command("pbcopy", &[], text)
    }

    #[cfg(target_os = "windows")]
    {
        super::windows::clipboard::write_text(text, retention == Retention::Transient)
    }

    #[cfg(target_os = "linux")]
    {
        copy_to_clipboard_linux(text, retention)
    }
}

/// Whether `wl-copy` can tell clipboard managers to keep a text out of their
/// history (wl-clipboard 2.2 and later), which Klipper and CopyQ honor.
#[cfg(target_os = "linux")]
fn wl_copy_has_sensitive() -> bool {
    static HAS_SENSITIVE: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *HAS_SENSITIVE.get_or_init(|| {
        super::linux::command::output_with_timeout("wl-copy", &["--help"], Duration::from_secs(2))
            .is_some_and(|help| String::from_utf8_lossy(&help).contains("--sensitive"))
    })
}

#[cfg(target_os = "linux")]
fn copy_to_clipboard_linux(text: &str, retention: Retention) -> Result<(), AppError> {
    use super::linux::clipboard_restore::Backend;

    // xclip and xsel cannot add the hint clipboard managers look for
    let wl_copy: &[&str] = if retention == Retention::Transient && wl_copy_has_sensitive() {
        &["--type", "text/plain", "--sensitive"]
    } else {
        &["--type", "text/plain"]
    };
    // the tool of the session: on X11, `wl-copy` would fill the clipboard of
    // a Wayland session that `xclip` and the reads of Tyco never see
    let clipboard_commands: Vec<(&str, &[&str])> = match Backend::current() {
        Some(Backend::WlClipboard) => vec![("wl-copy", wl_copy)],
        Some(Backend::Xclip) => vec![
            ("xclip", &["-selection", "clipboard"]),
            ("xsel", &["--clipboard", "--input"]),
        ],
        None => vec![
            ("wl-copy", wl_copy),
            ("xclip", &["-selection", "clipboard"]),
            ("xsel", &["--clipboard", "--input"]),
        ],
    };

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
        "No clipboard utility found. Install wl-clipboard on Wayland, or xclip on X11.",
    )))
}

/// The clipboard tools the session needs and lacks; empty when all are
/// there.
#[cfg(target_os = "linux")]
pub fn missing_clipboard_tools() -> Vec<&'static str> {
    use super::linux::clipboard_restore::Backend;
    let Some(backend) = Backend::current() else {
        return Vec::new();
    };
    let path = std::env::var_os("PATH");
    backend
        .tools()
        .iter()
        .copied()
        .filter(|tool| {
            path.as_deref()
                .is_none_or(|path| !std::env::split_paths(path).any(|dir| dir.join(tool).is_file()))
        })
        .collect()
}

/// How long a clipboard tool may take to take the text.
#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(super) const CLIPBOARD_WRITE_TIMEOUT: Duration = Duration::from_secs(5);

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn write_to_clipboard_command(binary: &str, args: &[&str], text: &str) -> Result<(), AppError> {
    let status = super::process::status(
        super::process::command(binary, args),
        Some(text.as_bytes()),
        CLIPBOARD_WRITE_TIMEOUT,
    )?;
    if !status.success() {
        return Err(AppError::Failed(format!(
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

/// The clipboard content, if the platform can preserve it. Captures and
/// pastes take it through their operation, see `session`.
fn snapshot() -> Option<ClipboardSnapshot> {
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

/// Puts `snapshot` back right away.
fn restore_now(snapshot: &ClipboardSnapshot) {
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
