//! Inserting text goes through the clipboard. On Wayland the previous
//! clipboard content is put back once the target window has pasted.

use std::io::Read;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const COMMAND_TIMEOUT: Duration = Duration::from_millis(500);
const POLL_INTERVAL: Duration = Duration::from_millis(10);
/// The target reads the clipboard when it handles the paste keys; restoring
/// earlier would make it paste the old content.
const RESTORE_DELAY: Duration = Duration::from_secs(1);
const TEXT_TYPES: [&str; 3] = ["text/plain;charset=utf-8", "text/plain", "UTF8_STRING"];

/// One representation of the clipboard content. `wl-copy` offers a single
/// type, so rich content comes back as its plain text or image only.
#[derive(Debug, PartialEq, Eq)]
pub struct ClipboardSnapshot {
    mime_type: String,
    data: Vec<u8>,
}

pub fn snapshot() -> Option<ClipboardSnapshot> {
    if !super::kwin_windows::is_kde_wayland_session() {
        return None;
    }
    let types = command_output("wl-paste", &["--list-types"])?;
    let types = String::from_utf8(types).ok()?;
    let mime_type = preferred_type(types.lines())?;
    let data = command_output("wl-paste", &["--no-newline", "--type", &mime_type])?;
    Some(ClipboardSnapshot { mime_type, data })
}

/// Puts `snapshot` back unless the clipboard got something other than
/// `inserted` meanwhile, e.g. the user copied text.
pub fn restore_later(snapshot: ClipboardSnapshot, inserted: String) {
    thread::spawn(move || {
        thread::sleep(RESTORE_DELAY);
        let current = command_output("wl-paste", &["--no-newline", "--type", "text/plain"]);
        if current.as_deref() != Some(inserted.as_bytes()) {
            return;
        }
        if let Err(error) = write(&snapshot) {
            log::warn!("Could not restore the clipboard: {error}");
        }
    });
}

/// The plain text in the clipboard, if it holds any.
pub fn read_text() -> Option<String> {
    let output = if is_x11_session() {
        command_output("xclip", &["-selection", "clipboard", "-o"])?
    } else {
        command_output("wl-paste", &["--no-newline", "--type", "text/plain"])?
    };
    String::from_utf8(output).ok()
}

/// Empties the clipboard; used when there is no snapshot to put back.
pub fn clear() {
    let result = if is_x11_session() {
        crate::commands::window::copy_to_clipboard("")
    } else {
        Command::new("wl-copy")
            .arg("--clear")
            .status()
            .map(drop)
            .map_err(Into::into)
    };
    if let Err(error) = result {
        log::warn!("Could not clear the clipboard: {error}");
    }
}

/// Puts `snapshot` back right away.
pub fn restore_now(snapshot: &ClipboardSnapshot) {
    if let Err(error) = write(snapshot) {
        log::warn!("Could not restore the clipboard: {error}");
    }
}

fn is_x11_session() -> bool {
    std::env::var("XDG_SESSION_TYPE").is_ok_and(|value| value.eq_ignore_ascii_case("x11"))
}

fn preferred_type<'a>(types: impl Iterator<Item = &'a str>) -> Option<String> {
    let types: Vec<&str> = types.map(str::trim).collect();
    TEXT_TYPES
        .iter()
        .find(|text_type| types.contains(text_type))
        .copied()
        .or_else(|| {
            types
                .iter()
                .find(|mime_type| mime_type.starts_with("image/"))
                .copied()
        })
        .map(str::to_owned)
}

fn write(snapshot: &ClipboardSnapshot) -> std::io::Result<()> {
    use std::io::Write;

    let mut child = Command::new("wl-copy")
        .args(["--type", &snapshot.mime_type])
        .stdin(Stdio::piped())
        .spawn()?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(&snapshot.data)?;
    }
    let status = child.wait()?;
    if status.success() {
        Ok(())
    } else {
        Err(std::io::Error::other(format!(
            "wl-copy failed with {status}"
        )))
    }
}

/// `wl-paste` blocks while the clipboard owner does not answer, so it gets a
/// timeout.
fn command_output(binary: &str, args: &[&str]) -> Option<Vec<u8>> {
    let mut child = Command::new(binary)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let reader = thread::spawn(move || {
        let mut output = Vec::new();
        stdout.read_to_end(&mut output).map(|_| output)
    });
    let deadline = Instant::now() + COMMAND_TIMEOUT;
    let status = loop {
        if let Some(status) = child.try_wait().ok()? {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        thread::sleep(POLL_INTERVAL);
    };
    let output = reader.join().ok()?.ok()?;
    status.success().then_some(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_utf8_text() {
        let types = ["text/html", "text/plain", "text/plain;charset=utf-8"];
        assert_eq!(
            preferred_type(types.into_iter()).as_deref(),
            Some("text/plain;charset=utf-8")
        );
    }

    #[test]
    fn falls_back_to_an_image() {
        let types = ["x-kde-force-image-copy", "image/png", "image/jpeg"];
        assert_eq!(
            preferred_type(types.into_iter()).as_deref(),
            Some("image/png")
        );
    }

    #[test]
    fn skips_content_it_cannot_restore() {
        assert_eq!(preferred_type(["text/uri-list"].into_iter()), None);
        assert_eq!(preferred_type(std::iter::empty()), None);
    }
}
