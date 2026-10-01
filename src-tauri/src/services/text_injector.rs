use std::path::PathBuf;
use std::process::{Child, Command, ExitStatus};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::errors::AppError;

const COMMAND_TIMEOUT: Duration = Duration::from_secs(2);
const PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(10);
/// KWin reports the activation before the client gets keyboard focus, so the
/// paste waits a moment longer.
const WAYLAND_FOCUS_SETTLE_DELAY: Duration = Duration::from_millis(80);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Session {
    X11,
    Wayland,
    Unsupported,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum InjectionMethod {
    Xdotool,
    Ydotool,
}

/// The key combination that makes the target window paste. Ctrl+V is bound
/// to a key position, so it breaks on layouts like Dvorak and in terminals.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PasteShortcut {
    CtrlV,
    CtrlShiftV,
    ShiftInsert,
}

impl PasteShortcut {
    fn from_config(insertion: Option<&Value>) -> Self {
        match insertion
            .and_then(|value| value.get("pasteShortcut"))
            .and_then(Value::as_str)
        {
            Some("ctrl+shift+v") => Self::CtrlShiftV,
            Some("shift+insert") => Self::ShiftInsert,
            _ => Self::CtrlV,
        }
    }

    fn xdotool_keys(self) -> &'static str {
        match self {
            Self::CtrlV => "ctrl+v",
            Self::CtrlShiftV => "ctrl+shift+v",
            Self::ShiftInsert => "shift+Insert",
        }
    }

    /// Linux input event codes: presses in order, releases in reverse.
    fn ydotool_keys(self) -> Vec<String> {
        const LEFT_CTRL: u16 = 29;
        const LEFT_SHIFT: u16 = 42;
        const V: u16 = 47;
        const INSERT: u16 = 110;
        let keys: &[u16] = match self {
            Self::CtrlV => &[LEFT_CTRL, V],
            Self::CtrlShiftV => &[LEFT_CTRL, LEFT_SHIFT, V],
            Self::ShiftInsert => &[LEFT_SHIFT, INSERT],
        };
        let presses = keys.iter().map(|key| format!("{key}:1"));
        let releases = keys.iter().rev().map(|key| format!("{key}:0"));
        presses.chain(releases).collect()
    }
}

#[derive(Debug, PartialEq, Eq)]
struct CommandSpec {
    binary: String,
    args: Vec<String>,
    env: Vec<(String, PathBuf)>,
}

pub struct SystemTextInjector {
    session: Session,
}

impl SystemTextInjector {
    pub fn detect() -> Self {
        let session = match std::env::var("XDG_SESSION_TYPE")
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str()
        {
            "x11" => Session::X11,
            "wayland" => Session::Wayland,
            _ if std::env::var_os("WAYLAND_DISPLAY").is_some() => Session::Wayland,
            _ if std::env::var_os("DISPLAY").is_some() => Session::X11,
            _ => Session::Unsupported,
        };
        Self { session }
    }

    pub fn inject_paste(
        &self,
        user_config: &Value,
        source_window_id: Option<&str>,
    ) -> Result<(), AppError> {
        let insertion = user_config.get("windowInsertion");
        let configured_method = insertion
            .and_then(|value| value.get("method"))
            .and_then(Value::as_str)
            .unwrap_or("xdotool");
        let method = select_method(self.session, configured_method)?;
        let shortcut = PasteShortcut::from_config(insertion);
        let mut command = command_spec(method, insertion, user_config, source_window_id, shortcut)?;

        if method == InjectionMethod::Ydotool {
            // the client knows a single default path, which differs between
            // ydotool versions, so it gets the socket that actually answers
            command
                .env
                .push((String::from("YDOTOOL_SOCKET"), ydotool_socket()?));
        }
        if self.session == Session::Wayland {
            // Wayland has no generic way to activate a foreign window; only
            // KWin windows reported by the tracker script can be targeted
            let window_id = source_window_id.ok_or_else(missing_wayland_target)?;
            super::kwin_windows::activate_window(window_id)?;
            thread::sleep(WAYLAND_FOCUS_SETTLE_DELAY);
        }
        run_spec(&command)
    }
}

fn missing_wayland_target() -> AppError {
    let message = if super::kwin_windows::tracker().is_running() {
        "No target window: Tyco was opened while no application window had focus"
    } else {
        "Text insertion on Wayland needs KDE Plasma 6: the KWin window tracker is not running"
    };
    AppError::Message(String::from(message))
}

fn select_method(session: Session, configured: &str) -> Result<InjectionMethod, AppError> {
    match (session, configured) {
        (Session::Wayland, _) | (_, "ydotool") => Ok(InjectionMethod::Ydotool),
        (Session::X11, _) => Ok(InjectionMethod::Xdotool),
        (Session::Unsupported, _) => Err(AppError::Message(String::from(
            "Text insertion is unavailable outside an X11 or Wayland session",
        ))),
    }
}

fn command_spec(
    method: InjectionMethod,
    insertion: Option<&Value>,
    user_config: &Value,
    source_window_id: Option<&str>,
    shortcut: PasteShortcut,
) -> Result<CommandSpec, AppError> {
    match method {
        InjectionMethod::Ydotool => Ok(CommandSpec {
            binary: configured_binary(insertion, "ydotoolBin", "/usr/bin/ydotool"),
            args: std::iter::once(String::from("key"))
                .chain(shortcut.ydotool_keys())
                .collect(),
            env: Vec::new(),
        }),
        InjectionMethod::Xdotool => {
            let window_id = source_window_id.ok_or_else(|| {
                AppError::Message(String::from(
                    "Target window is not available for text insertion",
                ))
            })?;
            let binary = insertion
                .and_then(|value| value.get("xdotoolBin"))
                .and_then(Value::as_str)
                .or_else(|| user_config.get("xdotoolBin").and_then(Value::as_str))
                .unwrap_or("/usr/bin/xdotool")
                .to_owned();
            Ok(CommandSpec {
                binary,
                args: [
                    "windowactivate",
                    "--sync",
                    window_id,
                    "key",
                    "--clearmodifiers",
                    shortcut.xdotool_keys(),
                ]
                .into_iter()
                .map(String::from)
                .collect(),
                env: Vec::new(),
            })
        }
    }
}

fn configured_binary(insertion: Option<&Value>, key: &str, fallback: &str) -> String {
    insertion
        .and_then(|value| value.get(key))
        .and_then(Value::as_str)
        .unwrap_or(fallback)
        .to_owned()
}

fn ydotool_socket_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(path) = std::env::var_os("YDOTOOL_SOCKET") {
        paths.push(PathBuf::from(path));
    }
    if let Some(directory) = std::env::var_os("XDG_RUNTIME_DIR") {
        paths.push(PathBuf::from(directory).join(".ydotool_socket"));
    }
    paths.push(PathBuf::from("/tmp/.ydotool_socket"));
    paths
}

/// The ydotool 1.x client only talks to the ydotoold socket; access to
/// `/dev/uinput` alone is not enough. The socket is a datagram one.
fn ydotool_socket() -> Result<PathBuf, AppError> {
    if let Some(path) = ydotool_socket_paths().into_iter().find(|path| {
        std::os::unix::net::UnixDatagram::unbound()
            .and_then(|socket| socket.connect(path))
            .is_ok()
    }) {
        return Ok(path);
    }
    Err(AppError::Message(String::from(
        "ydotool cannot insert text: ydotoold is not running. Start it, for example with `systemctl --user enable --now ydotool`, and make sure it can access /dev/uinput",
    )))
}

fn run_spec(spec: &CommandSpec) -> Result<(), AppError> {
    let child = Command::new(&spec.binary)
        .args(&spec.args)
        .envs(spec.env.iter().map(|(key, value)| (key, value)))
        .spawn()?;
    let status = wait_with_timeout(child, &spec.binary, COMMAND_TIMEOUT)?;
    if status.success() {
        Ok(())
    } else {
        Err(AppError::Message(format!(
            "Command `{}` failed with status {status}",
            spec.binary
        )))
    }
}

fn wait_with_timeout(
    mut child: Child,
    binary: &str,
    timeout: Duration,
) -> Result<ExitStatus, AppError> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok(status);
        }
        if Instant::now() >= deadline {
            child.kill()?;
            let _ = child.wait();
            return Err(AppError::Message(format!(
                "Timed out waiting for `{binary}` to insert the text"
            )));
        }
        thread::sleep(PROCESS_POLL_INTERVAL);
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn wayland_always_uses_ydotool() {
        assert_eq!(
            select_method(Session::Wayland, "xdotool").unwrap(),
            InjectionMethod::Ydotool
        );
    }

    #[test]
    fn x11_uses_the_configured_method() {
        assert_eq!(
            select_method(Session::X11, "xdotool").unwrap(),
            InjectionMethod::Xdotool
        );
        assert_eq!(
            select_method(Session::X11, "ydotool").unwrap(),
            InjectionMethod::Ydotool
        );
    }

    #[test]
    fn xdotool_waits_for_focus_before_pasting() {
        let config = json!({
            "xdotoolBin": "/legacy/xdotool",
            "windowInsertion": { "xdotoolBin": "/custom/xdotool" }
        });
        let spec = command_spec(
            InjectionMethod::Xdotool,
            config.get("windowInsertion"),
            &config,
            Some("42"),
            PasteShortcut::CtrlV,
        )
        .unwrap();
        assert_eq!(spec.binary, "/custom/xdotool");
        assert_eq!(
            spec.args,
            [
                "windowactivate",
                "--sync",
                "42",
                "key",
                "--clearmodifiers",
                "ctrl+v"
            ]
        );
    }

    #[test]
    fn ydotool_presses_and_releases_paste_keys() {
        let config = json!({ "ydotoolBin": "/custom/ydotool" });
        let spec = command_spec(
            InjectionMethod::Ydotool,
            Some(&config),
            &Value::Null,
            None,
            PasteShortcut::CtrlV,
        )
        .unwrap();
        assert_eq!(spec.binary, "/custom/ydotool");
        assert_eq!(spec.args, ["key", "29:1", "47:1", "47:0", "29:0"]);
    }

    #[test]
    fn paste_shortcut_comes_from_the_config() {
        let shortcut = |value: Value| PasteShortcut::from_config(Some(&value));
        assert_eq!(shortcut(json!({})), PasteShortcut::CtrlV);
        assert_eq!(
            shortcut(json!({ "pasteShortcut": "bogus" })),
            PasteShortcut::CtrlV
        );
        assert_eq!(
            shortcut(json!({ "pasteShortcut": "ctrl+shift+v" })),
            PasteShortcut::CtrlShiftV
        );
        assert_eq!(
            shortcut(json!({ "pasteShortcut": "shift+insert" })),
            PasteShortcut::ShiftInsert
        );
    }

    #[test]
    fn paste_shortcuts_release_keys_in_reverse_order() {
        assert_eq!(
            PasteShortcut::CtrlShiftV.ydotool_keys(),
            ["29:1", "42:1", "47:1", "47:0", "42:0", "29:0"]
        );
        assert_eq!(
            PasteShortcut::ShiftInsert.ydotool_keys(),
            ["42:1", "110:1", "110:0", "42:0"]
        );
        assert_eq!(PasteShortcut::ShiftInsert.xdotool_keys(), "shift+Insert");
    }

    #[test]
    fn unsupported_sessions_fail_with_a_clear_error() {
        let error = select_method(Session::Unsupported, "xdotool").unwrap_err();
        assert!(error.to_string().contains("X11 or Wayland"));
    }
}
