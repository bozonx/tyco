use std::time::Duration;

use super::primary_selection;
use crate::services::platform::session::{self, DisplayServer};
use crate::services::platform::window_tracker::tracker;

const COMMAND_TIMEOUT: Duration = Duration::from_secs(2);

#[allow(async_fn_in_trait)]
pub trait ForegroundContext {
    type Source: Send + 'static;

    fn capture_source(&self) -> Option<Self::Source>;
    async fn capture_selection(&self, source: Option<Self::Source>) -> Option<String>;
}

#[derive(Clone, Copy, Debug)]
pub struct SystemForegroundContext {
    display: DisplayServer,
}

impl SystemForegroundContext {
    pub fn detect() -> Self {
        Self {
            display: session::current().display,
        }
    }

    /// A selection owner that does not answer would hold the capture, and
    /// with it the activation, for good.
    fn command_output(program: &str, args: &[&str]) -> Option<String> {
        let output = super::command::output_with_timeout(program, args, COMMAND_TIMEOUT)?;
        let value = String::from_utf8(output).ok()?;
        let value = value.trim_end_matches(['\r', '\n']);
        (!value.is_empty()).then(|| value.to_owned())
    }
}

impl ForegroundContext for SystemForegroundContext {
    type Source = String;

    /// The tracker knows the window focused before a Tyco one; without it
    /// X11 can still tell the focused window.
    fn capture_source(&self) -> Option<Self::Source> {
        if tracker().is_running() {
            return tracker().target();
        }
        match self.display {
            DisplayServer::X11 => Self::command_output("xdotool", &["getactivewindow"]),
            _ => None,
        }
    }

    /// The primary selection, which holds what was selected last in any
    /// window. On Wayland, only when it was made in `source`, as far as that
    /// is known, see `primary_selection`. Never the clipboard: a copied text
    /// is not a selection.
    async fn capture_selection(&self, source: Option<Self::Source>) -> Option<String> {
        match self.display {
            DisplayServer::X11 => Self::command_output("xclip", &["-selection", "primary", "-o"]),
            DisplayServer::Wayland => {
                if primary_selection::made_in(source.as_deref()) == Some(false) {
                    return None;
                }
                Self::command_output("wl-paste", &["--primary", "--no-newline"])
            }
            DisplayServer::Native | DisplayServer::Unknown => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unsupported_session_has_no_source() {
        let context = SystemForegroundContext {
            display: DisplayServer::Unknown,
        };
        assert_eq!(context.capture_source(), None);
    }
}
