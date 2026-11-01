//! The clipboard tools of the session: snapshots and restores of the
//! clipboard content with `wl-clipboard` on Wayland and `xclip` on X11
//! (`xsel` reads and writes text only). When a restore happens is up to
//! `platform::clipboard::session`.

use std::time::Duration;

use crate::services::platform::session;

const COMMAND_TIMEOUT: Duration = Duration::from_millis(500);
/// Copied files: file managers paste them from the URI list.
const FILE_LIST_TYPE: &str = "text/uri-list";
const TEXT_TYPES: [&str; 3] = ["text/plain;charset=utf-8", "text/plain", "UTF8_STRING"];

/// One representation of the clipboard content. The tools offer a single
/// type, so rich content comes back as its plain text, a file list, HTML or
/// an image only: keeping every type needs a clipboard owner in this process.
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

    /// Whether the clipboard can be read without side effects. Without the
    /// data control protocol, `wl-paste` needs a focused window of its own,
    /// which would take the focus from the target. KWin and the wlroots
    /// compositors offer the protocol; GNOME does not.
    fn can_read(self) -> bool {
        match self {
            Self::Xclip => true,
            Self::WlClipboard => super::data_control::is_available(),
        }
    }

    /// The backend of the session, when it can read the clipboard.
    fn readable() -> Option<Self> {
        Self::current().filter(|backend| backend.can_read())
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

    fn types(self) -> Option<Vec<String>> {
        let (binary, args) = self.types_command();
        let types = String::from_utf8(command_output(binary, &args)?).ok()?;
        Some(types.lines().map(|line| line.trim().to_owned()).collect())
    }
}

pub fn snapshot() -> Option<ClipboardSnapshot> {
    let backend = Backend::readable()?;
    let types = backend.types()?;
    let mime_type = preferred_type(types.iter().map(String::as_str))?;
    let data = backend.read(&mime_type)?;
    Some(ClipboardSnapshot { mime_type, data })
}

/// The types the clipboard content is offered as.
pub fn types() -> Vec<String> {
    Backend::readable()
        .and_then(Backend::types)
        .unwrap_or_default()
}

/// The clipboard content as `mime_type`, if it is offered so.
pub fn read_type(mime_type: &str) -> Option<Vec<u8>> {
    Backend::readable()?.read(mime_type)
}

/// The plain text in the clipboard, if it holds any.
pub fn read_text() -> Option<String> {
    read_text_within(COMMAND_TIMEOUT)
}

/// The plain text in the clipboard, waiting at most `timeout` for its owner
/// to answer.
pub fn read_text_within(timeout: Duration) -> Option<String> {
    let read =
        |binary: &str, args: &[&str]| super::command::output_with_timeout(binary, args, timeout);
    let output = match Backend::readable()? {
        Backend::Xclip => read("xclip", &["-selection", "clipboard", "-o"])
            .or_else(|| read("xsel", &["--clipboard", "--output"]))?,
        Backend::WlClipboard => read("wl-paste", &["--no-newline", "--type", "text/plain"])?,
    };
    String::from_utf8(output).ok()
}

/// The primary selection: what was selected last, in any window. Terminals
/// put their selection there as soon as it is made.
pub fn read_primary() -> Option<String> {
    let output = match Backend::readable()? {
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
        Some(Backend::WlClipboard) if !Backend::WlClipboard.can_read() => {
            log::debug!("The clipboard is not cleared: wl-copy would need a window of its own");
            Ok(())
        }
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

/// Puts `snapshot` back right away.
pub fn restore_now(snapshot: &ClipboardSnapshot) {
    if let Err(error) = write(snapshot) {
        log::warn!("Could not restore the clipboard: {error}");
    }
}

/// Copied files first: their paths as text would paste no files. A web page
/// copy with links also offers a URI list, along with its HTML.
fn preferred_type<'a>(types: impl Iterator<Item = &'a str>) -> Option<String> {
    let types: Vec<&str> = types.map(str::trim).collect();
    if types.contains(&FILE_LIST_TYPE) && !types.contains(&"text/html") {
        return Some(FILE_LIST_TYPE.to_owned());
    }
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
    fn keeps_copied_files_as_their_uri_list() {
        let types = [
            "text/plain",
            "text/uri-list",
            "x-special/gnome-copied-files",
        ];
        assert_eq!(
            preferred_type(types.into_iter()).as_deref(),
            Some("text/uri-list")
        );
        // links of a copied web page are no files
        let types = ["text/html", "text/plain", "text/uri-list"];
        assert_eq!(
            preferred_type(types.into_iter()).as_deref(),
            Some("text/plain")
        );
    }

    #[test]
    fn skips_content_it_cannot_restore() {
        assert_eq!(
            preferred_type(["application/x-qt-image-meta"].into_iter()),
            None
        );
        assert_eq!(preferred_type(std::iter::empty()), None);
    }
}
