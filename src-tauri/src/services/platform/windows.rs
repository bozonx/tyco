use std::mem::size_of;

use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_CONTROL,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, SetForegroundWindow, HWND};

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
    let inputs = [
        key(VK_CONTROL, 0),
        key(b'V' as u16, 0),
        key(b'V' as u16, KEYEVENTF_KEYUP),
        key(VK_CONTROL, KEYEVENTF_KEYUP),
    ];
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
