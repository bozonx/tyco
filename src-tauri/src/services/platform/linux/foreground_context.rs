use std::process::{Command, Stdio};

use super::primary_selection;
use crate::services::platform::session::{self, DisplayServer};
use crate::services::platform::window_tracker::tracker;

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

    fn command_output(program: &str, args: &[&str]) -> Option<String> {
        let output = Command::new(program)
            .args(args)
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let value = String::from_utf8(output.stdout).ok()?;
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
    /// window; on Wayland only when it was made in `source`, see
    /// `primary_selection`.
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
