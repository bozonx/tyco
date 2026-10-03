use std::path::PathBuf;
use std::process::{Child, Command, ExitStatus};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::errors::AppError;
use crate::services::platform::session::{self, DisplayServer};
use crate::services::platform::window_tracker::tracker;

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

    /// The copy combination of the same family: a terminal that pastes with
    /// Ctrl+Shift+V copies with Ctrl+Shift+C.
    fn copy_xdotool_keys(self) -> &'static str {
        match self {
            Self::CtrlV => "ctrl+c",
            Self::CtrlShiftV => "ctrl+shift+c",
            Self::ShiftInsert => "ctrl+Insert",
        }
    }

    /// Linux input event codes: presses in order, releases in reverse.
    fn ydotool_keys(self) -> Vec<String> {
        let keys: &[u16] = match self {
            Self::CtrlV => &[KEY_LEFT_CTRL, KEY_V],
            Self::CtrlShiftV => &[KEY_LEFT_CTRL, KEY_LEFT_SHIFT, KEY_V],
            Self::ShiftInsert => &[KEY_LEFT_SHIFT, KEY_INSERT],
        };
        press_and_release(keys)
    }

    fn copy_ydotool_keys(self) -> Vec<String> {
        let keys: &[u16] = match self {
            Self::CtrlV => &[KEY_LEFT_CTRL, KEY_C],
            Self::CtrlShiftV => &[KEY_LEFT_CTRL, KEY_LEFT_SHIFT, KEY_C],
            Self::ShiftInsert => &[KEY_LEFT_CTRL, KEY_INSERT],
        };
        press_and_release(keys)
    }
}

// Linux input event codes
const KEY_LEFT_CTRL: u16 = 29;
const KEY_LEFT_SHIFT: u16 = 42;
const KEY_LEFT_ALT: u16 = 56;
const KEY_RIGHT_SHIFT: u16 = 54;
const KEY_RIGHT_CTRL: u16 = 97;
const KEY_RIGHT_ALT: u16 = 100;
const KEY_LEFT_META: u16 = 125;
const KEY_RIGHT_META: u16 = 126;
const KEY_A: u16 = 30;
const KEY_C: u16 = 46;
const KEY_V: u16 = 47;
const KEY_INSERT: u16 = 110;
const MODIFIER_KEYS: [u16; 8] = [
    KEY_LEFT_CTRL,
    KEY_RIGHT_CTRL,
    KEY_LEFT_ALT,
    KEY_RIGHT_ALT,
    KEY_LEFT_SHIFT,
    KEY_RIGHT_SHIFT,
    KEY_LEFT_META,
    KEY_RIGHT_META,
];

/// Presses in order, releases in reverse.
fn press_and_release(keys: &[u16]) -> Vec<String> {
    let presses = keys.iter().map(|key| format!("{key}:1"));
    let releases = keys.iter().rev().map(|key| format!("{key}:0"));
    presses.chain(releases).collect()
}

/// A key combination pressed in the window that has the keyboard focus.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FocusedKeys {
    Copy,
    Paste,
    SelectAll,
}

impl FocusedKeys {
    fn xdotool_keys(self, shortcut: PasteShortcut) -> &'static str {
        match self {
            Self::Copy => shortcut.copy_xdotool_keys(),
            Self::Paste => shortcut.xdotool_keys(),
            Self::SelectAll => "ctrl+a",
        }
    }

    /// The modifiers of the hotkey that started the action may still be held,
    /// and would turn Ctrl+C into Ctrl+Alt+C. The compositor keeps a single
    /// keyboard state for all devices, so releasing them from the virtual
    /// keyboard clears them, like `xdotool --clearmodifiers` does on X11.
    fn ydotool_keys(self, shortcut: PasteShortcut) -> Vec<String> {
        let combo = match self {
            Self::Copy => shortcut.copy_ydotool_keys(),
            Self::Paste => shortcut.ydotool_keys(),
            Self::SelectAll => press_and_release(&[KEY_LEFT_CTRL, KEY_A]),
        };
        MODIFIER_KEYS
            .iter()
            .map(|key| format!("{key}:0"))
            .chain(combo)
            .collect()
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
        let session = match session::current().display {
            DisplayServer::X11 => Session::X11,
            DisplayServer::Wayland => Session::Wayland,
            DisplayServer::Native | DisplayServer::Unknown => Session::Unsupported,
        };
        Self { session }
    }

    pub fn inject_paste(
        &self,
        user_config: &Value,
        source_window_id: Option<&str>,
    ) -> Result<(), AppError> {
        let insertion = user_config.get("windowInsertion");
        let method = select_method(self.session, configured_method(insertion))?;
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
            super::kwin::activate_window(window_id)?;
            thread::sleep(WAYLAND_FOCUS_SETTLE_DELAY);
        }
        run_spec(&command)
    }

    /// Presses `keys` in whatever window has the keyboard focus, without
    /// activating any window first. A terminal gets the Ctrl+Shift family,
    /// where Ctrl+C would interrupt the running program.
    pub fn press_in_focused(
        &self,
        user_config: &Value,
        keys: FocusedKeys,
        terminal: bool,
    ) -> Result<(), AppError> {
        let insertion = user_config.get("windowInsertion");
        let method = select_method(self.session, configured_method(insertion))?;
        let mut shortcut = PasteShortcut::from_config(insertion);
        if terminal && shortcut == PasteShortcut::CtrlV {
            shortcut = PasteShortcut::CtrlShiftV;
        }
        let command = match method {
            InjectionMethod::Ydotool => CommandSpec {
                binary: configured_binary(insertion, "ydotoolBin", "/usr/bin/ydotool"),
                args: std::iter::once(String::from("key"))
                    .chain(keys.ydotool_keys(shortcut))
                    .collect(),
                env: vec![(String::from("YDOTOOL_SOCKET"), ydotool_socket()?)],
            },
            InjectionMethod::Xdotool => CommandSpec {
                binary: xdotool_binary(insertion, user_config),
                args: ["key", "--clearmodifiers", keys.xdotool_keys(shortcut)]
                    .into_iter()
                    .map(String::from)
                    .collect(),
                env: Vec::new(),
            },
        };
        run_spec(&command)
    }

    /// Checks everything text insertion needs, so that settings can tell what
    /// is missing before the first attempt fails.
    pub fn check(&self, user_config: &Value) -> Result<(), AppError> {
        let insertion = user_config.get("windowInsertion");
        let method = select_method(self.session, configured_method(insertion))?;
        match method {
            InjectionMethod::Ydotool => {
                let binary = configured_binary(insertion, "ydotoolBin", "/usr/bin/ydotool");
                ensure_binary(&binary, "ydotool")?;
                ydotool_socket()?;
            }
            InjectionMethod::Xdotool => {
                ensure_binary(&xdotool_binary(insertion, user_config), "xdotool")?;
            }
        }
        if self.session == Session::Wayland && !tracker().is_running() {
            return Err(AppError::Message(String::from(
                "Text insertion on Wayland needs KDE Plasma 6: the KWin window tracker is not running",
            )));
        }
        Ok(())
    }
}

fn configured_method(insertion: Option<&Value>) -> &str {
    insertion
        .and_then(|value| value.get("method"))
        .and_then(Value::as_str)
        .unwrap_or("xdotool")
}

fn xdotool_binary(insertion: Option<&Value>, user_config: &Value) -> String {
    insertion
        .and_then(|value| value.get("xdotoolBin"))
        .and_then(Value::as_str)
        .or_else(|| user_config.get("xdotoolBin").and_then(Value::as_str))
        .unwrap_or("/usr/bin/xdotool")
        .to_owned()
}

fn ensure_binary(binary: &str, name: &str) -> Result<(), AppError> {
    if PathBuf::from(binary).is_file() {
        Ok(())
    } else {
        Err(AppError::Message(format!(
            "{name} is not installed: {binary} does not exist"
        )))
    }
}

fn missing_wayland_target() -> AppError {
    let message = if tracker().is_running() {
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
            Ok(CommandSpec {
                binary: xdotool_binary(insertion, user_config),
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
    fn focused_keys_release_held_modifiers_first() {
        let keys = FocusedKeys::Copy.ydotool_keys(PasteShortcut::CtrlV);
        assert_eq!(keys.len(), MODIFIER_KEYS.len() + 4);
        assert!(keys[..MODIFIER_KEYS.len()]
            .iter()
            .all(|key| key.ends_with(":0")));
        assert_eq!(
            keys[MODIFIER_KEYS.len()..],
            ["29:1", "46:1", "46:0", "29:0"]
        );
        assert_eq!(
            FocusedKeys::SelectAll.ydotool_keys(PasteShortcut::ShiftInsert)[MODIFIER_KEYS.len()..],
            ["29:1", "30:1", "30:0", "29:0"]
        );
    }

    #[test]
    fn copy_follows_the_paste_shortcut_family() {
        assert_eq!(
            FocusedKeys::Copy.xdotool_keys(PasteShortcut::CtrlShiftV),
            "ctrl+shift+c"
        );
        assert_eq!(
            FocusedKeys::Copy.xdotool_keys(PasteShortcut::ShiftInsert),
            "ctrl+Insert"
        );
        assert_eq!(
            PasteShortcut::CtrlShiftV.copy_ydotool_keys(),
            ["29:1", "42:1", "46:1", "46:0", "42:0", "29:0"]
        );
    }

    #[test]
    fn unsupported_sessions_fail_with_a_clear_error() {
        let error = select_method(Session::Unsupported, "xdotool").unwrap_err();
        assert!(error.to_string().contains("X11 or Wayland"));
    }
}
