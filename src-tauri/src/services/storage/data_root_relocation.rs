//! Moving a root folder of data, the user data folder or the AI vault, to
//! another place. Each entry is renamed, or across disks copied, checked and
//! only then removed; when a step fails, the entries moved so far go back.
//! The caller decides which entries a root has, checks the target, and
//! commits the new location; a failed commit moves the entries back.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::errors::AppError;

/// The absolute form of a path whose end may not exist yet.
pub fn normalized(path: &Path) -> PathBuf {
    let mut existing = path.to_path_buf();
    let mut missing = Vec::new();
    while !existing.exists() {
        match (existing.file_name(), existing.parent()) {
            (Some(name), Some(parent)) => {
                missing.push(name.to_os_string());
                existing = parent.to_path_buf();
            }
            _ => return path.to_path_buf(),
        }
    }
    let base = fs::canonicalize(&existing).unwrap_or(existing);
    missing
        .iter()
        .rev()
        .fold(base, |path, name| path.join(name))
}

/// Whether one of the folders is the other or inside it.
pub fn is_nested(first: &Path, second: &Path) -> bool {
    let (first, second) = (normalized(first), normalized(second));
    first.starts_with(&second) || second.starts_with(&first)
}

/// What a relocation moves: the entries of `from` into `to`, those named by
/// `entries` or every one.
pub struct RootMove<'a> {
    pub from: &'a Path,
    pub to: &'a Path,
    pub entries: Option<&'a [&'a str]>,
}

/// Moves the root, then commits its new location. A failed commit moves the
/// entries back; when that fails too, the error names both places, where the
/// data is kept for recovery.
pub fn relocate_with(
    moves: Option<RootMove>,
    commit: impl FnOnce() -> Result<(), AppError>,
) -> Result<(), AppError> {
    let moved = match &moves {
        Some(root) => move_entries(root.from, root.to, root.entries)?,
        None => Vec::new(),
    };
    if let Err(error) = commit() {
        if let Err(rollback) = move_back(&moved) {
            let (from, to) = moves
                .as_ref()
                .map(|root| {
                    (
                        root.from.display().to_string(),
                        root.to.display().to_string(),
                    )
                })
                .unwrap_or_default();
            return Err(AppError::Failed(format!(
                "Could not save the new location: {error}; could not restore {from} from {to}: {rollback}. Data is retained at these locations for recovery"
            )));
        }
        return Err(error);
    }
    Ok(())
}

/// Moves the entries of `from` named by `entries`, or every one, into `to`,
/// which the caller has checked to be empty or missing. Returns what moved,
/// as pairs of source and destination. On a failure the moved entries go
/// back.
pub fn move_entries(
    from: &Path,
    to: &Path,
    entries: Option<&[&str]>,
) -> Result<Vec<(PathBuf, PathBuf)>, AppError> {
    fs::create_dir_all(to)?;
    let names: Vec<std::ffi::OsString> = match entries {
        Some(names) => names
            .iter()
            .map(std::ffi::OsString::from)
            .filter(|name| fs::symlink_metadata(from.join(name)).is_ok())
            .collect(),
        None => match fs::read_dir(from) {
            Ok(entries) => entries
                .map(|entry| entry.map(|entry| entry.file_name()))
                .collect::<Result<Vec<_>, _>>()?,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error.into()),
        },
    };

    let mut moved: Vec<(PathBuf, PathBuf)> = Vec::new();
    for name in names {
        let source = from.join(&name);
        let destination = to.join(&name);
        if let Err(error) = move_entry(&source, &destination) {
            let rollback = move_back(&moved);
            return Err(AppError::Failed(format!(
                "Could not move {}: {error}{}",
                source.display(),
                match rollback {
                    Ok(()) => String::new(),
                    Err(rollback) => format!("; rollback incomplete: {rollback}"),
                }
            )));
        }
        moved.push((source, destination));
    }
    Ok(moved)
}

/// Moves the entries `moved` back, the last first.
fn move_back(moved: &[(PathBuf, PathBuf)]) -> Result<(), String> {
    let mut errors = Vec::new();
    for (source, destination) in moved.iter().rev() {
        if let Err(error) = move_entry(destination, source) {
            errors.push(format!(
                "Could not move {} back to {}: {error}",
                destination.display(),
                source.display()
            ));
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

pub(crate) fn move_entry(source: &Path, destination: &Path) -> Result<(), AppError> {
    use crate::services::platform::filesystem::rename_path_no_replace;
    match rename_path_no_replace(source, destination) {
        Ok(()) => return Ok(()),
        Err(error) if error.kind() == io::ErrorKind::CrossesDevices => {}
        Err(error) => return Err(error.into()),
    }
    copy_move_entry(source, destination)
}

fn copy_move_entry(source: &Path, destination: &Path) -> Result<(), AppError> {
    use crate::services::platform::filesystem::rename_path_no_replace;
    // Stage the copy in a directory owned exclusively by this operation.
    // Never remove destination on failure: it may belong to another writer.
    let staging = StagingDirectory::create(
        destination
            .parent()
            .ok_or_else(|| AppError::InvalidInput("The destination has no parent".into()))?,
    )?;
    let payload = staging.0.join("entry");
    copy_tree(source, &payload)?;
    rename_path_no_replace(&payload, destination)?;
    crate::services::atomic_file::sync_parent(destination)?;
    if let Err(error) = remove_tree(source) {
        return Err(AppError::Failed(format!(
            "The entry was copied to {}, but {} could not be fully removed: {error}; the destination copy is retained for recovery",
            destination.display(), source.display()
        )));
    }
    crate::services::atomic_file::sync_parent(source)?;
    Ok(())
}

struct StagingDirectory(PathBuf);

impl StagingDirectory {
    fn create(parent: &Path) -> io::Result<Self> {
        loop {
            let path = parent.join(format!(
                ".tyco-move-{}",
                crate::services::atomic_file::unique_file_suffix()
            ));
            let mut builder = fs::DirBuilder::new();
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                builder.mode(0o700);
            }
            match builder.create(&path) {
                Ok(()) => return Ok(Self(path)),
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error),
            }
        }
    }
}

impl Drop for StagingDirectory {
    fn drop(&mut self) {
        if let Err(error) = fs::remove_dir_all(&self.0) {
            log::warn!(
                "Could not clean up the staging folder {}: {error}",
                self.0.display()
            );
        }
    }
}

fn remove_tree(path: &Path) -> io::Result<()> {
    if fs::symlink_metadata(path)?.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}

/// Copies a file or a folder; links are copied as links, every file is
/// checked to have its full size.
fn copy_tree(source: &Path, destination: &Path) -> Result<(), AppError> {
    let metadata = fs::symlink_metadata(source)?;
    let file_type = metadata.file_type();
    if file_type.is_symlink() {
        copy_link(source, destination)?;
    } else if file_type.is_dir() {
        fs::create_dir(destination)?;
        for entry in fs::read_dir(source)? {
            let entry = entry?;
            copy_tree(&entry.path(), &destination.join(entry.file_name()))?;
        }
        #[cfg(unix)]
        let directory = fs::File::open(destination)?;
        fs::set_permissions(destination, metadata.permissions())?;
        #[cfg(unix)]
        directory.sync_all()?;
    } else {
        if !file_type.is_file() {
            return Err(AppError::InvalidInput(format!(
                "Not a regular file: {}",
                source.display()
            )));
        }
        let mut input = fs::File::open(source)?;
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(destination)?;
        let copied = io::copy(&mut input, &mut output)?;
        if copied != metadata.len() {
            return Err(AppError::Failed(format!(
                "{} was copied incompletely",
                source.display()
            )));
        }
        output.set_permissions(metadata.permissions())?;
        output.sync_all()?;
    }
    Ok(())
}

#[cfg(unix)]
fn copy_link(source: &Path, destination: &Path) -> io::Result<()> {
    std::os::unix::fs::symlink(fs::read_link(source)?, destination)
}

#[cfg(windows)]
fn copy_link(source: &Path, destination: &Path) -> io::Result<()> {
    let target = fs::read_link(source)?;
    if fs::metadata(source).map(|m| m.is_dir()).unwrap_or(false) {
        std::os::windows::fs::symlink_dir(target, destination)
    } else {
        std::os::windows::fs::symlink_file(target, destination)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::test_support::TestDir;

    #[test]
    fn failed_moves_never_remove_an_existing_destination() {
        let root = TestDir::new("vault-existing-destination");
        let source = root.join("source");
        let destination = root.join("destination");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&destination).unwrap();
        fs::write(source.join("source.txt"), "source").unwrap();
        fs::write(destination.join("keep.txt"), "valuable").unwrap();
        assert!(move_entry(&source, &destination).is_err());
        // Exercise the cross-device branch without requiring another mount.
        assert!(copy_move_entry(&source, &destination).is_err());
        assert_eq!(
            fs::read_to_string(destination.join("keep.txt")).unwrap(),
            "valuable"
        );
        assert_eq!(
            fs::read_to_string(source.join("source.txt")).unwrap(),
            "source"
        );
        assert_eq!(fs::read_dir(&root).unwrap().count(), 2);
    }

    #[test]
    fn failed_config_commit_restores_the_original_vault() {
        let root = TestDir::new("vault-config-rollback");
        let source = root.join("source");
        let destination = root.join("destination");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("data"), "original").unwrap();
        let result = relocate_with(
            Some(RootMove {
                from: &source,
                to: &destination,
                entries: None,
            }),
            || {
                assert!(!source.join("data").exists());
                assert!(destination.join("data").exists());
                Err(AppError::Failed("Injected config failure".into()))
            },
        );
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Injected config failure"));
        assert_eq!(fs::read_to_string(source.join("data")).unwrap(), "original");
        assert!(!destination.join("data").exists());
    }

    #[test]
    fn failed_rollback_reports_both_locations_without_removing_new_files() {
        let root = TestDir::new("vault-config-rollback-conflict");
        let source = root.join("source");
        let destination = root.join("destination");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("data"), "original").unwrap();
        let error = relocate_with(
            Some(RootMove {
                from: &source,
                to: &destination,
                entries: None,
            }),
            || {
                // another writer takes the name the entry would go back to
                fs::write(source.join("data"), "external writer").unwrap();
                Err(AppError::Failed("Injected config failure".into()))
            },
        )
        .unwrap_err()
        .to_string();
        assert!(error.contains("could not restore"));
        assert!(error.contains(source.to_str().unwrap()));
        assert!(error.contains(destination.to_str().unwrap()));
        assert_eq!(
            fs::read_to_string(destination.join("data")).unwrap(),
            "original"
        );
        assert_eq!(
            fs::read_to_string(source.join("data")).unwrap(),
            "external writer"
        );
    }

    #[cfg(unix)]
    #[test]
    fn copying_readonly_folders_populates_them_before_restoring_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let root = TestDir::new("vault-readonly-copy");
        let source = root.join("source");
        let destination = root.join("destination");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("data"), "original").unwrap();
        fs::set_permissions(&source, fs::Permissions::from_mode(0o555)).unwrap();
        let result = copy_tree(&source, &destination);
        // Restore write access before assertions so the fixture cleans up on failure.
        fs::set_permissions(&source, fs::Permissions::from_mode(0o755)).unwrap();
        let mode = fs::metadata(&destination).unwrap().permissions().mode() & 0o777;
        fs::set_permissions(&destination, fs::Permissions::from_mode(0o755)).unwrap();
        result.unwrap();
        assert_eq!(mode, 0o555);
        assert_eq!(
            fs::read_to_string(destination.join("data")).unwrap(),
            "original"
        );
    }

    #[test]
    fn only_the_named_entries_move() {
        let root = TestDir::new("root-named-entries");
        let source = root.join("source");
        let destination = root.join("destination");
        fs::create_dir_all(source.join("chats")).unwrap();
        fs::write(source.join("config.json"), "{}").unwrap();
        fs::write(source.join("other.txt"), "stays").unwrap();
        let moved = move_entries(
            &source,
            &destination,
            Some(&["config.json", "chats", "missing"]),
        )
        .unwrap();
        assert_eq!(moved.len(), 2);
        assert!(destination.join("config.json").is_file());
        assert!(destination.join("chats").is_dir());
        assert!(source.join("other.txt").is_file());
        assert!(!destination.join("other.txt").exists());
    }

    #[test]
    fn nested_folders_are_told_apart_from_siblings() {
        let root = TestDir::new("root-nested");
        assert!(is_nested(&root.join("a"), &root.join("a/b")));
        assert!(is_nested(&root.join("a/b"), &root.join("a")));
        assert!(is_nested(&root.join("a"), &root.join("a")));
        assert!(!is_nested(&root.join("a"), &root.join("ab")));
    }

    #[test]
    fn completed_copy_move_keeps_bytes_and_removes_source() {
        let root = TestDir::new("vault-staged-copy");
        let source = root.join("source");
        let destination = root.join("destination");
        fs::write(&source, "original").unwrap();
        copy_move_entry(&source, &destination).unwrap();
        assert!(!source.exists());
        assert_eq!(fs::read_to_string(&destination).unwrap(), "original");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
    }
}
