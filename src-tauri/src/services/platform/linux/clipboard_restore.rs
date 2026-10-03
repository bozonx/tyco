//! Inserting text goes through the clipboard. The previous clipboard content
//! is put back once the target window has pasted: with `wl-clipboard` on
//! Wayland and `xclip` on X11.

use std::io::Read;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use crate::services::platform::session;

const COMMAND_TIMEOUT: Duration = Duration::from_millis(500);
const POLL_INTERVAL: Duration = Duration::from_millis(10);
/// The target reads the clipboard when it handles the paste keys; restoring
/// earlier would make it paste the old content.
const RESTORE_DELAY: Duration = Duration::from_secs(1);
const TEXT_TYPES: [&str; 3] = ["text/plain;charset=utf-8", "text/plain", "UTF8_STRING"];

/// One representation of the clipboard content. The tools offer a single
/// type, so rich content comes back as its plain text or image only.
#[derive(Debug, PartialEq, Eq)]
pub struct ClipboardSnapshot {
    mime_type: String,
    data: Vec<u8>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Backend {
    WlClipboard,
    Xclip,
}

impl Backend {
    fn current() -> Option<Self> {
        let session = session::current();
        if session.is_x11() {
            Some(Self::Xclip)
        } else if session.is_wayland() {
            Some(Self::WlClipboard)
        } else {
            None
        }
    }

    /// Whether a snapshot can be taken without side effects. Outside KDE,
    /// `wl-paste` may need a focused window of its own to read the clipboard,
    /// which would take the focus from the target.
    fn can_snapshot(self) -> bool {
        match self {
            Self::Xclip => true,
            Self::WlClipboard => session::current().is_kde_wayland(),
        }
    }

    fn read_command(self, mime_type: &str) -> (&'static str, Vec<&str>) {
        match self {
            Self::WlClipboard => ("wl-paste", vec!["--no-newline", "--type", mime_type]),
            Self::Xclip => (
                "xclip",
                vec!["-selection", "clipboard", "-o", "-t", mime_type],
            ),
        }
    }

    fn types_command(self) -> (&'static str, Vec<&'static str>) {
        match self {
            Self::WlClipboard => ("wl-paste", vec!["--list-types"]),
            Self::Xclip => (
                "xclip",
                vec!["-selection", "clipboard", "-o", "-t", "TARGETS"],
            ),
        }
    }

    fn write_command(self, mime_type: &str) -> (&'static str, Vec<&str>) {
        match self {
            Self::WlClipboard => ("wl-copy", vec!["--type", mime_type]),
            Self::Xclip => (
                "xclip",
                vec!["-selection", "clipboard", "-t", mime_type, "-i"],
            ),
        }
    }

    fn read(self, mime_type: &str) -> Option<Vec<u8>> {
        let (binary, args) = self.read_command(mime_type);
        command_output(binary, &args)
    }
}

pub fn snapshot() -> Option<ClipboardSnapshot> {
    let backend = Backend::current().filter(|backend| backend.can_snapshot())?;
    let (binary, args) = backend.types_command();
    let types = String::from_utf8(command_output(binary, &args)?).ok()?;
    let mime_type = preferred_type(types.lines())?;
    let data = backend.read(&mime_type)?;
    Some(ClipboardSnapshot { mime_type, data })
}

/// Puts `snapshot` back unless the clipboard got something other than
/// `inserted` meanwhile, e.g. the user copied text.
pub fn restore_later(snapshot: ClipboardSnapshot, inserted: String) {
    thread::spawn(move || {
        thread::sleep(RESTORE_DELAY);
        if read_text().as_deref() != Some(inserted.as_str()) {
            return;
        }
        if let Err(error) = write(&snapshot) {
            log::warn!("Could not restore the clipboard: {error}");
        }
    });
}

/// The plain text in the clipboard, if it holds any.
pub fn read_text() -> Option<String> {
    let output = match Backend::current()? {
        Backend::Xclip => command_output("xclip", &["-selection", "clipboard", "-o"])?,
        backend => backend.read("text/plain")?,
    };
    String::from_utf8(output).ok()
}

/// Empties the clipboard; used when there is no snapshot to put back.
pub fn clear() {
    let result = match Backend::current() {
        Some(Backend::WlClipboard) => Command::new("wl-copy")
            .arg("--clear")
            .status()
            .map(drop)
            .map_err(Into::into),
        _ => crate::services::clipboard::copy_to_clipboard(""),
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

    let backend =
        Backend::current().ok_or_else(|| std::io::Error::other("No clipboard in this session"))?;
    let (binary, args) = backend.write_command(&snapshot.mime_type);
    // xclip stays in the background to serve the clipboard, so it must not
    // hold on to the output of this process
    let mut child = Command::new(binary)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(&snapshot.data)?;
    }
    let status = child.wait()?;
    if status.success() {
        Ok(())
    } else {
        Err(std::io::Error::other(format!(
            "{binary} failed with {status}"
        )))
    }
}

/// `wl-paste` and `xclip` block while the clipboard owner does not answer,
/// so they get a timeout.
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
    fn reads_x11_targets() {
        let targets = ["TIMESTAMP", "TARGETS", "UTF8_STRING", "TEXT", "STRING"];
        assert_eq!(
            preferred_type(targets.into_iter()).as_deref(),
            Some("UTF8_STRING")
        );
    }

    #[test]
    fn writes_with_the_tool_of_the_session() {
        assert_eq!(
            Backend::Xclip.write_command("image/png"),
            (
                "xclip",
                vec!["-selection", "clipboard", "-t", "image/png", "-i"]
            )
        );
        assert_eq!(
            Backend::WlClipboard.write_command("text/plain"),
            ("wl-copy", vec!["--type", "text/plain"])
        );
    }

    #[test]
    fn skips_content_it_cannot_restore() {
        assert_eq!(preferred_type(["text/uri-list"].into_iter()), None);
        assert_eq!(preferred_type(std::iter::empty()), None);
    }
}
