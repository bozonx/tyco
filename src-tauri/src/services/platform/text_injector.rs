use serde::Serialize;
use serde_json::Value;

use super::ForegroundTarget;
use crate::errors::AppError;

pub(crate) trait TextInjector {
    fn inject(
        &self,
        user_config: &Value,
        target: Option<&ForegroundTarget>,
    ) -> Result<(), AppError>;
}

pub(crate) struct SystemTextInjector;

impl TextInjector for SystemTextInjector {
    fn inject(
        &self,
        user_config: &Value,
        target: Option<&ForegroundTarget>,
    ) -> Result<(), AppError> {
        inject_paste_impl(user_config, target.map(ForegroundTarget::as_platform_id))
    }
}

/// What presses the paste and copy keys in other windows.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum KeySender {
    /// The ydotoold daemon, through `/dev/uinput`; X11 and Wayland.
    Ydotool,
    /// The RemoteDesktop desktop portal: KDE Plasma 6 and GNOME, and Flatpak.
    Portal,
    /// The input API of Windows or macOS.
    #[cfg_attr(target_os = "linux", allow(dead_code))]
    System,
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum KeysState {
    Ready,
    /// Works once the user allows it, see `request_text_insertion_permission`.
    NeedsPermission,
    Unavailable,
}

/// Why keys cannot be pressed, for the settings to tell how to fix it.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum TextInsertionProblem {
    /// Neither X11 nor Wayland, e.g. a TTY.
    UnsupportedSession,
    YdotoolMissing,
    /// ydotool 0.1.x, whose commands differ.
    YdotoolOutdated,
    YdotooldNotRunning,
    /// Inside a sandbox, where only the portal could press keys.
    PortalUnavailable,
    /// macOS only.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    AccessibilityDenied,
}

/// How Tyco finds the window to insert into.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum TargetTracking {
    /// Tyco knows the window and gives it the focus back itself.
    Tracked,
    /// Tyco hides its window and inserts into whatever window the desktop
    /// focuses then, usually the previous one.
    FocusReturn,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct TextInsertionStatus {
    /// What presses the keys; none when nothing can.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub key_sender: Option<KeySender>,
    pub keys: KeysState,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub problem: Option<TextInsertionProblem>,
    /// What the system reported, in English.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub detail: Option<String>,
    pub target: TargetTracking,
}

/// What text insertion can do now and what it lacks. Runs system tools and
/// D-Bus calls, so it belongs on the blocking pool.
#[cfg(target_os = "linux")]
pub fn text_insertion_status() -> TextInsertionStatus {
    super::linux::text_injector::status()
}

#[cfg(target_os = "windows")]
pub fn text_insertion_status() -> TextInsertionStatus {
    TextInsertionStatus {
        key_sender: Some(KeySender::System),
        keys: KeysState::Ready,
        problem: None,
        detail: None,
        target: TargetTracking::Tracked,
    }
}

#[cfg(target_os = "macos")]
pub fn text_insertion_status() -> TextInsertionStatus {
    let check = super::macos::check_text_injection();
    TextInsertionStatus {
        key_sender: Some(KeySender::System),
        keys: if check.is_ok() {
            KeysState::Ready
        } else {
            KeysState::Unavailable
        },
        problem: check
            .is_err()
            .then_some(TextInsertionProblem::AccessibilityDenied),
        detail: check.err().map(|error| error.to_string()),
        target: TargetTracking::Tracked,
    }
}

/// Asks the user for what text insertion needs, where the system asks
/// through a dialog: the RemoteDesktop portal on Linux.
#[cfg(target_os = "linux")]
pub fn request_text_insertion_permission() -> Result<(), AppError> {
    super::linux::remote_desktop::request_permission()
}

#[cfg(not(target_os = "linux"))]
pub fn request_text_insertion_permission() -> Result<(), AppError> {
    Ok(())
}

#[cfg(target_os = "linux")]
fn inject_paste_impl(user_config: &Value, target_window_id: Option<&str>) -> Result<(), AppError> {
    super::linux::inject_paste(user_config, target_window_id)
}

#[cfg(target_os = "windows")]
fn inject_paste_impl(
    _user_config: &Value,
    target_platform_id: Option<&str>,
) -> Result<(), AppError> {
    super::windows::inject_paste(target_platform_id)
}

#[cfg(target_os = "macos")]
fn inject_paste_impl(
    _user_config: &Value,
    target_platform_id: Option<&str>,
) -> Result<(), AppError> {
    super::macos::inject_paste(target_platform_id)
}
