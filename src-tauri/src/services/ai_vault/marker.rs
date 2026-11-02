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
/// The folders a vault made before its marker holds.
const VAULT_DIRS: [&str; 2] = ["profiles", "projects"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Marker {
    format_version: u32,
    vault_id: String,
}

/// A vault that can be used: its folder and its id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Vault {
    pub root: PathBuf,
    pub id: String,
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

fn write_marker(dir: &Path) -> Result<Marker, AppError> {
    let marker = Marker {
        format_version: VAULT_FORMAT_VERSION,
        vault_id: crate::services::random_id::new_uuid(),
    };
    write_private(
        &dir.join(VAULT_MARKER_FILE),
        &serde_json::to_string_pretty(&marker)?,
    )?;
    Ok(marker)
}

/// Whether `dir` holds a vault made before the marker: its folders are there.
fn is_unmarked_vault(dir: &Path) -> bool {
    VAULT_DIRS.iter().any(|name| dir.join(name).is_dir())
}

/// The vault in the default place, `dir`, which the caller has created: it
/// gets its marker when it has none.
pub fn open_default(dir: &Path) -> Result<Vault, AppError> {
    if crate::services::storage::user_data::ensure_write_allowed(dir).is_err() {
        return open_read_only(dir);
    }
    fs::create_dir_all(dir)?;
    let marker = match read_marker(dir)? {
        Some(marker) => marker,
        None => write_marker(dir)?,
    };
    Ok(Vault {
        root: dir.to_path_buf(),
        id: marker.vault_id,
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
    })
}

/// The vault the user chose at `path`. It is used when its marker is there,
/// or when it holds a vault made before the marker, which then gets one; a
/// missing or empty folder is not connected, and nothing is made in it.
pub fn open_external(path: &Path, user_dir: Option<&Path>) -> Result<Vault, AppError> {
    check_external_path(path, user_dir)?;
    let not_connected = || {
        AppError::VaultUnavailable(format!(
            "The AI vault is not connected on this device: {}",
            path.display()
        ))
    };
    if !path.is_dir() {
        return Err(not_connected());
    }
    let marker = match read_marker(path)? {
        Some(marker) => marker,
        None if is_unmarked_vault(path) => write_marker(path)?,
        None => return Err(not_connected()),
    };
    Ok(Vault {
        root: path.to_path_buf(),
        id: marker.vault_id,
    })
}

/// A path the vault may be set to on this device: absolute, and not inside
/// the user data folder, where it would be the default vault in disguise.
pub fn check_external_path(path: &Path, user_dir: Option<&Path>) -> Result<(), AppError> {
    if !path.is_absolute() {
        return Err(AppError::InvalidInput(format!(
            "The AI vault path is not absolute: {}",
            path.display()
        )));
    }
    if let Some(user_dir) = user_dir {
        use crate::services::storage::data_root_relocation::normalized;
        if normalized(path).starts_with(normalized(user_dir)) {
            return Err(AppError::InvalidInput(format!(
                "The AI vault cannot be inside the data folder {}; leave its path empty to keep it there",
                user_dir.display()
            )));
        }
    }
    Ok(())
}

/// Gives the folder `dir`, where a vault has just been moved or made, its
/// marker when it has none.
pub fn ensure_marker(dir: &Path) -> Result<(), AppError> {
    if read_marker(dir)?.is_none() {
        write_marker(dir)?;
    }
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
    fn a_chosen_vault_that_is_not_there_is_not_made() {
        let dir = TestDir::new("vault-external-missing");
        let missing = dir.join("missing");
        assert!(matches!(
            open_external(&missing, None),
            Err(AppError::VaultUnavailable(_))
        ));
        assert!(!missing.exists());
        let empty = dir.join("empty");
        fs::create_dir(&empty).unwrap();
        assert!(matches!(
            open_external(&empty, None),
            Err(AppError::VaultUnavailable(_))
        ));
        assert_eq!(fs::read_dir(&empty).unwrap().count(), 0);
    }

    #[test]
    fn a_chosen_vault_is_known_by_its_marker_or_its_folders() {
        let dir = TestDir::new("vault-external");
        let marked = dir.join("marked");
        fs::create_dir(&marked).unwrap();
        ensure_marker(&marked).unwrap();
        let vault = open_external(&marked, None).unwrap();
        assert_eq!(open_external(&marked, None).unwrap().id, vault.id);

        let earlier = dir.join("earlier");
        fs::create_dir_all(earlier.join("profiles")).unwrap();
        let vault = open_external(&earlier, None).unwrap();
        assert!(earlier.join(VAULT_MARKER_FILE).is_file());
        assert_eq!(open_external(&earlier, None).unwrap().id, vault.id);
    }

    #[test]
    fn a_chosen_vault_inside_the_data_folder_or_relative_is_refused() {
        let dir = TestDir::new("vault-external-nested");
        let user = dir.join("user");
        fs::create_dir_all(user.join("notes/profiles")).unwrap();
        assert!(matches!(
            open_external(&user.join("notes"), Some(&user)),
            Err(AppError::InvalidInput(_))
        ));
        assert!(!user.join("notes").join(VAULT_MARKER_FILE).exists());
        assert!(matches!(
            open_external(Path::new("relative/vault"), None),
            Err(AppError::InvalidInput(_))
        ));
        // a folder next to the data folder is fine
        fs::create_dir_all(dir.join("user-vault/profiles")).unwrap();
        assert!(open_external(&dir.join("user-vault"), Some(&user)).is_ok());
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
            open_external(&dir, None),
            Err(AppError::VaultUnavailable(_))
        ));
    }
}
