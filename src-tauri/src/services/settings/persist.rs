//! The config file: read and repaired at startup, written by the saves.
mod backups;

use std::fs;
use std::path::Path;

use serde_json::Value;
use tauri::AppHandle;

use super::defaults::default_user_config;
use super::{schema, version};
use crate::errors::AppError;
use crate::models::CONFIG_FILE_NAME;
use crate::services::atomic_file::{read_or_quarantine, write_private};
use crate::services::storage::app_config_dir;
use backups::back_up_config_before_repair;

/// The user config the app starts with.
pub struct LoadedUserConfig {
    pub value: Value,
    /// Whether the file holds `value`. A repair that could not be written
    /// leaves the old file, whose references must not be cleaned up yet.
    pub is_on_disk: bool,
}

/// Reads the user config. A config that cannot be parsed is set aside and
/// replaced by the defaults: the app must start either way, and the user keeps
/// the broken file to fix it.
pub fn read_or_create_user_config(app: &AppHandle) -> Result<LoadedUserConfig, AppError> {
    load_user_config_at(&app_config_dir(app)?.join(CONFIG_FILE_NAME))
}

fn load_user_config_at(path: &Path) -> Result<LoadedUserConfig, AppError> {
    if let Some(mut value) = read_or_quarantine(path, |raw| {
        let value: Value = serde_json::from_str(raw)?;
        if value.is_object() {
            Ok(value)
        } else {
            Err(AppError::Message(String::from(
                "the config is not a mapping",
            )))
        }
    })? {
        // Never interpret or overwrite an unsupported future schema.
        if version::is_newer_than_supported(&value) {
            return Err(newer_config_error());
        }
        let original = value.clone();
        let changed = schema::normalize_user_config(&mut value);
        // the app starts with the config in memory either way; the next
        // save writes it
        let is_on_disk = !changed
            || match back_up_config_before_repair(path, &original) {
                // the snapshot is taken: writing must not take another one
                Ok(()) => match write_user_config(path, &value, false) {
                    Ok(()) => true,
                    Err(error) => {
                        log::error!("Could not save the updated config: {error}");
                        false
                    }
                },
                Err(error) => {
                    log::error!("Could not back up config before repair: {error}");
                    false
                }
            };
        return Ok(LoadedUserConfig { value, is_on_disk });
    }

    let default_config = default_user_config();
    let is_on_disk = match write_user_config(path, &default_config, true) {
        Ok(()) => true,
        Err(error) => {
            log::error!("Could not save the default config: {error}");
            false
        }
    };
    Ok(LoadedUserConfig {
        value: default_config,
        is_on_disk,
    })
}

/// Writes `user_config`, which the caller has validated: the settings
/// service before it applies a change, the startup by normalizing it. A file
/// a newer Tyco wrote meanwhile is left alone.
pub fn save_user_config(app: &AppHandle, user_config: &Value) -> Result<(), AppError> {
    write_user_config(
        &app_config_dir(app)?.join(CONFIG_FILE_NAME),
        user_config,
        true,
    )
}

/// Writes the config; `should_back_up_invalid` keeps a snapshot of a file on
/// the disk that does not pass the schema, unless the caller has just taken one.
fn write_user_config(
    path: &Path,
    user_config: &Value,
    should_back_up_invalid: bool,
) -> Result<(), AppError> {
    debug_assert!(schema::validate_user_config(user_config).is_ok());
    let previous = match fs::read_to_string(path) {
        Ok(raw) => Some(raw),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.into()),
    };
    if let Some(raw) = previous {
        let original: Value = serde_json::from_str(&raw)?;
        if version::is_newer_than_supported(&original) {
            return Err(newer_config_error());
        }
        if should_back_up_invalid && schema::validate_user_config(&original).is_err() {
            back_up_config_before_repair(path, &original)?;
        }
    }
    write_json(path, user_config)
}

fn write_json(path: &Path, value: &Value) -> Result<(), AppError> {
    write_private(path, &serde_json::to_string_pretty(value)?)
}

pub fn newer_config_error() -> AppError {
    AppError::UnsupportedConfig(String::from(
        "The config was written by a newer version of Tyco; update Tyco to open this configuration",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::test_support::TestDir;

    fn snapshot_count(dir: &Path) -> usize {
        fs::read_dir(dir)
            .unwrap()
            .filter(|entry| {
                entry
                    .as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .contains(".repaired-")
            })
            .count()
    }

    #[test]
    fn a_startup_repair_keeps_one_snapshot() {
        let dir = TestDir::new("config-repair-snapshot");
        let path = dir.join(CONFIG_FILE_NAME);
        fs::write(&path, r#"{"appearance":{"theme":"sepia"},"unknown":1}"#).unwrap();

        let loaded = load_user_config_at(&path).unwrap();

        assert!(loaded.is_on_disk);
        assert_eq!(snapshot_count(&dir), 1);
        let saved: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(saved, loaded.value);
        // a valid config is read as it is
        load_user_config_at(&path).unwrap();
        assert_eq!(snapshot_count(&dir), 1);
    }

    #[test]
    fn a_missing_config_is_created_from_the_defaults() {
        let dir = TestDir::new("config-create");
        let path = dir.join(CONFIG_FILE_NAME);
        let loaded = load_user_config_at(&path).unwrap();
        assert_eq!(loaded.value, default_user_config());
        assert!(path.is_file());
        assert_eq!(snapshot_count(&dir), 0);
    }

    #[test]
    fn a_newer_config_is_left_alone() {
        let dir = TestDir::new("config-newer");
        let path = dir.join(CONFIG_FILE_NAME);
        let raw = format!(r#"{{"configVersion":{}}}"#, version::CONFIG_VERSION + 1);
        fs::write(&path, &raw).unwrap();
        assert!(load_user_config_at(&path).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), raw);
    }

    #[test]
    fn missing_sections_come_from_the_defaults() {
        let defaults = default_user_config();
        let mut config = serde_json::json!({});
        assert!(schema::normalize_user_config(&mut config));
        assert_eq!(config, defaults);
        assert!(!schema::normalize_user_config(&mut config));
    }
}
