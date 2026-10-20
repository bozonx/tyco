//! Durable writes of the files Tyco owns: the config, the history
//! and the secrets.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use crate::errors::AppError;

/// How many set-aside copies of one file stay: the broken ones moved out of
/// the way, or the snapshots taken before a repair. Older ones are deleted.
pub const KEPT_COPY_COUNT: usize = 3;
/// What the name of a broken copy adds to the name of its file.
const BROKEN_COPY_MARKER: &str = ".broken-";

/// Writes a temporary file next to `path` and renames it over: a crash in the
/// middle of the write leaves the previous content intact instead of a torn
/// file. The file is readable by its owner only, as it may hold user texts or
/// keys.
pub fn write_private(path: &Path, raw: &str) -> Result<(), AppError> {
    write_private_bytes(path, raw.as_bytes())
}

/// Atomically writes private binary data.
pub fn write_private_bytes(path: &Path, raw: &[u8]) -> Result<(), AppError> {
    write_atomic(path, raw, 0o600, None)
}

/// `mode` applies to a new temporary file on Unix, before the umask;
/// `permissions`, when given, replace it before the rename.
fn write_atomic(
    path: &Path,
    raw: &[u8],
    #[cfg_attr(not(unix), allow(unused_variables))] mode: u32,
    permissions: Option<fs::Permissions>,
) -> Result<(), AppError> {
    static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);
    let (temporary, mut file) = loop {
        let mut name = path.file_name().unwrap_or_default().to_os_string();
        name.push(format!(
            ".tmp-{}-{}",
            std::process::id(),
            NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
        ));
        let temporary_path = path.with_file_name(name);
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(mode);
        }
        match options.open(&temporary_path) {
            Ok(file) => break (TemporaryFile(temporary_path), file),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    };
    file.write_all(raw)?;
    if let Some(permissions) = permissions {
        file.set_permissions(permissions)?;
    }
    file.sync_all()?;
    drop(file);
    fs::rename(&temporary.0, path)?;
    sync_parent(path)
}

struct TemporaryFile(PathBuf);

impl Drop for TemporaryFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

/// Persists directory-entry changes after a rename or removal on Unix.
pub(super) fn sync_parent(path: &Path) -> Result<(), AppError> {
    #[cfg(unix)]
    fs::File::open(
        path.parent()
            .filter(|dir| !dir.as_os_str().is_empty())
            .unwrap_or(Path::new(".")),
    )?
    .sync_all()?;
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

/// Creates one of Tyco's own directories, closed to other users: the files in
/// it may hold user texts or keys. An existing directory is closed too, so
/// that one made by an older version gets the same permissions. A directory
/// whose permissions cannot be changed, e.g. one created by another user or on
/// a file system without them, is used as it is: the app must start either
/// way.
pub fn create_private_dir(path: &Path) -> Result<(), AppError> {
    fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let private = fs::metadata(path).is_ok_and(|meta| meta.permissions().mode() & 0o077 == 0);
        if !private {
            if let Err(error) = fs::set_permissions(path, fs::Permissions::from_mode(0o700)) {
                log::warn!("Could not close {} to other users: {error}", path.display());
            }
        }
    }
    Ok(())
}

/// Moves an unreadable file out of the way so that the app can start with
/// defaults, keeping the original for the user to recover. Returns where it
/// went.
pub fn quarantine(path: &Path) -> Result<PathBuf, AppError> {
    static NEXT_QUARANTINE: AtomicU64 = AtomicU64::new(0);
    let stamp = crate::services::clock::now_ns();
    let target = loop {
        let mut name = path.file_name().unwrap_or_default().to_os_string();
        name.push(format!(
            "{BROKEN_COPY_MARKER}{stamp}-{}-{}",
            std::process::id(),
            NEXT_QUARANTINE.fetch_add(1, Ordering::Relaxed)
        ));
        let target = path.with_file_name(name);
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
        {
            Ok(file) => {
                drop(file);
                break target;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    };
    if let Err(error) = fs::rename(path, &target) {
        let _ = fs::remove_file(&target);
        return Err(error.into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&target, fs::Permissions::from_mode(0o600))?;
    }
    sync_parent(path)?;
    prune_copies(path, BROKEN_COPY_MARKER, KEPT_COPY_COUNT)?;
    Ok(target)
}

/// Deletes all but the `keep` newest copies of `path`: the files next to it
/// named after it with `marker` and a suffix.
pub fn prune_copies(path: &Path, marker: &str, keep: usize) -> Result<(), AppError> {
    let (Some(dir), Some(name)) = (path.parent(), path.file_name()) else {
        return Ok(());
    };
    let prefix = format!("{}{marker}", name.to_string_lossy());
    let mut copies = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        if !entry.file_name().to_string_lossy().starts_with(&prefix) {
            continue;
        }
        let modified = entry.metadata()?.modified()?;
        copies.push((modified, entry.path()));
    }
    copies.sort_by_key(|(modified, _)| std::cmp::Reverse(*modified));
    for (_, copy) in copies.into_iter().skip(keep) {
        fs::remove_file(copy)?;
    }
    Ok(())
}

/// Keeps the exact damaged bytes before a salvage operation rewrites a file.
/// The content digest avoids making another copy on every read.
pub fn preserve_broken_copy(path: &Path, raw: &[u8]) -> Result<PathBuf, AppError> {
    use sha2::{Digest, Sha256};
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(format!("{BROKEN_COPY_MARKER}{:x}", Sha256::digest(raw)));
    let target = path.with_file_name(name);
    if !target.exists() {
        write_private_bytes(&target, raw)?;
        prune_copies(path, BROKEN_COPY_MARKER, KEPT_COPY_COUNT)?;
    }
    Ok(target)
}

/// Parses the file at `path`; `None` when there is none or its content was
/// broken and it has been moved aside. A file that cannot be read at all, e.g.
/// for its permissions, is an error and stays where it is: its content may be
/// fine.
pub fn read_or_quarantine<T>(
    path: &Path,
    parse: impl FnOnce(&str) -> Result<T, AppError>,
) -> Result<Option<T>, AppError> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };

    let parsed = String::from_utf8(bytes)
        .map_err(|error| AppError::InvalidData(format!("not UTF-8: {error}")))
        .and_then(|raw| parse(&raw));
    match parsed {
        Ok(value) => Ok(Some(value)),
        Err(error) => {
            let target = quarantine(path)?;
            log::error!(
                "{} is unreadable ({error}); moved it to {} and starting with defaults. \
                 The copy may hold private data: delete it once recovered",
                path.display(),
                target.display()
            );
            Ok(None)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::services::test_support::TestDir;

    #[test]
    fn keeps_only_the_newest_copies_of_a_file() {
        let dir = TestDir::new("prune");
        let path = dir.join("config.json");
        fs::write(&path, "current").unwrap();
        fs::write(dir.join("other.json.broken-1"), "unrelated").unwrap();
        for index in 0..5 {
            fs::write(dir.join(format!("config.json.broken-{index}")), "x").unwrap();
            std::thread::sleep(std::time::Duration::from_millis(15));
        }

        prune_copies(&path, BROKEN_COPY_MARKER, 2).unwrap();

        let mut names: Vec<_> = fs::read_dir(&*dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        assert_eq!(
            names,
            [
                "config.json",
                "config.json.broken-3",
                "config.json.broken-4",
                "other.json.broken-1"
            ]
        );
    }

    #[test]
    fn replaces_the_file_and_leaves_no_temp_file() {
        let dir = TestDir::new("replace");
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
    }

    #[test]
    fn concurrent_writes_never_share_a_temporary_file() {
        let dir = TestDir::new("concurrent");
        let path = dir.join("file.json");
        std::thread::scope(|scope| {
            for index in 0..16 {
                let path = &path;
                scope.spawn(move || write_private(path, &index.to_string()).unwrap());
            }
        });
        let value: u32 = fs::read_to_string(&path).unwrap().parse().unwrap();
        assert!(value < 16);
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
    }

    #[test]
    fn a_failed_rename_cleans_up_its_temporary_file() {
        let dir = TestDir::new("failed-rename");
        let target = dir.join("directory");
        fs::create_dir(&target).unwrap();
        assert!(write_private(&target, "data").is_err());
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn a_leftover_temp_file_does_not_pass_on_its_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let dir = TestDir::new("leftover");
        let path = dir.join("file.json");
        let tmp_path = dir.join("file.json.tmp");
        fs::write(&tmp_path, "stale").unwrap();
        fs::set_permissions(&tmp_path, fs::Permissions::from_mode(0o644)).unwrap();

        write_private(&path, "new").unwrap();

        let mode = fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[cfg(unix)]
    #[test]
    fn private_dirs_are_closed_to_other_users() {
        use std::os::unix::fs::PermissionsExt;

        let dir = TestDir::new("private-dir");
        let existing = dir.join("existing");
        fs::create_dir_all(&existing).unwrap();
        fs::set_permissions(&existing, fs::Permissions::from_mode(0o755)).unwrap();
        let created = dir.join("nested/created");

        create_private_dir(&existing).unwrap();
        create_private_dir(&created).unwrap();

        for path in [&existing, &created] {
            let mode = fs::metadata(path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o700);
        }
    }

    #[test]
    fn read_or_quarantine_moves_an_unreadable_file_aside() {
        let dir = TestDir::new("read-or-quarantine");
        let path = dir.join("secrets.json");
        fs::write(&path, "{ broken").unwrap();

        let parsed = read_or_quarantine(&path, |raw| {
            Ok(serde_json::from_str::<serde_json::Value>(raw)?)
        })
        .unwrap();

        assert!(parsed.is_none());
        assert!(!path.exists());
    }

    #[test]
    fn quarantine_keeps_the_original_content() {
        let dir = TestDir::new("quarantine");
        let path = dir.join("config.json");
        fs::write(&path, "broken: [").unwrap();

        let target = quarantine(&path).unwrap();

        assert!(!path.exists());
        assert_eq!(fs::read_to_string(target).unwrap(), "broken: [");
    }
}
