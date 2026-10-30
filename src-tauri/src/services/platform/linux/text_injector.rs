//! Pressing the paste and copy keys in other windows. Two senders can do it
//! on Linux, both in X11 and in Wayland sessions:
//!
//! - ydotool, whose daemon writes to `/dev/uinput`, below any display server;
//! - the RemoteDesktop portal, which needs no tools but asks the user once,
//!   and is the only one available inside a Flatpak.
//!
//! ydotool goes first when it is set up; otherwise the portal. The window to
//! paste into gets the focus back from the window tracker (KWin on Plasma,
//! x11rb on X11). Without a tracker the paste goes to the window the desktop
//! focuses once Tyco hides its own.

use std::path::PathBuf;
use std::process::{Child, Command, ExitStatus};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::Value;

use super::binary_paths::default_binary_path;
use super::remote_desktop::{self, KeyEvent, PortalState};
use crate::errors::AppError;
use crate::models::user_config::{self, LinuxInsertionConfig, PasteShortcut};
use crate::services::platform::session::{self, DisplayServer};
use crate::services::platform::text_injector::{
    KeySender, KeysState, TargetTracking, TextInsertionProblem, TextInsertionStatus,
};
use crate::services::platform::window_tracker::tracker;

const COMMAND_TIMEOUT: Duration = Duration::from_secs(2);
const PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(10);
/// KWin reports the activation before the client gets keyboard focus, so the
/// paste waits a moment longer.
const WAYLAND_FOCUS_SETTLE_DELAY: Duration = Duration::from_millis(80);
const YDOTOOL: &str = "ydotool";
/// How `ydotool key --help` of 1.x describes its arguments; 0.1.x takes key
/// names instead.
const YDOTOOL_KEYCODE_SYNTAX: &str = "<keycode>:<pressed>";

impl PasteShortcut {
    fn paste_keys(self) -> &'static [u16] {
        match self {
            Self::CtrlV => &[KEY_LEFT_CTRL, KEY_V],
            Self::CtrlShiftV => &[KEY_LEFT_CTRL, KEY_LEFT_SHIFT, KEY_V],
            Self::ShiftInsert => &[KEY_LEFT_SHIFT, KEY_INSERT],
        }
    }

    /// The copy combination of the same family: a terminal that pastes with
    /// Ctrl+Shift+V copies with Ctrl+Shift+C.
    fn copy_keys(self) -> &'static [u16] {
        match self {
            Self::CtrlV => &[KEY_LEFT_CTRL, KEY_C],
            Self::CtrlShiftV => &[KEY_LEFT_CTRL, KEY_LEFT_SHIFT, KEY_C],
            Self::ShiftInsert => &[KEY_LEFT_CTRL, KEY_INSERT],
        }
    }
}

fn focused_shortcut(
    linux: &LinuxInsertionConfig,
    action: FocusedKeyAction,
    terminal: bool,
) -> PasteShortcut {
    if terminal && action == FocusedKeyAction::Copy {
        PasteShortcut::CtrlShiftV
    } else {
        linux.paste_shortcut_for(terminal)
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

/// Presses `keys` in order and releases them in reverse. The modifiers of the
/// hotkey that started the action may still be held, and would turn Ctrl+C
/// into Ctrl+Alt+C. The compositor keeps a single keyboard state for all
/// devices, so releasing them from the virtual keyboard first clears them.
fn combo_events(keys: &[u16]) -> Vec<KeyEvent> {
    let releases = MODIFIER_KEYS.iter().map(|&key| (key, false));
    let presses = keys.iter().map(|&key| (key, true));
    let combo_releases = keys.iter().rev().map(|&key| (key, false));
    releases.chain(presses).chain(combo_releases).collect()
}

fn ydotool_args(events: &[KeyEvent]) -> Vec<String> {
    std::iter::once(String::from("key"))
        .chain(
            events
                .iter()
                .map(|&(key, pressed)| format!("{key}:{}", u8::from(pressed))),
        )
        .collect()
}

/// A key combination pressed in the window that has the keyboard focus.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FocusedKeyAction {
    Copy,
    Paste,
}

impl FocusedKeyAction {
    fn keys(self, shortcut: PasteShortcut) -> &'static [u16] {
        match self {
            Self::Copy => shortcut.copy_keys(),
            Self::Paste => shortcut.paste_keys(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum InjectionSessionKind {
    X11,
    Wayland,
    Unsupported,
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

    /// Gives `target_window_id` the focus back and pastes into it. Without a
    /// window tracker there is no id: the paste goes to the focused window.
    pub fn inject_paste(
        &self,
        user_config: &Value,
        target_window_id: Option<&str>,
    ) -> Result<(), AppError> {
        self.ensure_supported()?;
        let linux = user_config::linux_insertion(user_config);
        let terminal = match (self.session, target_window_id) {
            (_, None) => {
                if tracker().is_running() {
                    return Err(AppError::ServiceUnavailable(String::from(
                        "No target window: Tyco was opened while no application window had focus",
                    )));
                }
                log::debug!("No window tracker: pasting into the focused window");
                false
            }
            (InjectionSessionKind::X11, Some(window_id)) => {
                let terminal = super::x11::is_terminal_window(window_id);
                super::x11::activate_window(window_id)?;
                terminal
            }
            (_, Some(window_id)) => {
                super::kwin::activate_window(window_id)?;
                thread::sleep(WAYLAND_FOCUS_SETTLE_DELAY);
                tracker().active_window().is_some_and(|window| {
                    window.id == window_id
                        && crate::services::platform::selection::is_terminal_class(&window.class)
                })
            }
        };
        let shortcut = linux.paste_shortcut_for(terminal);
        send_keys(combo_events(shortcut.paste_keys()))
    }

    /// Presses the keys of `action` in whatever window has the keyboard
    /// focus, without activating any window first. A terminal gets the
    /// Ctrl+Shift family, where Ctrl+C would interrupt the running program.
    pub fn press_in_focused(
        &self,
        user_config: &Value,
        action: FocusedKeyAction,
        terminal: bool,
    ) -> Result<(), AppError> {
        self.ensure_supported()?;
        let linux = user_config::linux_insertion(user_config);
        let shortcut = focused_shortcut(&linux, action, terminal);
        send_keys(combo_events(action.keys(shortcut)))
    }

    fn ensure_supported(&self) -> Result<(), AppError> {
        if self.session == InjectionSessionKind::Unsupported {
            return Err(AppError::ServiceUnavailable(String::from(
                "Text insertion is unavailable outside an X11 or Wayland session",
            )));
        }
        Ok(())
    }
}

/// See `crate::services::platform::text_insertion_status`.
pub fn status() -> TextInsertionStatus {
    let target = if tracker().is_running() {
        TargetTracking::Tracked
    } else {
        TargetTracking::FocusReturn
    };
    let mut status = if SystemTextInjector::detect().ensure_supported().is_err() {
        keys_status(
            None,
            KeysState::Unavailable,
            Some(TextInsertionProblem::UnsupportedSession),
            None,
        )
    } else {
        let sandboxed = session::is_sandboxed();
        let ydotool = if sandboxed {
            Err(sandboxed_ydotool())
        } else {
            ydotool_ready(true).map(|_| ())
        };
        choose_sender(sandboxed, ydotool, remote_desktop::state)
    };
    status.target = target;
    status
}

fn keys_status(
    key_sender: Option<KeySender>,
    keys: KeysState,
    problem: Option<TextInsertionProblem>,
    detail: Option<String>,
) -> TextInsertionStatus {
    TextInsertionStatus {
        key_sender,
        keys,
        problem,
        detail,
        target: TargetTracking::Tracked,
    }
}

type YdotoolFailure = (TextInsertionProblem, String);

fn sandboxed_ydotool() -> YdotoolFailure {
    (
        TextInsertionProblem::PortalUnavailable,
        String::from("ydotool cannot reach /dev/uinput from a sandbox"),
    )
}

/// ydotool when it is set up, otherwise the portal. Inside a sandbox only
/// the portal can work. `portal` is asked only when ydotool cannot help.
fn choose_sender(
    sandboxed: bool,
    ydotool: Result<(), YdotoolFailure>,
    portal: impl FnOnce() -> PortalState,
) -> TextInsertionStatus {
    let failure = match ydotool {
        Ok(()) if !sandboxed => {
            return keys_status(Some(KeySender::Ydotool), KeysState::Ready, None, None)
        }
        Ok(()) => sandboxed_ydotool(),
        Err(failure) => failure,
    };
    match portal() {
        PortalState::Ready => keys_status(Some(KeySender::Portal), KeysState::Ready, None, None),
        PortalState::NeedsPermission => keys_status(
            Some(KeySender::Portal),
            KeysState::NeedsPermission,
            None,
            None,
        ),
        PortalState::Unavailable(reason) if sandboxed => keys_status(
            None,
            KeysState::Unavailable,
            Some(TextInsertionProblem::PortalUnavailable),
            Some(reason),
        ),
        PortalState::Unavailable(reason) => keys_status(
            None,
            KeysState::Unavailable,
            Some(failure.0),
            Some(format!(
                "{}; the RemoteDesktop portal is unavailable too: {reason}",
                failure.1
            )),
        ),
    }
}

/// Presses `events` with ydotool when it is set up, otherwise through the
/// portal, which may first ask the user.
fn send_keys(events: Vec<KeyEvent>) -> Result<(), AppError> {
    let ydotool = if session::is_sandboxed() {
        Err(sandboxed_ydotool())
    } else {
        ydotool_ready(false)
    };
    match ydotool {
        Ok((binary, socket)) => run_ydotool(&binary, &socket, &events),
        Err((_, ydotool_error)) => remote_desktop::press(events).map_err(|error| match error {
            AppError::PermissionDenied(message) => AppError::PermissionDenied(message),
            error => AppError::ServiceUnavailable(format!(
                "{ydotool_error}; the RemoteDesktop portal cannot press keys either: {error}"
            )),
        }),
    }
}

/// The ydotool binary and the socket of its daemon. `check_version` runs the
/// tool to tell a 0.1.x one, which would fail on every press.
fn ydotool_ready(check_version: bool) -> Result<(String, PathBuf), YdotoolFailure> {
    let binary = ydotool_binary();
    if !PathBuf::from(&binary).is_file() {
        return Err((
            TextInsertionProblem::YdotoolMissing,
            format!("ydotool is not installed: {binary} does not exist"),
        ));
    }
    if check_version && !is_ydotool_1x(&binary) {
        return Err((
            TextInsertionProblem::YdotoolOutdated,
            format!("{binary} is older than ydotool 1.0"),
        ));
    }
    let socket = ydotool_socket()
        .map_err(|error| (TextInsertionProblem::YdotooldNotRunning, error.to_string()))?;
    Ok((binary, socket))
}

/// The tool found on `PATH`, or where the distribution installs it.
fn ydotool_binary() -> String {
    find_on_path(YDOTOOL, std::env::var_os("PATH").as_deref())
        .unwrap_or_else(|| default_binary_path(YDOTOOL))
}

fn find_on_path(name: &str, path: Option<&std::ffi::OsStr>) -> Option<String> {
    std::env::split_paths(path?)
        .map(|directory| directory.join(name))
        .find(|candidate| candidate.is_file())
        .map(|candidate| candidate.to_string_lossy().into_owned())
}

fn is_ydotool_1x(binary: &str) -> bool {
    super::command::output_with_timeout(binary, &["key", "--help"], COMMAND_TIMEOUT)
        .is_some_and(|output| has_keycode_syntax(&output))
}

fn has_keycode_syntax(help: &[u8]) -> bool {
    String::from_utf8_lossy(help).contains(YDOTOOL_KEYCODE_SYNTAX)
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
    Err(AppError::ServiceUnavailable(String::from(
        "ydotoold is not running. Start it, for example with `systemctl --user enable --now ydotool`, and make sure it can access /dev/uinput",
    )))
}

/// The client knows a single default socket path, which differs between
/// ydotool versions, so it gets the socket that actually answers.
fn run_ydotool(binary: &str, socket: &PathBuf, events: &[KeyEvent]) -> Result<(), AppError> {
    let child = Command::new(binary)
        .args(ydotool_args(events))
        .env("YDOTOOL_SOCKET", socket)
        .spawn()?;
    let status = wait_with_timeout(child, binary, COMMAND_TIMEOUT)?;
    if status.success() {
        Ok(())
    } else {
        Err(AppError::Failed(format!(
            "Command `{binary}` failed with status {status}"
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
            return Err(AppError::Failed(format!(
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

    fn missing() -> Result<(), YdotoolFailure> {
        Err((
            TextInsertionProblem::YdotoolMissing,
            String::from("no ydotool"),
        ))
    }

    #[test]
    fn ydotool_goes_first_and_the_portal_is_not_asked() {
        let status = choose_sender(false, Ok(()), || unreachable!("portal asked"));
        assert_eq!(status.key_sender, Some(KeySender::Ydotool));
        assert_eq!(status.keys, KeysState::Ready);
    }

    #[test]
    fn the_portal_stands_in_for_a_missing_ydotool() {
        let status = choose_sender(false, missing(), || PortalState::NeedsPermission);
        assert_eq!(status.key_sender, Some(KeySender::Portal));
        assert_eq!(status.keys, KeysState::NeedsPermission);
        assert_eq!(status.problem, None);
        let status = choose_sender(false, missing(), || PortalState::Ready);
        assert_eq!(status.keys, KeysState::Ready);
    }

    #[test]
    fn without_both_the_ydotool_problem_is_reported() {
        let status = choose_sender(false, missing(), || {
            PortalState::Unavailable(String::from("no portal"))
        });
        assert_eq!(status.key_sender, None);
        assert_eq!(status.keys, KeysState::Unavailable);
        assert_eq!(status.problem, Some(TextInsertionProblem::YdotoolMissing));
        assert!(status.detail.unwrap().contains("no portal"));
    }

    #[test]
    fn a_sandbox_uses_only_the_portal() {
        let status = choose_sender(true, Ok(()), || PortalState::Ready);
        assert_eq!(status.key_sender, Some(KeySender::Portal));
        let status = choose_sender(true, Ok(()), || {
            PortalState::Unavailable(String::from("no portal"))
        });
        assert_eq!(
            status.problem,
            Some(TextInsertionProblem::PortalUnavailable)
        );
    }

    #[test]
    fn ydotool_presses_and_releases_paste_keys_after_clearing_modifiers() {
        let events = combo_events(PasteShortcut::CtrlV.paste_keys());
        let args = ydotool_args(&events);
        assert_eq!(args[0], "key");
        assert_eq!(args.len(), 1 + MODIFIER_KEYS.len() + 4);
        assert!(args[1..=MODIFIER_KEYS.len()]
            .iter()
            .all(|key| key.ends_with(":0")));
        assert_eq!(
            args[MODIFIER_KEYS.len() + 1..],
            ["29:1", "47:1", "47:0", "29:0"]
        );
    }

    #[test]
    fn an_unset_path_finds_the_tool_on_path() {
        let directory = std::env::temp_dir().join(format!("tyco-path-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join("ydotool"), "").unwrap();
        let path =
            std::env::join_paths([std::path::Path::new("/nonexistent"), &directory]).unwrap();
        assert_eq!(
            find_on_path("ydotool", Some(&path)),
            Some(directory.join("ydotool").to_string_lossy().into_owned())
        );
        assert_eq!(find_on_path("xclip", Some(&path)), None);
        assert_eq!(find_on_path("ydotool", None), None);
        std::fs::remove_dir_all(&directory).unwrap();
    }

    #[test]
    fn tells_ydotool_1x_by_its_keycode_syntax() {
        assert!(has_keycode_syntax(
            b"Syntax: <keycode>:<pressed>\ne.g. 28:1 28:0 means pressing on the Enter button"
        ));
        assert!(!has_keycode_syntax(
            b"Usage: key [--up] [--down] [--delay <ms>] <key sequence>"
        ));
    }

    #[test]
    fn terminal_copy_keys_ignore_the_paste_setting() {
        let linux = user_config::linux_insertion(&json!({"windowInsertion": {"linux": {
            "pasteShortcut": "Shift+Insert",
            "terminalPasteShortcut": "Ctrl+V",
        }}}));
        assert_eq!(
            focused_shortcut(&linux, FocusedKeyAction::Paste, true),
            PasteShortcut::CtrlV
        );
        assert_eq!(
            focused_shortcut(&linux, FocusedKeyAction::Paste, false),
            PasteShortcut::ShiftInsert
        );
        assert_eq!(
            focused_shortcut(&linux, FocusedKeyAction::Copy, true),
            PasteShortcut::CtrlShiftV
        );
    }

    #[test]
    fn combos_release_keys_in_reverse_order() {
        let tail = |keys: &[u16]| combo_events(keys)[MODIFIER_KEYS.len()..].to_vec();
        assert_eq!(
            tail(PasteShortcut::CtrlShiftV.paste_keys()),
            [
                (29, true),
                (42, true),
                (47, true),
                (47, false),
                (42, false),
                (29, false)
            ]
        );
        assert_eq!(
            tail(PasteShortcut::ShiftInsert.copy_keys()),
            [(29, true), (110, true), (110, false), (29, false)]
        );
        assert_eq!(
            tail(PasteShortcut::CtrlShiftV.copy_keys()),
            [
                (29, true),
                (42, true),
                (46, true),
                (46, false),
                (42, false),
                (29, false)
            ]
        );
    }

    #[test]
    fn unsupported_sessions_fail_with_a_clear_error() {
        let injector = SystemTextInjector {
            session: InjectionSessionKind::Unsupported,
        };
        let error = injector.ensure_supported().unwrap_err();
        assert!(error.to_string().contains("X11 or Wayland"));
    }
}
