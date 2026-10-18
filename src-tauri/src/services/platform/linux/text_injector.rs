use std::path::PathBuf;
use std::process::{Child, Command, ExitStatus};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::Value;

use super::binary_paths::default_binary_path;
use crate::errors::AppError;
use crate::services::platform::session::{self, DisplayServer};
use crate::services::platform::window_tracker::tracker;

const COMMAND_TIMEOUT: Duration = Duration::from_secs(2);
const PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(10);
/// KWin reports the activation before the client gets keyboard focus, so the
/// paste waits a moment longer.
const WAYLAND_FOCUS_SETTLE_DELAY: Duration = Duration::from_millis(80);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum InjectionSessionKind {
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
pub enum FocusedKeyAction {
    Copy,
    Paste,
}

impl FocusedKeyAction {
    fn xdotool_keys(self, shortcut: PasteShortcut) -> &'static str {
        match self {
            Self::Copy => shortcut.copy_xdotool_keys(),
            Self::Paste => shortcut.xdotool_keys(),
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
    session: InjectionSessionKind,
}

impl SystemTextInjector {
    pub fn detect() -> Self {
        let session = match session::current().display {
            DisplayServer::X11 => InjectionSessionKind::X11,
            DisplayServer::Wayland => InjectionSessionKind::Wayland,
            DisplayServer::Native | DisplayServer::Unknown => InjectionSessionKind::Unsupported,
        };
        Self { session }
    }

    pub fn inject_paste(
        &self,
        user_config: &Value,
        target_window_id: Option<&str>,
    ) -> Result<(), AppError> {
        let insertion = user_config.get("windowInsertion");
        let method = select_method(self.session, configured_method(insertion))?;
        let shortcut = PasteShortcut::from_config(insertion);
        let mut command = command_spec(method, insertion, target_window_id, shortcut)?;

        if method == InjectionMethod::Ydotool {
            // the client knows a single default path, which differs between
            // ydotool versions, so it gets the socket that actually answers
            command
                .env
                .push((String::from("YDOTOOL_SOCKET"), ydotool_socket()?));
        }
        if self.session == InjectionSessionKind::Wayland {
            // Wayland has no generic way to activate a foreign window; only
            // KWin windows reported by the tracker script can be targeted
            let window_id = target_window_id.ok_or_else(missing_wayland_target)?;
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
        action: FocusedKeyAction,
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
                binary: linux_binary(insertion, YDOTOOL),
                args: std::iter::once(String::from("key"))
                    .chain(action.ydotool_keys(shortcut))
                    .collect(),
                env: vec![(String::from("YDOTOOL_SOCKET"), ydotool_socket()?)],
            },
            InjectionMethod::Xdotool => CommandSpec {
                binary: linux_binary(insertion, XDOTOOL),
                args: ["key", "--clearmodifiers", action.xdotool_keys(shortcut)]
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
    pub fn check_text_injection(&self, user_config: &Value) -> Result<(), AppError> {
        let insertion = user_config.get("windowInsertion");
        let method = select_method(self.session, configured_method(insertion))?;
        match method {
            InjectionMethod::Ydotool => {
                let binary = linux_binary(insertion, YDOTOOL);
                ensure_binary(&binary, "ydotool")?;
                ydotool_socket()?;
            }
            InjectionMethod::Xdotool => {
                ensure_binary(&linux_binary(insertion, XDOTOOL), "xdotool")?;
            }
        }
        if self.session == InjectionSessionKind::Wayland && !tracker().is_running() {
            return Err(AppError::Message(String::from(
                "Text insertion on Wayland needs KDE Plasma 6: the KWin window tracker is not running",
            )));
        }
        Ok(())
    }
}

/// The Linux part of `windowInsertion`.
fn linux_settings(insertion: Option<&Value>) -> Option<&Value> {
    insertion.and_then(|value| value.get("linux"))
}

fn configured_method(insertion: Option<&Value>) -> &str {
    linux_settings(insertion)
        .and_then(|value| value.get("method"))
        .and_then(Value::as_str)
        .unwrap_or("xdotool")
}

/// A key injection tool and the setting with its path.
struct InjectionBinary {
    name: &'static str,
    path_key: &'static str,
}

const XDOTOOL: InjectionBinary = InjectionBinary {
    name: "xdotool",
    path_key: "xdotoolPath",
};
const YDOTOOL: InjectionBinary = InjectionBinary {
    name: "ydotool",
    path_key: "ydotoolPath",
};

/// The configured path of the tool; without one the tool found on `PATH`,
/// or where the distribution installs it.
fn linux_binary(insertion: Option<&Value>, binary: InjectionBinary) -> String {
    linux_settings(insertion)
        .and_then(|value| value.get(binary.path_key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(str::to_owned)
        .or_else(|| find_on_path(binary.name, std::env::var_os("PATH").as_deref()))
        .unwrap_or_else(|| default_binary_path(binary.name))
}

fn find_on_path(name: &str, path: Option<&std::ffi::OsStr>) -> Option<String> {
    std::env::split_paths(path?)
        .map(|directory| directory.join(name))
        .find(|candidate| candidate.is_file())
        .map(|candidate| candidate.to_string_lossy().into_owned())
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

fn select_method(
    session: InjectionSessionKind,
    configured: &str,
) -> Result<InjectionMethod, AppError> {
    match (session, configured) {
        (InjectionSessionKind::Wayland, _) | (_, "ydotool") => Ok(InjectionMethod::Ydotool),
        (InjectionSessionKind::X11, _) => Ok(InjectionMethod::Xdotool),
        (InjectionSessionKind::Unsupported, _) => Err(AppError::Message(String::from(
            "Text insertion is unavailable outside an X11 or Wayland session",
        ))),
    }
}

fn command_spec(
    method: InjectionMethod,
    insertion: Option<&Value>,
    target_window_id: Option<&str>,
    shortcut: PasteShortcut,
) -> Result<CommandSpec, AppError> {
    match method {
        InjectionMethod::Ydotool => Ok(CommandSpec {
            binary: linux_binary(insertion, YDOTOOL),
            args: std::iter::once(String::from("key"))
                .chain(shortcut.ydotool_keys())
                .collect(),
            env: Vec::new(),
        }),
        InjectionMethod::Xdotool => {
            let window_id = target_window_id.ok_or_else(|| {
                AppError::Message(String::from(
                    "Target window is not available for text insertion",
                ))
            })?;
            Ok(CommandSpec {
                binary: linux_binary(insertion, XDOTOOL),
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
            select_method(InjectionSessionKind::Wayland, "xdotool").unwrap(),
            InjectionMethod::Ydotool
        );
    }

    #[test]
    fn x11_uses_the_configured_method() {
        assert_eq!(
            select_method(InjectionSessionKind::X11, "xdotool").unwrap(),
            InjectionMethod::Xdotool
        );
        assert_eq!(
            select_method(InjectionSessionKind::X11, "ydotool").unwrap(),
            InjectionMethod::Ydotool
        );
    }

    #[test]
    fn xdotool_waits_for_focus_before_pasting() {
        let config = json!({
            "windowInsertion": { "linux": { "xdotoolPath": "/custom/xdotool" } }
        });
        let spec = command_spec(
            InjectionMethod::Xdotool,
            config.get("windowInsertion"),
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
        let config = json!({ "linux": { "ydotoolPath": " /custom/ydotool " } });
        let spec = command_spec(
            InjectionMethod::Ydotool,
            Some(&config),
            None,
            PasteShortcut::CtrlV,
        )
        .unwrap();
        assert_eq!(spec.binary, "/custom/ydotool");
        assert_eq!(spec.args, ["key", "29:1", "47:1", "47:0", "29:0"]);
    }

    #[test]
    fn an_unset_path_finds_the_tool_on_path() {
        let directory = std::env::temp_dir().join(format!("tyco-path-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join("xdotool"), "").unwrap();
        let path =
            std::env::join_paths([std::path::Path::new("/nonexistent"), &directory]).unwrap();
        assert_eq!(
            find_on_path("xdotool", Some(&path)),
            Some(directory.join("xdotool").to_string_lossy().into_owned())
        );
        assert_eq!(find_on_path("ydotool", Some(&path)), None);
        assert_eq!(find_on_path("xdotool", None), None);
        std::fs::remove_dir_all(&directory).unwrap();
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
        let keys = FocusedKeyAction::Copy.ydotool_keys(PasteShortcut::CtrlV);
        assert_eq!(keys.len(), MODIFIER_KEYS.len() + 4);
        assert!(keys[..MODIFIER_KEYS.len()]
            .iter()
            .all(|key| key.ends_with(":0")));
        assert_eq!(
            keys[MODIFIER_KEYS.len()..],
            ["29:1", "46:1", "46:0", "29:0"]
        );
    }

    #[test]
    fn copy_follows_the_paste_shortcut_family() {
        assert_eq!(
            FocusedKeyAction::Copy.xdotool_keys(PasteShortcut::CtrlShiftV),
            "ctrl+shift+c"
        );
        assert_eq!(
            FocusedKeyAction::Copy.xdotool_keys(PasteShortcut::ShiftInsert),
            "ctrl+Insert"
        );
        assert_eq!(
            PasteShortcut::CtrlShiftV.copy_ydotool_keys(),
            ["29:1", "42:1", "46:1", "46:0", "42:0", "29:0"]
        );
    }

    #[test]
    fn unsupported_sessions_fail_with_a_clear_error() {
        let error = select_method(InjectionSessionKind::Unsupported, "xdotool").unwrap_err();
        assert!(error.to_string().contains("X11 or Wayland"));
    }
}
