//! Inserting text goes through the clipboard. The previous clipboard content
//! is put back once the target window has pasted: with `wl-clipboard` on
//! Wayland and `xclip` on X11 (`xsel` reads and writes text only).

use std::thread;
use std::time::Duration;

use crate::services::platform::session;

const COMMAND_TIMEOUT: Duration = Duration::from_millis(500);
/// The target reads the clipboard when it handles the paste keys; restoring
/// earlier would make it paste the old content. Nothing tells when it has
/// read it, so the delay leaves room for slow targets: a remote desktop, a
/// busy Electron app. Pasting the result twice is harmless; pasting the old
/// content, which may be a password, is not.
const RESTORE_DELAY: Duration = Duration::from_millis(2500);
const TEXT_TYPES: [&str; 3] = ["text/plain;charset=utf-8", "text/plain", "UTF8_STRING"];

/// One representation of the clipboard content. The tools offer a single
/// type, so rich content comes back as its plain text, HTML or image only.
#[derive(Debug, PartialEq, Eq)]
pub struct ClipboardSnapshot {
    mime_type: String,
    data: Vec<u8>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Backend {
    WlClipboard,
    Xclip,
}

impl Backend {
    pub(crate) fn current() -> Option<Self> {
        let session = session::current();
        if session.is_x11() {
            Some(Self::Xclip)
        } else if session.is_wayland() {
            Some(Self::WlClipboard)
        } else {
            None
        }
    }

    /// Whether a snapshot can be taken without side effects. Without the
    /// data control protocol, `wl-paste` needs a focused window of its own to
    /// read the clipboard, which would take the focus from the target. KWin
    /// and the wlroots compositors offer the protocol; GNOME does not.
    fn can_snapshot(self) -> bool {
        match self {
            Self::Xclip => true,
            Self::WlClipboard => has_data_control(session::current().desktop),
        }
    }

    /// The tools this backend runs, for the settings to tell a missing one.
    pub(crate) fn tools(self) -> &'static [&'static str] {
        match self {
            Self::WlClipboard => &["wl-copy", "wl-paste"],
            Self::Xclip => &["xclip"],
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
        Backend::Xclip => command_output("xclip", &["-selection", "clipboard", "-o"])
            .or_else(|| command_output("xsel", &["--clipboard", "--output"]))?,
        backend => backend.read("text/plain")?,
    };
    String::from_utf8(output).ok()
}

/// The primary selection: what was selected last, in any window. Terminals
/// put their selection there as soon as it is made.
pub fn read_primary() -> Option<String> {
    let output = match Backend::current()? {
        Backend::Xclip => command_output("xclip", &["-selection", "primary", "-o"])
            .or_else(|| command_output("xsel", &["--primary", "--output"]))?,
        Backend::WlClipboard => command_output("wl-paste", &["--primary", "--no-newline"])?,
    };
    String::from_utf8(output).ok()
}

/// Empties the clipboard; used when there is no snapshot to put back.
pub fn clear() {
    let run = |binary: &str, args: &[&str]| {
        super::super::process::status(
            super::super::process::command(binary, args),
            None,
            super::super::clipboard::CLIPBOARD_WRITE_TIMEOUT,
        )
        .map_err(crate::errors::AppError::from)
        .and_then(|status| {
            status.success().then_some(()).ok_or_else(|| {
                crate::errors::AppError::Failed(format!("{binary} failed with {status}"))
            })
        })
    };
    let result = match Backend::current() {
        Some(Backend::WlClipboard) => run("wl-copy", &["--clear"]),
        // xclip cannot drop the selection; an empty text is the closest
        Some(Backend::Xclip) => run("xsel", &["--clipboard", "--clear"])
            .or_else(|_| super::super::clipboard::copy_to_clipboard("")),
        None => super::super::clipboard::copy_to_clipboard(""),
    };
    if let Err(error) = result {
        log::warn!("Could not clear the clipboard: {error}");
    }
}

/// Puts `snapshot` back again when the clipboard changes soon after it was
/// restored: an application that copied too late for a capture would
/// otherwise leave its copy there in place of the user's content.
pub fn guard_restored(snapshot: ClipboardSnapshot) {
    thread::spawn(move || {
        let restored = read_text();
        let deadline = std::time::Instant::now() + LATE_COPY_WINDOW;
        while std::time::Instant::now() < deadline {
            thread::sleep(LATE_COPY_POLL_INTERVAL);
            let current = read_text();
            if current.is_some() && current != restored {
                log::debug!("A late copy replaced the restored clipboard; restoring it again");
                restore_now(&snapshot);
                return;
            }
        }
    });
}

/// How long after a capture gave up a late copy is still expected.
const LATE_COPY_WINDOW: Duration = Duration::from_millis(1500);
const LATE_COPY_POLL_INTERVAL: Duration = Duration::from_millis(100);

/// Whether the compositor lets clipboard tools work without a window.
fn has_data_control(desktop: session::Desktop) -> bool {
    matches!(
        desktop,
        session::Desktop::Kde | session::Desktop::Sway | session::Desktop::Hyprland
    )
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
        .or_else(|| {
            types
                .iter()
                .find(|mime_type| **mime_type == "text/html")
                .copied()
        })
        .map(str::to_owned)
}

fn write(snapshot: &ClipboardSnapshot) -> std::io::Result<()> {
    let backend =
        Backend::current().ok_or_else(|| std::io::Error::other("No clipboard in this session"))?;
    let (binary, args) = backend.write_command(&snapshot.mime_type);
    let status = super::super::process::status(
        super::super::process::command(binary, &args),
        Some(&snapshot.data),
        super::super::clipboard::CLIPBOARD_WRITE_TIMEOUT,
    )?;
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
    super::command::output_with_timeout(binary, args, COMMAND_TIMEOUT)
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
    fn preserves_html_when_no_text_or_image_is_offered() {
        assert_eq!(
            preferred_type(["text/html"].into_iter()).as_deref(),
            Some("text/html")
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
    fn snapshots_only_where_tools_need_no_window() {
        assert!(has_data_control(session::Desktop::Kde));
        assert!(has_data_control(session::Desktop::Hyprland));
        assert!(!has_data_control(session::Desktop::Gnome));
        assert!(!has_data_control(session::Desktop::Other));
    }

    #[test]
    fn skips_content_it_cannot_restore() {
        assert_eq!(preferred_type(["text/uri-list"].into_iter()), None);
        assert_eq!(preferred_type(std::iter::empty()), None);
    }
}
