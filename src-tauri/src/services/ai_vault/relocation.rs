//! Moving the vault to another folder, or pointing the app at one.

use serde::Serialize;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::errors::AppError;

/// The subfolder offered when the chosen folder holds files of its own.
pub const VAULT_SUBFOLDER_NAME: &str = "tyco-vault";

const VAULT_DIRS: [&str; 2] = ["profiles", "projects"];

/// What a folder the vault may go to holds.
#[derive(Debug, Clone, Serialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum VaultTargetKind {
    /// The vault is there already.
    Current,
    /// No folder or an empty one: the vault can be moved into it.
    Empty,
    /// Another vault: it can be used as it is.
    #[serde(rename_all = "camelCase")]
    Vault {
        profile_count: u32,
        project_count: u32,
    },
    /// Files of some other kind: the vault goes into a subfolder instead.
    #[serde(rename_all = "camelCase")]
    Occupied { subfolder_path: String },
    /// Inside the current vault, or around it.
    Nested,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct VaultTarget {
    pub path: String,
    /// The app data folder the vault is in by default.
    pub is_default: bool,
    pub contents: VaultTargetKind,
}

/// The absolute form of a path whose end may not exist yet.
fn normalized(path: &Path) -> PathBuf {
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

fn count_entries(dir: &Path, file: &str) -> u32 {
    fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter(|entry| entry.path().join(file).is_file())
                .count() as u32
        })
        .unwrap_or(0)
}

/// What `target` holds, as seen from the vault at `current`.
pub fn inspect_target(current: &Path, target: &Path) -> Result<VaultTargetKind, AppError> {
    if !target.is_absolute() {
        return Err(AppError::InvalidInput(format!(
            "The AI vault path is not absolute: {}",
            target.display()
        )));
    }
    let (current, target) = (normalized(current), normalized(target));
    if current == target {
        return Ok(VaultTargetKind::Current);
    }
    if target.starts_with(&current) || current.starts_with(&target) {
        return Ok(VaultTargetKind::Nested);
    }
    if !target.exists() {
        return Ok(VaultTargetKind::Empty);
    }
    if !target.is_dir() {
        return Err(AppError::InvalidInput(format!(
            "Not a folder: {}",
            target.display()
        )));
    }
    let names: Vec<_> = fs::read_dir(&target)?
        .filter_map(Result::ok)
        .map(|entry| entry.file_name())
        .collect();
    if names.is_empty() {
        return Ok(VaultTargetKind::Empty);
    }
    if VAULT_DIRS.iter().any(|dir| target.join(dir).is_dir()) {
        return Ok(VaultTargetKind::Vault {
            profile_count: count_entries(&target.join("profiles"), "profile.json"),
            project_count: count_entries(&target.join("projects"), "project.json"),
        });
    }
    Ok(VaultTargetKind::Occupied {
        subfolder_path: target
            .join(VAULT_SUBFOLDER_NAME)
            .to_string_lossy()
            .into_owned(),
    })
}

/// The caller excludes vault operations through the move, config commit and
/// rollback. Effects are injected so failures can be checked without Tauri.
pub(super) fn relocate_with(
    current: &Path,
    target: &Path,
    move_data: bool,
    commit: impl FnOnce() -> Result<(), AppError>,
) -> Result<(), AppError> {
    let moves = match inspect_target(current, target)? {
        VaultTargetKind::Current => false,
        VaultTargetKind::Empty => move_data,
        VaultTargetKind::Vault { .. } if !move_data => false,
        _ => {
            return Err(AppError::InvalidInput(format!(
                "The AI vault cannot go to {}",
                target.display()
            )))
        }
    };
    if moves {
        move_vault(current, target)?;
    }
    if let Err(error) = commit() {
        if moves {
            if let Err(rollback) = move_vault(target, current) {
                return Err(AppError::Failed(format!(
                    "Could not save the vault location: {error}; could not restore {} from {}: {rollback}. Data is retained at these locations for recovery",
                    current.display(), target.display()
                )));
            }
        }
        return Err(error);
    }
    Ok(())
}

/// Moves everything in the vault at `from` into the empty folder `to`.
/// A folder that cannot be renamed, e.g. on another disk, is copied, checked
/// and only then removed. On a failure the moved folders go back.
pub fn move_vault(from: &Path, to: &Path) -> Result<(), AppError> {
    match inspect_target(from, to)? {
        VaultTargetKind::Empty => {}
        VaultTargetKind::Current => return Ok(()),
        _ => {
            return Err(AppError::InvalidInput(format!(
                "The vault can only be moved into an empty folder: {}",
                to.display()
            )))
        }
    }
    fs::create_dir_all(to)?;
    let entries = match fs::read_dir(from) {
        Ok(entries) => entries.collect::<Result<Vec<_>, _>>()?,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };

    let mut moved: Vec<(PathBuf, PathBuf)> = Vec::new();
    for entry in entries {
        let source = entry.path();
        let destination = to.join(entry.file_name());
        if let Err(error) = move_entry(&source, &destination) {
            let mut rollback_errors = Vec::new();
            for (source, destination) in moved.iter().rev() {
                if let Err(back) = move_entry(destination, source) {
                    rollback_errors.push(format!(
                        "Could not move {} back to {}: {back}",
                        destination.display(),
                        source.display()
                    ));
                }
            }
            return Err(AppError::Failed(format!(
                "Could not move {}: {error}{}",
                source.display(),
                if rollback_errors.is_empty() {
                    String::new()
                } else {
                    format!("; rollback incomplete: {}", rollback_errors.join("; "))
                }
            )));
        }
        moved.push((source, destination));
    }
    Ok(())
}

fn move_entry(source: &Path, destination: &Path) -> Result<(), AppError> {
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
            "The vault entry was copied to {}, but {} could not be fully removed: {error}; the destination copy is retained for recovery",
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
                ".tyco-vault-move-{}",
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
                "Could not clean up vault staging directory {}: {error}",
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
        let result = relocate_with(&source, &destination, true, || {
            assert!(!source.join("data").exists());
            assert!(destination.join("data").exists());
            Err(AppError::Failed("Injected config failure".into()))
        });
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
        let error = relocate_with(&source, &destination, true, || {
            fs::write(source.join("new"), "external writer").unwrap();
            Err(AppError::Failed("Injected config failure".into()))
        })
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
            fs::read_to_string(source.join("new")).unwrap(),
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
