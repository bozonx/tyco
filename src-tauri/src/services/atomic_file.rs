//! Durable writes of the files Tyco owns: the config, the history
//! and the secrets.
//!
//! Copies kept aside (broken files, files before a repair or a salvage) go to
//! the recovery folder of the root the file is in, see
//! [`register_recovery_root`]: the user data folder holds data only, as it
//! may be synced to other machines. A file outside every registered root
//! keeps its copies next to it.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::RwLock;
use std::time::Duration;

use crate::errors::AppError;
use crate::locks::RwLockExt;

/// What the name of a temporary file starts with, so that a sync tool can be
/// told to skip it. It stays next to its file: a rename across folders would
/// not be atomic.
pub const TEMPORARY_FILE_PREFIX: &str = ".tyco-tmp-";

/// The roots whose kept-aside copies go elsewhere, with where they go.
static RECOVERY_ROOTS: RwLock<Vec<(PathBuf, PathBuf)>> = RwLock::new(Vec::new());

/// Has the copies of the files under `root` kept in `recovery`, at the same
/// relative path. A root registered again moves to the new place.
pub fn register_recovery_root(root: &Path, recovery: &Path) {
    let mut roots = RECOVERY_ROOTS.write_locked();
    roots.retain(|(known, _)| known != root);
    roots.push((root.to_path_buf(), recovery.to_path_buf()));
}

/// The folder the copies of `path` go to and the name they start with.
fn copy_location(path: &Path) -> (PathBuf, std::ffi::OsString) {
    let name = path.file_name().unwrap_or_default().to_os_string();
    let roots = RECOVERY_ROOTS.read_locked();
    let dir = recovery_dir_of(path, &roots)
        .unwrap_or_else(|| path.parent().map(Path::to_path_buf).unwrap_or_default());
    (dir, name)
}

/// The recovery folder of `path` among `roots`: the longest root wins.
fn recovery_dir_of(path: &Path, roots: &[(PathBuf, PathBuf)]) -> Option<PathBuf> {
    let (root, recovery) = roots
        .iter()
        .filter(|(root, _)| path.starts_with(root))
        .max_by_key(|(root, _)| root.components().count())?;
    let relative = path.parent()?.strip_prefix(root).ok()?;
    Some(recovery.join(relative))
}

/// Creates the folder for the copies of `path` and returns where a copy
/// named with `suffix` goes.
fn copy_path(path: &Path, suffix: &str) -> Result<PathBuf, AppError> {
    let (dir, mut name) = copy_location(path);
    if !dir.as_os_str().is_empty() && !dir.exists() {
        create_private_dir(&dir)?;
    }
    name.push(suffix);
    Ok(dir.join(name))
}

/// How many set-aside copies of one file stay: the broken ones moved out of
/// the way, or the snapshots taken before a repair. Older ones are deleted.
pub const KEPT_COPY_COUNT: usize = 3;
/// What the name of a broken copy adds to the name of its file.
const BROKEN_COPY_MARKER: &str = ".broken-";

/// `<pid>-<n>`, a part of a file name no other temporary file of this process
/// has had; another process has another pid.
pub(crate) fn unique_file_suffix() -> String {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    format!(
        "{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    )
}

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
    crate::services::storage::user_data::ensure_write_allowed(path)?;
    let (temporary, mut file) = loop {
        let mut name = std::ffi::OsString::from(TEMPORARY_FILE_PREFIX);
        name.push(path.file_name().unwrap_or_default());
        name.push(format!("-{}", unique_file_suffix()));
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
    crate::services::storage::user_data::ensure_write_allowed(path)?;
    rename_retrying(&temporary.0, path)?;
    sync_parent(path)?;
    crate::services::storage::watcher::written(path, raw);
    Ok(())
}

/// How long a rename is retried while another program holds the file.
const RENAME_RETRY_DELAYS_MS: [u64; 7] = [20, 40, 80, 160, 320, 500, 800];

/// Renames `from` over `to`. On Windows a sync tool (Dropbox, OneDrive) or a
/// virus scanner may hold the file open for a moment, which fails the rename
/// with a sharing violation; it is retried for about two seconds.
pub(crate) fn rename_retrying(from: &Path, to: &Path) -> std::io::Result<()> {
    retry_transient(
        || fs::rename(from, to),
        is_transient_rename_error,
        std::thread::sleep,
    )
}

fn retry_transient<T>(
    mut attempt: impl FnMut() -> std::io::Result<T>,
    is_transient: impl Fn(&std::io::Error) -> bool,
    mut sleep: impl FnMut(Duration),
) -> std::io::Result<T> {
    for delay in RENAME_RETRY_DELAYS_MS {
        match attempt() {
            Err(error) if is_transient(&error) => sleep(Duration::from_millis(delay)),
            result => return result,
        }
    }
    attempt()
}

/// `ERROR_ACCESS_DENIED` and `ERROR_SHARING_VIOLATION`, which a file held
/// open by another program gives on Windows.
fn is_transient_rename_error(error: &std::io::Error) -> bool {
    cfg!(windows) && matches!(error.raw_os_error(), Some(5 | 32))
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
    crate::services::storage::user_data::ensure_write_allowed(path)?;
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
    crate::services::storage::user_data::ensure_write_allowed(path)?;
    let stamp = crate::services::clock::now_ns();
    let target = loop {
        let target = copy_path(
            path,
            &format!("{BROKEN_COPY_MARKER}{stamp}-{}", unique_file_suffix()),
        )?;
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
    if let Err(error) = move_file(path, &target) {
        let _ = fs::remove_file(&target);
        return Err(error);
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

/// Moves a file into the recovery folder, which may be on another disk:
/// then it is copied and removed.
fn move_file(from: &Path, to: &Path) -> Result<(), AppError> {
    match fs::rename(from, to) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::CrossesDevices => {
            fs::copy(from, to)?;
            fs::remove_file(from)?;
            Ok(())
        }
        Err(error) => Err(error.into()),
    }
}

/// The copies of `path` kept aside under `marker`, see [`prune_copies`].
pub fn kept_copies(path: &Path, marker: &str) -> Result<Vec<PathBuf>, AppError> {
    let (dir, name) = copy_location(path);
    let prefix = format!("{}{marker}", name.to_string_lossy());
    let entries = match fs::read_dir(if dir.as_os_str().is_empty() {
        Path::new(".")
    } else {
        &dir
    }) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    let mut copies = Vec::new();
    for entry in entries {
        let entry = entry?;
        if entry.file_name().to_string_lossy().starts_with(&prefix) {
            copies.push(entry.path());
        }
    }
    Ok(copies)
}

/// Removes every broken copy of `path`, e.g. when the user clears the history.
pub fn remove_broken_copies(path: &Path) -> Result<(), AppError> {
    for copy in kept_copies(path, BROKEN_COPY_MARKER)? {
        match fs::remove_file(copy) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

/// Deletes all but the `keep` newest copies of `path`: the files of its copy
/// folder named after it with `marker` and a suffix.
pub fn prune_copies(path: &Path, marker: &str, keep: usize) -> Result<(), AppError> {
    let mut copies = Vec::new();
    for copy in kept_copies(path, marker)? {
        let modified = fs::metadata(&copy)?.modified()?;
        copies.push((modified, copy));
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
    preserve_copy(path, BROKEN_COPY_MARKER, raw)
}

/// Keeps `raw` next to `path`, named with `marker` and the content digest, so
/// that the same content is kept once; only the newest copies stay.
pub fn preserve_copy(path: &Path, marker: &str, raw: &[u8]) -> Result<PathBuf, AppError> {
    let target = copy_path(
        path,
        &format!("{marker}{}", crate::services::sha256::sha256_hex(raw)),
    )?;
    if !target.exists() {
        write_private_bytes(&target, raw)?;
        prune_copies(path, marker, KEPT_COPY_COUNT)?;
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
        assert_eq!(fs::read_dir(&*dir).unwrap().count(), 1);
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
    fn copies_of_a_registered_root_go_to_its_recovery_folder() {
        let dir = TestDir::new("recovery-root");
        let root = dir.join("user");
        let recovery = dir.join("state/recovery/user");
        fs::create_dir_all(root.join("history")).unwrap();
        register_recovery_root(&root, &recovery);
        let path = root.join("history/device.jsonl");
        fs::write(&path, "broken").unwrap();

        let copy = preserve_broken_copy(&path, b"broken").unwrap();
        assert!(copy.starts_with(recovery.join("history")));
        let moved = quarantine(&path).unwrap();
        assert!(moved.starts_with(recovery.join("history")));
        assert_eq!(fs::read_to_string(&moved).unwrap(), "broken");
        assert_eq!(fs::read_dir(root.join("history")).unwrap().count(), 0);
        assert_eq!(kept_copies(&path, BROKEN_COPY_MARKER).unwrap().len(), 2);
        remove_broken_copies(&path).unwrap();
        assert!(kept_copies(&path, BROKEN_COPY_MARKER).unwrap().is_empty());
    }

    #[test]
    fn the_longest_recovery_root_wins() {
        let roots = vec![
            (PathBuf::from("/a"), PathBuf::from("/r/a")),
            (PathBuf::from("/a/b"), PathBuf::from("/r/b")),
        ];
        assert_eq!(
            recovery_dir_of(Path::new("/a/b/c/file"), &roots),
            Some(PathBuf::from("/r/b/c"))
        );
        assert_eq!(
            recovery_dir_of(Path::new("/a/file"), &roots),
            Some(PathBuf::from("/r/a"))
        );
        assert_eq!(recovery_dir_of(Path::new("/other/file"), &roots), None);
    }

    #[test]
    fn a_transient_rename_failure_is_retried_until_it_passes() {
        let mut attempts = 0;
        let mut slept = Duration::ZERO;
        let result = retry_transient(
            || {
                attempts += 1;
                if attempts < 3 {
                    Err(std::io::Error::from_raw_os_error(32))
                } else {
                    Ok(attempts)
                }
            },
            |error| error.raw_os_error() == Some(32),
            |delay| slept += delay,
        );
        assert_eq!(result.unwrap(), 3);
        assert_eq!(slept, Duration::from_millis(60));

        let mut attempts = 0;
        let mut slept = Duration::ZERO;
        let result: std::io::Result<()> = retry_transient(
            || {
                attempts += 1;
                Err(std::io::Error::from_raw_os_error(32))
            },
            |_| true,
            |delay| slept += delay,
        );
        assert!(result.is_err());
        assert_eq!(attempts, RENAME_RETRY_DELAYS_MS.len() + 1);
        assert!(slept <= Duration::from_millis(2_000));

        let mut attempts = 0;
        let _: std::io::Result<()> = retry_transient(
            || {
                attempts += 1;
                Err(std::io::Error::other("permanent"))
            },
            |_| false,
            |_| {},
        );
        assert_eq!(attempts, 1);
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
