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
            for (source, destination) in moved.iter().rev() {
                if let Err(back) = move_entry(destination, source) {
                    log::error!(
                        "Could not move {} back to {}: {back}",
                        destination.display(),
                        source.display()
                    );
                }
            }
            return Err(AppError::Failed(format!(
                "Could not move {}: {error}",
                source.display()
            )));
        }
        moved.push((source, destination));
    }
    Ok(())
}

fn move_entry(source: &Path, destination: &Path) -> Result<(), AppError> {
    if fs::rename(source, destination).is_ok() {
        return Ok(());
    }
    if let Err(error) = copy_tree(source, destination) {
        let _ = remove_tree(destination);
        return Err(error);
    }
    // the copy is complete: leftovers of the source only take up space
    if let Err(error) = remove_tree(source) {
        log::warn!(
            "The vault was copied, but {} could not be removed: {error}",
            source.display()
        );
    }
    Ok(())
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
        fs::set_permissions(destination, metadata.permissions())?;
        for entry in fs::read_dir(source)? {
            let entry = entry?;
            copy_tree(&entry.path(), &destination.join(entry.file_name()))?;
        }
    } else {
        let copied = fs::copy(source, destination)?;
        if copied != metadata.len() {
            return Err(AppError::Failed(format!(
                "{} was copied incompletely",
                source.display()
            )));
        }
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
