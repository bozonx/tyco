//! The marker of a vault, `tyco-vault.json`: the version of its layout and
//! an id made once, which keeps the device values of one vault (the folders
//! of its external projects) apart from those of another.
//!
//! A vault in the default place, inside the user data folder, is made when it
//! is not there. One the user chose elsewhere is used only when it is there:
//! a disk not mounted, or a folder another machine has not got yet, must not
//! be replaced by an empty vault that a sync would then spread.
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::errors::AppError;
use crate::services::atomic_file::write_private;

pub const VAULT_MARKER_FILE: &str = "tyco-vault.json";
/// The layout of the vault this build knows.
pub const VAULT_FORMAT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Marker {
    format_version: u32,
    vault_id: String,
    /// The name the user gave an attached vault, the same on every device.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    name: Option<String>,
}

/// A vault that can be used: its folder and its id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Vault {
    pub root: PathBuf,
    pub id: String,
    /// The name of an attached vault; none for the main one.
    pub name: Option<String>,
}

fn read_marker(dir: &Path) -> Result<Option<Marker>, AppError> {
    match fs::read_to_string(dir.join(VAULT_MARKER_FILE)) {
        Ok(raw) => {
            let marker: Marker = serde_json::from_str(&raw).map_err(|error| {
                AppError::VaultUnavailable(format!(
                    "The marker of the AI vault {} is unreadable: {error}",
                    dir.display()
                ))
            })?;
            if marker.format_version > VAULT_FORMAT_VERSION || marker.vault_id.trim().is_empty() {
                return Err(AppError::VaultUnavailable(format!(
                    "The AI vault {} was laid out by a newer version of Tyco",
                    dir.display()
                )));
            }
            Ok(Some(marker))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn write_marker_with_id(dir: &Path, vault_id: String) -> Result<Marker, AppError> {
    write_marker_with(dir, vault_id, None)
}

fn write_marker_with(
    dir: &Path,
    vault_id: String,
    name: Option<String>,
) -> Result<Marker, AppError> {
    let marker = Marker {
        format_version: VAULT_FORMAT_VERSION,
        vault_id,
        name,
    };
    write_private(
        &dir.join(VAULT_MARKER_FILE),
        &serde_json::to_string_pretty(&marker)?,
    )?;
    Ok(marker)
}

/// The id of the vault in the default place `dir`, inside the data folder:
/// made from the id of that folder, so every device that finds the vault
/// without its marker, e.g. before a sync has brought it, writes the same
/// file and no conflicting copy with another id comes up.
fn default_vault_id(dir: &Path) -> String {
    dir.parent()
        .and_then(crate::services::storage::user_data::marker_data_id)
        .map_or_else(|| "default".to_owned(), |id| format!("data-{id}"))
}

/// The vault in the default place, `dir`, which the caller has created: it
/// gets its marker when it has none, see [`default_vault_id`].
pub fn open_default(dir: &Path) -> Result<Vault, AppError> {
    if crate::services::storage::user_data::ensure_write_allowed(dir).is_err() {
        return open_read_only(dir);
    }
    fs::create_dir_all(dir)?;
    let marker = match read_marker(dir)? {
        Some(marker) => marker,
        None => write_marker_with_id(dir, default_vault_id(dir))?,
    };
    Ok(Vault {
        root: dir.to_path_buf(),
        id: marker.vault_id,
        name: None,
    })
}

/// Opens existing vault data without creating directories or a marker.
pub fn open_read_only(dir: &Path) -> Result<Vault, AppError> {
    crate::services::storage::user_data::ensure_read_allowed(dir)?;
    let marker = read_marker(dir)?.ok_or_else(|| {
        AppError::VaultUnavailable(format!("The AI vault is not connected: {}", dir.display()))
    })?;
    Ok(Vault {
        root: dir.to_owned(),
        id: marker.vault_id,
        name: None,
    })
}

/// Opens an attached vault only when its marker exists, without creating
/// files: a disk not mounted, or a folder a sync has not brought yet, is "not
/// connected", never replaced by an empty vault.
pub fn open_attached(path: &Path) -> Result<Vault, AppError> {
    let not_connected = || {
        AppError::VaultUnavailable(format!(
            "The AI vault is not connected on this device: {}",
            path.display()
        ))
    };
    if !path.is_absolute() || !path.is_dir() {
        return Err(not_connected());
    }
    let marker = read_marker(path)?.ok_or_else(not_connected)?;
    Ok(Vault {
        root: path.to_path_buf(),
        id: marker.vault_id,
        name: marker.name,
    })
}

/// What a folder offered as a vault to attach holds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AttachTarget {
    /// A vault already: its marker is there.
    Vault(Vault),
    /// Missing or empty: a new vault is made there.
    Empty,
    /// Other files: a subfolder is offered instead.
    Occupied,
}

/// What `path` holds, read without creating anything.
pub fn inspect_attach_target(path: &Path) -> Result<AttachTarget, AppError> {
    if !path.is_absolute() {
        return Err(AppError::InvalidInput(format!(
            "The AI vault path is not absolute: {}",
            path.display()
        )));
    }
    if read_marker(path)?.is_some() {
        return open_attached(path).map(AttachTarget::Vault);
    }
    match fs::read_dir(path) {
        Ok(mut entries) => Ok(if entries.next().is_none() {
            AttachTarget::Empty
        } else {
            AttachTarget::Occupied
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(AttachTarget::Empty),
        Err(error) => Err(error.into()),
    }
}

/// Makes a new vault in the empty folder `path`: a random id and `name`.
pub fn create_attached(path: &Path, name: &str) -> Result<Vault, AppError> {
    if inspect_attach_target(path)? != AttachTarget::Empty {
        return Err(AppError::InvalidInput(format!(
            "A new AI vault needs an empty folder: {}",
            path.display()
        )));
    }
    fs::create_dir_all(path)?;
    let name = Some(name.trim().to_owned()).filter(|name| !name.is_empty());
    let marker = write_marker_with(path, crate::services::random_id::new_uuid(), name)?;
    Ok(Vault {
        root: path.to_path_buf(),
        id: marker.vault_id,
        name: marker.name,
    })
}

/// Renames an attached vault on every device: its marker holds the name.
pub fn rename_attached(path: &Path, name: &str) -> Result<(), AppError> {
    let marker = read_marker(path)?.ok_or_else(|| {
        AppError::VaultUnavailable(format!(
            "The AI vault is not connected on this device: {}",
            path.display()
        ))
    })?;
    let name = Some(name.trim().to_owned()).filter(|name| !name.is_empty());
    write_marker_with(path, marker.vault_id, name)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::test_support::TestDir;

    #[test]
    fn the_default_vault_is_made_and_keeps_its_id() {
        let dir = TestDir::new("vault-default");
        let root = dir.join("ai-vault");
        let vault = open_default(&root).unwrap();
        assert!(root.join(VAULT_MARKER_FILE).is_file());
        assert_eq!(open_default(&root).unwrap(), vault);
    }

    #[test]
    fn every_device_gives_the_default_vault_the_same_marker() {
        let first = TestDir::new("vault-default-first");
        crate::services::storage::user_data::write_marker(&first).unwrap();
        let second = TestDir::new("vault-default-second");
        fs::copy(first.join("tyco-user.json"), second.join("tyco-user.json")).unwrap();
        let data_id = crate::services::storage::user_data::marker_data_id(&first).unwrap();

        let vault = open_default(&first.join("ai-vault")).unwrap();
        assert_eq!(vault.id, format!("data-{data_id}"));
        open_default(&second.join("ai-vault")).unwrap();
        assert_eq!(
            fs::read(first.join("ai-vault").join(VAULT_MARKER_FILE)).unwrap(),
            fs::read(second.join("ai-vault").join(VAULT_MARKER_FILE)).unwrap()
        );

        // another data folder gets another id
        let other = TestDir::new("vault-default-other");
        crate::services::storage::user_data::write_marker(&other).unwrap();
        assert_ne!(open_default(&other.join("ai-vault")).unwrap().id, vault.id);
        // a marker made before the id still gives one id on every device
        let old = TestDir::new("vault-default-old");
        fs::write(old.join("tyco-user.json"), r#"{"formatVersion":1}"#).unwrap();
        assert_eq!(open_default(&old.join("ai-vault")).unwrap().id, "default");
    }

    #[test]
    fn a_read_only_default_vault_is_opened_without_creating_anything() {
        let dir = TestDir::new("vault-read-only");
        let vault = open_default(&dir.join("ai-vault")).unwrap();
        fs::write(dir.join("tyco-user.json"), r#"{"formatVersion":2}"#).unwrap();
        let data = crate::services::storage::user_data::UserData::resolve(&dir, "");
        crate::services::storage::user_data::register_write_guard(&data);
        assert_eq!(open_default(&vault.root).unwrap(), vault);
        assert!(!vault.root.join("profiles").exists());
        assert!(open_default(&dir.join("missing")).is_err());
        assert!(!dir.join("missing").exists());
    }

    #[test]
    fn an_attached_vault_that_is_not_there_is_not_made() {
        let dir = TestDir::new("vault-attached-missing");
        let missing = dir.join("missing");
        assert!(matches!(
            open_attached(&missing),
            Err(AppError::VaultUnavailable(_))
        ));
        assert!(!missing.exists());
        let empty = dir.join("empty");
        fs::create_dir(&empty).unwrap();
        assert!(matches!(
            open_attached(&empty),
            Err(AppError::VaultUnavailable(_))
        ));
        assert_eq!(fs::read_dir(&empty).unwrap().count(), 0);
    }

    #[test]
    fn a_folder_to_attach_is_a_vault_empty_or_occupied() {
        let dir = TestDir::new("vault-attach-target");
        assert_eq!(
            inspect_attach_target(&dir.join("new")).unwrap(),
            AttachTarget::Empty
        );
        let vault = create_attached(&dir.join("new"), " Work ").unwrap();
        assert_eq!(vault.name.as_deref(), Some("Work"));
        assert_eq!(
            inspect_attach_target(&dir.join("new")).unwrap(),
            AttachTarget::Vault(vault.clone())
        );
        // another vault gets another id
        let other = create_attached(&dir.join("other"), "").unwrap();
        assert_ne!(other.id, vault.id);
        assert_eq!(other.name, None);

        fs::create_dir_all(dir.join("notes")).unwrap();
        fs::write(dir.join("notes/todo.md"), "x").unwrap();
        assert_eq!(
            inspect_attach_target(&dir.join("notes")).unwrap(),
            AttachTarget::Occupied
        );
        assert!(create_attached(&dir.join("notes"), "x").is_err());
        assert!(inspect_attach_target(Path::new("relative")).is_err());

        rename_attached(&vault.root, "Office").unwrap();
        let renamed = open_attached(&vault.root).unwrap();
        assert_eq!(
            (renamed.id, renamed.name.as_deref()),
            (vault.id, Some("Office"))
        );
    }

    #[test]
    fn a_vault_of_a_newer_layout_is_refused() {
        let dir = TestDir::new("vault-newer");
        fs::write(
            dir.join(VAULT_MARKER_FILE),
            format!(
                r#"{{"formatVersion":{},"vaultId":"x"}}"#,
                VAULT_FORMAT_VERSION + 1
            ),
        )
        .unwrap();
        assert!(matches!(
            open_attached(&dir),
            Err(AppError::VaultUnavailable(_))
        ));
    }
}
