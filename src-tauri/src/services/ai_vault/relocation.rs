//! Moving the vault to another folder, or pointing the app at one.

use serde::Serialize;
use std::fs;
use std::path::Path;

use crate::errors::AppError;
use crate::services::storage::data_root_relocation::{
    normalized, relocate_with as relocate_root, RootMove,
};

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
    if VAULT_DIRS.iter().any(|dir| target.join(dir).is_dir())
        || target.join(super::marker::VAULT_MARKER_FILE).is_file()
    {
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
    relocate_root(
        moves.then_some(RootMove {
            from: current,
            to: target,
            entries: None,
        }),
        commit,
    )
}

/// Moves everything in the vault at `from` into the empty folder `to`.
/// A folder that cannot be renamed, e.g. on another disk, is copied, checked
/// and only then removed. On a failure the moved folders go back.
#[cfg(test)]
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
    crate::services::storage::data_root_relocation::move_entries(from, to, None).map(|_| ())
}
