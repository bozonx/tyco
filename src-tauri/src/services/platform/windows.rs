use std::mem::size_of;

use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_CONTROL, VK_SHIFT,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetClassNameW, GetForegroundWindow, SetForegroundWindow,
};

use crate::errors::AppError;

pub fn capture_source() -> Option<String> {
    let handle = unsafe { GetForegroundWindow() };
    (!handle.is_null())
        .then(|| handle as isize)
        .map(|value| value.to_string())
}

pub async fn capture_selection() -> Option<String> {
    None
}

pub fn inject_paste(source_window_id: Option<&str>) -> Result<(), AppError> {
    let handle = source_window_id
        .and_then(|value| value.parse::<isize>().ok())
        .map(|value| value as HWND)
        .ok_or_else(|| AppError::Message(String::from("Target window is not available")))?;
    if unsafe { SetForegroundWindow(handle) } == 0 {
        return Err(AppError::Message(String::from(
            "Could not focus the target window",
        )));
    }
    press_copy_or_paste(false, foreground_is_terminal())
}

pub fn foreground_is_terminal() -> bool {
    let mut class = [0u16; 256];
    let length = unsafe {
        GetClassNameW(
            GetForegroundWindow(),
            class.as_mut_ptr(),
            class.len() as i32,
        )
    };
    length > 0 && terminal_class(&String::from_utf16_lossy(&class[..length as usize]))
}

fn terminal_class(class: &str) -> bool {
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
        assert!(terminal_class("CASCADIA_HOSTING_WINDOW_CLASS"));
        assert!(terminal_class("ConsoleWindowClass"));
        assert!(!terminal_class("Notepad"));
        let inputs = copy_or_paste_inputs(true, true);
        assert_eq!(inputs.len(), 6);
        assert_eq!(unsafe { inputs[1].Anonymous.ki.wVk }, VK_SHIFT);
        assert_eq!(unsafe { inputs[2].Anonymous.ki.wVk }, b'C' as u16);
        assert_eq!(copy_or_paste_inputs(false, false).len(), 4);
    }
}
