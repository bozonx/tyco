//! Shows a directory in the platform's file manager.

use std::path::Path;
use std::process::Command;

use crate::errors::AppError;

/// Opens `dir` in the file manager.
pub fn open_dir(dir: &Path) -> Result<(), AppError> {
    if !dir.is_dir() {
        return Err(AppError::Message(format!(
            "Not a directory: {}",
            dir.display()
        )));
    }
    let mut command = Command::new(opener());
    command.arg(dir);
    crate::services::clipboard::hide_console_window(&mut command);
    // `explorer.exe` exits with 1 even when it opened the folder, so only a
    // failure to start counts; the child is reaped to leave no zombie
    let mut child = command.spawn()?;
    std::thread::spawn(move || child.wait());
    Ok(())
}

fn opener() -> &'static str {
    if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(target_os = "windows") {
        "explorer.exe"
    } else {
        "xdg-open"
    }
}
