pub(crate) mod clipboard;

use std::mem::size_of;
use std::sync::atomic::{AtomicIsize, Ordering};
use std::time::Duration;

use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, MapVirtualKeyW, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT,
    KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, MAPVK_VK_TO_VSC, VK_CONTROL, VK_INSERT, VK_LCONTROL,
    VK_LMENU, VK_LSHIFT, VK_LWIN, VK_RCONTROL, VK_RMENU, VK_RSHIFT, VK_RWIN, VK_SHIFT,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetClassNameW, GetForegroundWindow, GetWindowThreadProcessId, IsIconic, IsWindow,
    IsWindowVisible, SetForegroundWindow, ShowWindow, SW_RESTORE,
};

use crate::errors::AppError;

/// How long PowerShell may take to read the selection of a window.
const SELECTION_SCRIPT_TIMEOUT: Duration = Duration::from_secs(3);

pub(crate) fn focused_foreground_target() -> Option<String> {
    let window_handle = unsafe { GetForegroundWindow() };
    if window_handle.is_null() {
        return None;
    }
    let mut process_id = 0;
    unsafe { GetWindowThreadProcessId(window_handle, &mut process_id) };
    (process_id != std::process::id()).then(|| (window_handle as isize).to_string())
}

pub fn capture_foreground_target() -> Option<String> {
    static LAST_FOREGROUND_TARGET: AtomicIsize = AtomicIsize::new(0);
    let window_handle = unsafe { GetForegroundWindow() };
    if window_handle.is_null() {
        return None;
    }
    let mut process_id = 0;
    unsafe { GetWindowThreadProcessId(window_handle, &mut process_id) };
    let target = if process_id == std::process::id() {
        LAST_FOREGROUND_TARGET.load(Ordering::SeqCst)
    } else {
        LAST_FOREGROUND_TARGET.store(window_handle as isize, Ordering::SeqCst);
        window_handle as isize
    };
    (target != 0 && unsafe { IsWindow(target as HWND) } != 0).then(|| target.to_string())
}

pub async fn capture_selection(target: Option<String>) -> Option<String> {
    let window_handle = target?.parse::<isize>().ok()?;
    if window_handle == 0 || unsafe { IsWindow(window_handle as HWND) } == 0 {
        return None;
    }
    let mut process_id = 0;
    unsafe { GetWindowThreadProcessId(window_handle as HWND, &mut process_id) };
    if process_id == std::process::id() {
        return None;
    }
    // Read the target window through UI Automation after Tyco takes focus.
    // Sending Ctrl+C here would steal focus back and dismiss the quick panel.
    const SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr][long]$env:TYCO_SELECTION_WINDOW)
$condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::IsTextPatternAvailableProperty, $true)
$elements = $root.FindAll([System.Windows.Automation.TreeScope]::Subtree, $condition)
foreach ($element in $elements) {
    try {
        $pattern = $element.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
        $text = ($pattern.GetSelection() | ForEach-Object { $_.GetText(-1) }) -join "`n"
        if (-not [string]::IsNullOrWhiteSpace($text)) {
            $json = ConvertTo-Json -InputObject $text -Compress
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
            [Console]::OpenStandardOutput().Write($bytes, 0, $bytes.Length)
            break
        }
    } catch { continue }
}
"#;
    let mut command = super::process::command(
        "powershell",
        &["-NoProfile", "-NonInteractive", "-Command", SCRIPT],
    );
    command.env("TYCO_SELECTION_WINDOW", window_handle.to_string());
    let (status, output) = super::process::run(command, None, SELECTION_SCRIPT_TIMEOUT).ok()?;
    status
        .success()
        .then(|| super::native_selection::decode_selected_text(&output))
        .flatten()
}

pub fn inject_paste(
    user_config: &serde_json::Value,
    target_window_handle: Option<&str>,
) -> Result<(), AppError> {
    let window_handle = target_window_handle
        .and_then(|value| value.parse::<isize>().ok())
        .map(|value| value as HWND)
        .ok_or_else(|| AppError::Stale(String::from("Target window is not available")))?;
    if unsafe { IsWindow(window_handle) } == 0 {
        return Err(AppError::Stale(String::from(
            "The target window was closed",
        )));
    }
    ensure_not_elevated(window_handle)?;
    // a minimized window takes the focus without showing itself, and the
    // paste would go nowhere visible
    if unsafe { IsIconic(window_handle) } != 0 {
        unsafe { ShowWindow(window_handle, SW_RESTORE) };
    }
    if unsafe { SetForegroundWindow(window_handle) } == 0 {
        return Err(AppError::Failed(String::from(
            "Could not focus the target window",
        )));
    }
    if unsafe { GetForegroundWindow() } != window_handle {
        return Err(AppError::Failed(
            "The target window did not receive focus".into(),
        ));
    }
    let terminal_apps = crate::models::user_config::terminal_apps(user_config);
    press_keys(window_keys(window_handle, &terminal_apps), KeyAction::Paste)
}

/// Gives keyboard focus back to `target_window_handle` when it is still a live,
/// visible, non-minimized window of another process.
pub fn restore_foreground_target(target_window_handle: &str) {
    let Some(window_handle) = target_window_handle
        .parse::<isize>()
        .ok()
        .filter(|&value| value != 0)
        .map(|value| value as HWND)
    else {
        return;
    };
    if unsafe { IsWindow(window_handle) } == 0
        || unsafe { IsWindowVisible(window_handle) } == 0
        || unsafe { IsIconic(window_handle) } != 0
    {
        return;
    }
    let mut process_id = 0;
    unsafe { GetWindowThreadProcessId(window_handle, &mut process_id) };
    if process_id == std::process::id() || unsafe { GetForegroundWindow() } == window_handle {
        return;
    }
    unsafe {
        SetForegroundWindow(window_handle);
    }
}

/// The keys a window copies and pastes with.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum WindowKeys {
    /// Ctrl+C and Ctrl+V: any application but a terminal.
    Ctrl,
    /// Ctrl+Shift+C and Ctrl+Shift+V.
    CtrlShift,
    /// Ctrl+Insert and Shift+Insert, which consoles and most terminals take
    /// and no shell reads as an interrupt.
    Insert,
    /// Shift+Insert pastes, but no key copies: PuTTY and its relatives copy a
    /// selection as soon as it is made, and send Ctrl+C on to the server.
    PasteOnly,
}

impl WindowKeys {
    pub(crate) fn is_terminal(self) -> bool {
        self != Self::Ctrl
    }

    pub(crate) fn can_copy(self) -> bool {
        self != Self::PasteOnly
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum KeyAction {
    Copy,
    Paste,
}

/// The keys of window `window_handle`, told by its class; `terminal_apps`
/// are classes the user marks as terminals.
pub(crate) fn window_keys(window_handle: HWND, terminal_apps: &[String]) -> WindowKeys {
    let mut class = [0u16; 256];
    let length = unsafe { GetClassNameW(window_handle, class.as_mut_ptr(), class.len() as i32) };
    if length <= 0 {
        return WindowKeys::Ctrl;
    }
    keys_for_class(
        &String::from_utf16_lossy(&class[..length as usize]),
        terminal_apps,
    )
}

/// The keys of the window `id`, a decimal HWND.
pub(crate) fn window_keys_of(id: &str, terminal_apps: &[String]) -> WindowKeys {
    id.parse::<isize>()
        .map(|value| window_keys(value as HWND, terminal_apps))
        .unwrap_or(WindowKeys::Ctrl)
}

fn keys_for_class(class: &str, terminal_apps: &[String]) -> WindowKeys {
    match class.to_ascii_lowercase().as_str() {
        // Windows Terminal, the console host, ConEmu, mintty (Git Bash, MSYS2)
        "cascadia_hosting_window_class"
        | "consolewindowclass"
        | "virtualconsoleclass"
        | "mintty" => WindowKeys::Insert,
        "alacritty" | "wezterm" | "org.wezfurlong.wezterm" => WindowKeys::CtrlShift,
        "putty" | "kitty" | "tmobaxtermform" => WindowKeys::PasteOnly,
        _ if super::terminals::is_listed(class, terminal_apps) => WindowKeys::Insert,
        _ => WindowKeys::Ctrl,
    }
}

/// Integrity level of the process of `window_handle` above that of Tyco:
/// Windows drops the keys sent to such a window without telling, so an
/// insertion would look done while nothing happened.
fn ensure_not_elevated(window_handle: HWND) -> Result<(), AppError> {
    let mut process_id = 0;
    unsafe { GetWindowThreadProcessId(window_handle, &mut process_id) };
    match (
        process_integrity_level(std::process::id()),
        process_integrity_level(process_id),
    ) {
        (Some(own), Some(target)) if target > own => Err(AppError::PermissionDenied(
            String::from(
                "The target window runs as administrator, and Windows does not let Tyco press keys in it",
            ),
        )),
        _ => Ok(()),
    }
}

/// See `ensure_not_elevated`, for the window `id`, a decimal HWND.
pub(crate) fn ensure_window_not_elevated(id: &str) -> Result<(), AppError> {
    match id.parse::<isize>() {
        Ok(value) => ensure_not_elevated(value as HWND),
        Err(_) => Ok(()),
    }
}

/// The mandatory integrity level of a process (the last sub-authority of its
/// label), when Tyco may read it.
fn process_integrity_level(process_id: u32) -> Option<u32> {
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::Security::{
        GetSidSubAuthority, GetSidSubAuthorityCount, GetTokenInformation, TokenIntegrityLevel,
        TOKEN_MANDATORY_LABEL, TOKEN_QUERY,
    };
    use windows_sys::Win32::System::Threading::{
        GetCurrentProcess, OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    let is_own = process_id == std::process::id();
    // SAFETY: every handle opened here is closed before returning, and the
    // label is read from a buffer the size Windows asked for, aligned for it.
    unsafe {
        let process: HANDLE = if is_own {
            GetCurrentProcess()
        } else {
            OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id)
        };
        if process.is_null() {
            return None;
        }
        let mut token: HANDLE = null_mut();
        let is_opened = OpenProcessToken(process, TOKEN_QUERY, &mut token) != 0;
        if !is_own {
            CloseHandle(process);
        }
        if !is_opened {
            return None;
        }
        let mut size = 0u32;
        GetTokenInformation(token, TokenIntegrityLevel, null_mut(), 0, &mut size);
        let mut buffer = vec![0u64; (size as usize).div_ceil(8).max(1)];
        let is_read = size != 0
            && GetTokenInformation(
                token,
                TokenIntegrityLevel,
                buffer.as_mut_ptr().cast(),
                size,
                &mut size,
            ) != 0;
        CloseHandle(token);
        if !is_read {
            return None;
        }
        let label = &*buffer.as_ptr().cast::<TOKEN_MANDATORY_LABEL>();
        let sid = label.Label.Sid;
        let count = *GetSidSubAuthorityCount(sid);
        if count == 0 {
            return None;
        }
        Some(*GetSidSubAuthority(sid, u32::from(count - 1)))
    }
}

/// Keys whose scan code carries the extended flag.
const EXTENDED_KEYS: [u16; 5] = [VK_INSERT, VK_RCONTROL, VK_RMENU, VK_LWIN, VK_RWIN];

/// A key event with its scan code too: remote desktops, virtual machines and
/// some Java applications read the scan code, not the virtual key.
fn key_input(virtual_key: u16, flags: u32) -> INPUT {
    let scan_code = unsafe { MapVirtualKeyW(u32::from(virtual_key), MAPVK_VK_TO_VSC) } as u16;
    let extended = if EXTENDED_KEYS.contains(&virtual_key) {
        KEYEVENTF_EXTENDEDKEY
    } else {
        0
    };
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: virtual_key,
                wScan: scan_code,
                dwFlags: flags | extended,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

/// The modifiers to release first: the user may still hold those of the
/// hotkey that started the action, and Ctrl+C would become Ctrl+Alt+C, which
/// is AltGr+C on many layouts.
const RELEASED_MODIFIERS: [u16; 8] = [
    VK_LSHIFT,
    VK_RSHIFT,
    VK_LMENU,
    VK_RMENU,
    VK_LWIN,
    VK_RWIN,
    VK_LCONTROL,
    VK_RCONTROL,
];

fn held_modifier_releases(is_held: impl Fn(u16) -> bool) -> Vec<INPUT> {
    RELEASED_MODIFIERS
        .into_iter()
        .filter(|&key| is_held(key))
        .map(|key| key_input(key, KEYEVENTF_KEYUP))
        .collect()
}

/// The modifiers and the key of `action` in a window with `keys`; `None`
/// when such a window has no key for it.
fn combination(keys: WindowKeys, action: KeyAction) -> Option<(&'static [u16], u16)> {
    const CTRL: &[u16] = &[VK_CONTROL];
    const CTRL_SHIFT: &[u16] = &[VK_CONTROL, VK_SHIFT];
    const SHIFT: &[u16] = &[VK_SHIFT];
    let letter = |action| match action {
        KeyAction::Copy => u16::from(b'C'),
        KeyAction::Paste => u16::from(b'V'),
    };
    match (keys, action) {
        (WindowKeys::Ctrl, action) => Some((CTRL, letter(action))),
        (WindowKeys::CtrlShift, action) => Some((CTRL_SHIFT, letter(action))),
        (WindowKeys::Insert, KeyAction::Copy) => Some((CTRL, VK_INSERT)),
        (WindowKeys::Insert | WindowKeys::PasteOnly, KeyAction::Paste) => Some((SHIFT, VK_INSERT)),
        (WindowKeys::PasteOnly, KeyAction::Copy) => None,
    }
}

fn combination_inputs(modifiers: &[u16], key: u16) -> Vec<INPUT> {
    let presses = modifiers.iter().map(|&modifier| key_input(modifier, 0));
    let releases = modifiers
        .iter()
        .rev()
        .map(|&modifier| key_input(modifier, KEYEVENTF_KEYUP));
    presses
        .chain([key_input(key, 0), key_input(key, KEYEVENTF_KEYUP)])
        .chain(releases)
        .collect()
}

/// Sends keys only to the foreground window; callers validate its identity.
pub(crate) fn press_keys(keys: WindowKeys, action: KeyAction) -> Result<(), AppError> {
    let (modifiers, key) = combination(keys, action).ok_or_else(|| {
        AppError::InvalidInput(String::from(
            "This terminal copies a selection by itself and has no copy keys",
        ))
    })?;
    let mut inputs = held_modifier_releases(|key| unsafe { GetAsyncKeyState(i32::from(key)) } < 0);
    inputs.extend(combination_inputs(modifiers, key));
    let sent = unsafe {
        SendInput(
            inputs.len() as u32,
            inputs.as_ptr(),
            size_of::<INPUT>() as i32,
        )
    };
    if sent == inputs.len() as u32 {
        Ok(())
    } else {
        Err(AppError::Failed(String::from("SendInput failed")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn releases_only_the_modifiers_still_held() {
        let releases = held_modifier_releases(|key| key == VK_LMENU || key == VK_RSHIFT);
        let keys = releases
            .iter()
            .map(|input| unsafe { (input.Anonymous.ki.wVk, input.Anonymous.ki.dwFlags) })
            .collect::<Vec<_>>();
        assert_eq!(
            keys,
            [(VK_RSHIFT, KEYEVENTF_KEYUP), (VK_LMENU, KEYEVENTF_KEYUP)]
        );
    }

    #[test]
    fn terminals_copy_without_ctrl_c() {
        assert_eq!(
            keys_for_class("CASCADIA_HOSTING_WINDOW_CLASS", &[]),
            WindowKeys::Insert
        );
        assert_eq!(
            keys_for_class("ConsoleWindowClass", &[]),
            WindowKeys::Insert
        );
        assert_eq!(keys_for_class("mintty", &[]), WindowKeys::Insert);
        assert_eq!(keys_for_class("PuTTY", &[]), WindowKeys::PasteOnly);
        assert_eq!(keys_for_class("Alacritty", &[]), WindowKeys::CtrlShift);
        assert_eq!(keys_for_class("Notepad", &[]), WindowKeys::Ctrl);
        assert_eq!(
            keys_for_class("MyTerm", &[String::from("myterm")]),
            WindowKeys::Insert
        );
        assert_eq!(
            combination(WindowKeys::Insert, KeyAction::Copy),
            Some((&[VK_CONTROL][..], VK_INSERT))
        );
        assert_eq!(combination(WindowKeys::PasteOnly, KeyAction::Copy), None);
    }

    #[test]
    fn combinations_release_in_reverse_and_mark_insert_extended() {
        let inputs = combination_inputs(&[VK_CONTROL, VK_SHIFT], VK_INSERT);
        let keys = inputs
            .iter()
            .map(|input| unsafe { (input.Anonymous.ki.wVk, input.Anonymous.ki.dwFlags) })
            .collect::<Vec<_>>();
        assert_eq!(
            keys,
            [
                (VK_CONTROL, 0),
                (VK_SHIFT, 0),
                (VK_INSERT, KEYEVENTF_EXTENDEDKEY),
                (VK_INSERT, KEYEVENTF_KEYUP | KEYEVENTF_EXTENDEDKEY),
                (VK_SHIFT, KEYEVENTF_KEYUP),
                (VK_CONTROL, KEYEVENTF_KEYUP),
            ]
        );
    }
}
