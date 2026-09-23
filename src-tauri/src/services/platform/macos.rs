use crate::errors::AppError;

pub fn capture_source() -> Option<String> {
    None
}

pub async fn capture_selection() -> Option<String> {
    None
}

pub fn inject_paste() -> Result<(), AppError> {
    let status = std::process::Command::new("osascript")
        .args([
            "-e",
            "tell application \"System Events\" to keystroke \"v\" using command down",
        ])
        .status()?;
    if status.success() {
        Ok(())
    } else {
        Err(AppError::Message(String::from(
            "Text insertion requires Accessibility permission",
        )))
    }
}
