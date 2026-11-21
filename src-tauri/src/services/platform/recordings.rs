//! Where call recordings go by default: the user's music folder, as the
//! desktop names it (`XDG_MUSIC_DIR` on Linux, the Music known folder on
//! Windows), else `Music` in the home folder.
use std::path::{Path, PathBuf};

use crate::errors::AppError;

const APP_FOLDER: &str = "TyCo";

pub fn default_recordings_folder() -> Option<PathBuf> {
    dirs::audio_dir()
        .or_else(|| super::shell::home_dir().map(|home| home.join("Music")))
        .map(|music| music.join(APP_FOLDER))
}

/// The folder a recording goes to: the configured one, else the default.
pub fn resolve_recordings_folder(configured: Option<&str>) -> Option<PathBuf> {
    match configured.map(str::trim).filter(|value| !value.is_empty()) {
        Some(folder) => super::shell::expand_home(folder, super::shell::home_dir().as_deref()),
        None => default_recordings_folder(),
    }
}

/// `TyCo dialog YYYY-MM-DD HH-MM-SS.opus` in `folder`, with ` (2)` and on
/// when a file of that name is there.
pub fn recording_path(folder: &Path, local_time: &str) -> PathBuf {
    let base = format!("TyCo dialog {local_time}");
    let mut path = folder.join(format!("{base}.opus"));
    let mut attempt = 2;
    while path.exists() {
        path = folder.join(format!("{base} ({attempt}).opus"));
        attempt += 1;
    }
    path
}

/// Only recordings are looked at: the path comes from the webview.
fn recording_file(path: &str) -> Result<&Path, AppError> {
    let path = Path::new(path);
    let is_recording = path.is_absolute()
        && path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("opus"));
    if !is_recording {
        return Err(AppError::InvalidInput("Not a call recording".into()));
    }
    Ok(path)
}

/// Which of `paths` are still there.
pub fn recordings_exist(paths: &[String]) -> Vec<bool> {
    paths
        .iter()
        .map(|path| recording_file(path).is_ok_and(Path::is_file))
        .collect()
}

/// Opens the folder that holds the recording `path`.
pub fn show_recording(path: &str) -> Result<(), AppError> {
    let file = recording_file(path)?;
    if !file.is_file() {
        return Err(AppError::NotFound("The recording file is not found".into()));
    }
    let folder = file
        .parent()
        .ok_or_else(|| AppError::NotFound("The recording has no folder".into()))?;
    super::open_dir(folder)
}

/// Opens the recordings folder, creating it first.
pub fn open_recordings_folder(configured: Option<&str>) -> Result<(), AppError> {
    let folder = resolve_recordings_folder(configured)
        .ok_or_else(|| AppError::NotFound("No folder for the recordings was found".into()))?;
    std::fs::create_dir_all(&folder).map_err(|error| {
        AppError::Failed(format!("Cannot create the recordings folder: {error}"))
    })?;
    super::open_dir(&folder)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_taken_name_gets_a_number() {
        let folder = std::env::temp_dir().join(format!("tyco-recordings-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        let first = recording_path(&folder, "2026-11-20 10-00-00");
        assert_eq!(
            first.file_name().unwrap(),
            "TyCo dialog 2026-11-20 10-00-00.opus"
        );
        std::fs::write(&first, b"").unwrap();
        let second = recording_path(&folder, "2026-11-20 10-00-00");
        assert_eq!(
            second.file_name().unwrap(),
            "TyCo dialog 2026-11-20 10-00-00 (2).opus"
        );
        let _ = std::fs::remove_dir_all(folder);
    }

    #[test]
    fn only_absolute_opus_files_are_checked() {
        let exists = recordings_exist(&["relative.opus".into(), "/etc/passwd".into()]);
        assert_eq!(exists, [false, false]);
        assert!(show_recording("/etc/passwd").is_err());
    }

    #[test]
    fn a_blank_setting_means_the_default() {
        assert_eq!(
            resolve_recordings_folder(Some("  ")),
            default_recordings_folder()
        );
    }
}
