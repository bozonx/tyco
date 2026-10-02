//! Durable writes of the files Tyco owns: the config, the state, the history
//! and the secrets.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::errors::AppError;

/// Writes a temporary file next to `path` and renames it over: a crash in the
/// middle of the write leaves the previous content intact instead of a torn
/// file. The file is readable by its owner only, as it may hold user texts or
/// keys.
pub fn write_private(path: &Path, raw: &str) -> Result<(), AppError> {
    let mut tmp_name = path.file_name().unwrap_or_default().to_os_string();
    tmp_name.push(".tmp");
    let tmp_path = path.with_file_name(tmp_name);

    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    {
        let mut file = options.open(&tmp_path)?;
        file.write_all(raw.as_bytes())?;
        file.sync_all()?;
    }
    fs::rename(&tmp_path, path)?;
    Ok(())
}

/// Moves an unreadable file out of the way so that the app can start with
/// defaults, keeping the original for the user to recover. Returns where it
/// went.
pub fn quarantine(path: &Path) -> Result<PathBuf, AppError> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(format!(".broken-{stamp}"));
    let target = path.with_file_name(name);
    fs::rename(path, &target)?;
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "tyco-atomic-file-test-{label}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("failed to create the temp dir");
        dir
    }

    #[test]
    fn replaces_the_file_and_leaves_no_temp_file() {
        let dir = temp_dir("replace");
        let path = dir.join("file.json");

        write_private(&path, "old").unwrap();
        write_private(&path, "new").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "new");
        assert!(!dir.join("file.json.tmp").exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn quarantine_keeps_the_original_content() {
        let dir = temp_dir("quarantine");
        let path = dir.join("config.yaml");
        fs::write(&path, "broken: [").unwrap();

        let target = quarantine(&path).unwrap();

        assert!(!path.exists());
        assert_eq!(fs::read_to_string(target).unwrap(), "broken: [");
        let _ = fs::remove_dir_all(&dir);
    }
}
