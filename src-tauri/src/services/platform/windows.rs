pub(crate) mod clipboard;

use std::mem::size_of;
use std::sync::atomic::{AtomicIsize, Ordering};
use std::time::Duration;

use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_CONTROL, VK_SHIFT,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetClassNameW, GetForegroundWindow, GetWindowThreadProcessId, IsWindow, SetForegroundWindow,
};

use crate::errors::AppError;

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
    let (status, output) = super::process::run(command, None, Duration::from_secs(3)).ok()?;
    status
        .success()
        .then(|| super::native_selection::decode_selected_text(&output))
        .flatten()
}

pub fn inject_paste(target_window_handle: Option<&str>) -> Result<(), AppError> {
    let window_handle = target_window_handle
        .and_then(|value| value.parse::<isize>().ok())
        .map(|value| value as HWND)
        .ok_or_else(|| AppError::Stale(String::from("Target window is not available")))?;
    if unsafe { SetForegroundWindow(window_handle) } == 0 {
        return Err(AppError::Message(String::from(
            "Could not focus the target window",
        )));
    }
    if unsafe { GetForegroundWindow() } != window_handle {
        return Err(AppError::Message(
            "The target window did not receive focus".into(),
        ));
    }
    press_copy_or_paste(false, is_foreground_terminal())
}

pub fn is_foreground_terminal() -> bool {
    let mut class = [0u16; 256];
    let length = unsafe {
        GetClassNameW(
            GetForegroundWindow(),
            class.as_mut_ptr(),
            class.len() as i32,
        )
    };
    length > 0 && is_terminal_class(&String::from_utf16_lossy(&class[..length as usize]))
}

fn is_terminal_class(class: &str) -> bool {
    matches!(
        class.to_ascii_lowercase().as_str(),
        "cascadia_hosting_window_class"
            | "consolewindowclass"
            | "virtualconsoleclass"
            | "mintty"
            | "alacritty"
            | "wezterm"
            | "org.wezfurlong.wezterm"
    )
}

fn copy_or_paste_inputs(copy: bool, terminal: bool) -> Vec<INPUT> {
    let key = |virtual_key: u16, flags| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: virtual_key,
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let mut inputs = vec![key(VK_CONTROL, 0)];
    if terminal {
        inputs.push(key(VK_SHIFT, 0));
    }
    let letter = if copy { b'C' } else { b'V' } as u16;
    inputs.push(key(letter, 0));
    inputs.push(key(letter, KEYEVENTF_KEYUP));
    if terminal {
        inputs.push(key(VK_SHIFT, KEYEVENTF_KEYUP));
    }
    inputs.push(key(VK_CONTROL, KEYEVENTF_KEYUP));
    inputs
}

/// Sends keys only to the foreground window; callers validate its identity.
pub fn press_copy_or_paste(copy: bool, terminal: bool) -> Result<(), AppError> {
    let inputs = copy_or_paste_inputs(copy, terminal);
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
        Err(AppError::Message(String::from("SendInput failed")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn terminal_copy_uses_shift_instead_of_interrupting_the_process() {
        assert!(is_terminal_class("CASCADIA_HOSTING_WINDOW_CLASS"));
        assert!(is_terminal_class("ConsoleWindowClass"));
        assert!(!is_terminal_class("Notepad"));
        let inputs = copy_or_paste_inputs(true, true);
        assert_eq!(inputs.len(), 6);
        assert_eq!(unsafe { inputs[1].Anonymous.ki.wVk }, VK_SHIFT);
        assert_eq!(unsafe { inputs[2].Anonymous.ki.wVk }, b'C' as u16);
        assert_eq!(copy_or_paste_inputs(false, false).len(), 4);
    }
}
