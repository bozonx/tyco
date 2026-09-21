use std::process::{Command, Stdio};

#[allow(async_fn_in_trait)]
pub trait ForegroundContext {
    type Source: Send + 'static;

    fn capture_source(&self) -> Option<Self::Source>;
    async fn capture_selection(&self, source: Option<Self::Source>) -> Option<String>;
}

#[derive(Clone, Copy, Debug)]
pub struct SystemForegroundContext {
    session: Session,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Session {
    X11,
    Wayland,
    Unsupported,
}

impl SystemForegroundContext {
    pub fn detect() -> Self {
        let session = match std::env::var("XDG_SESSION_TYPE")
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str()
        {
            "x11" => Session::X11,
            "wayland" => Session::Wayland,
            _ if std::env::var_os("DISPLAY").is_some() => Session::X11,
            _ => Session::Unsupported,
        };
        Self { session }
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

    fn capture_source(&self) -> Option<Self::Source> {
        (self.session == Session::X11)
            .then(|| Self::command_output("xdotool", &["getactivewindow"]))
            .flatten()
    }

    async fn capture_selection(&self, _source: Option<Self::Source>) -> Option<String> {
        match self.session {
            Session::X11 => Self::command_output("xclip", &["-selection", "primary", "-o"]),
            Session::Wayland => Self::command_output("wl-paste", &["--primary", "--no-newline"]),
            Session::Unsupported => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unsupported_session_has_no_source() {
        let context = SystemForegroundContext {
            session: Session::Unsupported,
        };
        assert_eq!(context.capture_source(), None);
    }
}
