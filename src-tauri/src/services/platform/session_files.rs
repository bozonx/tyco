//! Where the files of the memory-only histories live while the app runs.
use std::path::{Path, PathBuf};

/// A folder for the files of this run that nothing should keep past it,
/// named after the app `app_id`. On Linux it is in `$XDG_RUNTIME_DIR`: a
/// folder in memory that only the user reaches and that goes when they log
/// out, so the files never reach the disk. Elsewhere, or without it, it is in
/// the temporary folder of the system, which keeps them on the disk: the app
/// removes the folder when it quits and when it starts after a crash.
pub fn session_files_root(app_id: &str) -> PathBuf {
    #[cfg(target_os = "linux")]
    if let Some(dir) = runtime_dir(std::env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from)) {
        return dir.join(format!("{app_id}-session"));
    }
    // the temporary folder may be shared by every user of the machine
    let user = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_default()
        .chars()
        .filter(|char| char.is_ascii_alphanumeric())
        .collect::<String>();
    std::env::temp_dir().join(format!("{app_id}-session-{user}"))
}

fn runtime_dir(dir: Option<PathBuf>) -> Option<PathBuf> {
    dir.filter(|dir| dir.is_absolute() && Path::is_dir(dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_runtime_folder_must_be_an_existing_absolute_one() {
        assert_eq!(runtime_dir(None), None);
        assert_eq!(runtime_dir(Some(PathBuf::from("relative"))), None);
        let dir = std::env::temp_dir();
        assert_eq!(runtime_dir(Some(dir.clone())), Some(dir));
    }
}
