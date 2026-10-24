//! The config file: read and repaired at startup, written by the saves.
use std::fs;
use std::path::Path;

use serde_json::Value;
use tauri::AppHandle;

use super::defaults::default_user_config;
use super::{schema, version};
use crate::errors::AppError;
use crate::models::CONFIG_FILE_NAME;
use crate::services::atomic_file::{
    preserve_broken_copy, preserve_copy, read_or_quarantine, write_private,
};
use crate::services::storage::app_config_dir;

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
            Err(AppError::InvalidData(String::from(
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
        // A repair that drops or replaces a value keeps the file it read, so
        // that a bug in the repair never loses the settings for good.
        if changed && !keeps_every_value(&original, &value) {
            match serde_json::to_string_pretty(&original)
                .map_err(AppError::from)
                .and_then(|raw| preserve_copy(path, REPAIRED_COPY_MARKER, raw.as_bytes()))
            {
                Ok(copy) => log::warn!(
                    "Repaired the config; kept the previous one at {}",
                    copy.display()
                ),
                Err(error) => log::error!("Could not keep the config before a repair: {error}"),
            }
        }
        // the app starts with the config in memory either way; the next
        // save writes it
        let is_on_disk = !changed
            || match write_user_config(path, &value) {
                Ok(()) => true,
                Err(error) => {
                    log::error!("Could not save the updated config: {error}");
                    false
                }
            };
        return Ok(LoadedUserConfig { value, is_on_disk });
    }

    let default_config = default_user_config();
    let is_on_disk = match write_user_config(path, &default_config) {
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

/// What the name of a config kept before a repair adds to the file name.
const REPAIRED_COPY_MARKER: &str = ".repaired-";

/// Whether `repaired` still holds every value of `original`, so that the
/// repair only added fields or stamped the version.
fn keeps_every_value(original: &Value, repaired: &Value) -> bool {
    match (original, repaired) {
        (Value::Object(original), Value::Object(repaired)) => {
            original.iter().all(|(key, value)| {
                key == version::CONFIG_VERSION_KEY
                    || repaired
                        .get(key)
                        .is_some_and(|kept| keeps_every_value(value, kept))
            })
        }
        (Value::Array(original), Value::Array(repaired)) => {
            original.len() == repaired.len()
                && original
                    .iter()
                    .zip(repaired)
                    .all(|(value, kept)| keeps_every_value(value, kept))
        }
        _ => original == repaired,
    }
}

/// Writes `user_config`, which the caller has validated: the settings
/// service before it applies a change, the startup by normalizing it. A file
/// a newer Tyco wrote meanwhile is left alone.
pub fn save_user_config(app: &AppHandle, user_config: &Value) -> Result<(), AppError> {
    write_user_config(&app_config_dir(app)?.join(CONFIG_FILE_NAME), user_config)
}

/// Writes the config unless a newer Tyco wrote the file on the disk. Edits
/// made by hand are not kept: the file belongs to the app. A file broken
/// meanwhile, e.g. by a hand edit, is kept aside and replaced: the config in
/// memory is valid, and refusing every save, rollbacks included, would not
/// get the file fixed.
fn write_user_config(path: &Path, user_config: &Value) -> Result<(), AppError> {
    debug_assert!(schema::validate_user_config(user_config).is_ok());
    let previous = match fs::read(path) {
        Ok(raw) => Some(raw),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.into()),
    };
    if let Some(raw) = previous {
        match serde_json::from_slice::<Value>(&raw) {
            Ok(original) if version::is_newer_than_supported(&original) => {
                return Err(newer_config_error());
            }
            Ok(_) => {}
            Err(error) => {
                let copy = preserve_broken_copy(path, &raw)?;
                log::warn!(
                    "The config on the disk is unreadable ({error}); kept it at {} and wrote the current one",
                    copy.display()
                );
            }
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
    use serde_json::json;

    #[test]
    fn a_lossy_startup_repair_keeps_the_previous_file() {
        let dir = TestDir::new("config-repair");
        let path = dir.join(CONFIG_FILE_NAME);
        let broken = json!({"appearance":{"theme":"sepia"},"unknown":1});
        fs::write(&path, broken.to_string()).unwrap();

        let loaded = load_user_config_at(&path).unwrap();

        assert!(loaded.is_on_disk);
        let saved: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(saved, loaded.value);
        let copies: Vec<_> = fs::read_dir(&*dir)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|copy| copy != &path)
            .collect();
        assert_eq!(copies.len(), 1);
        assert!(copies[0]
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("config.json.repaired-"));
        let kept: Value = serde_json::from_str(&fs::read_to_string(&copies[0]).unwrap()).unwrap();
        assert_eq!(kept, broken);

        // the same content is kept once
        fs::write(&path, broken.to_string()).unwrap();
        load_user_config_at(&path).unwrap();
        assert_eq!(fs::read_dir(&*dir).unwrap().count(), 2);
    }

    #[test]
    fn a_repair_that_only_fills_fields_keeps_no_copy() {
        let dir = TestDir::new("config-fill");
        let path = dir.join(CONFIG_FILE_NAME);
        fs::write(&path, r#"{"appearance":{"theme":"dark"}}"#).unwrap();

        let loaded = load_user_config_at(&path).unwrap();

        assert_eq!(loaded.value["appearance"]["theme"], "dark");
        assert_eq!(fs::read_dir(&*dir).unwrap().count(), 1);
    }

    #[test]
    fn keeping_every_value_ignores_added_fields_and_the_version() {
        let original = json!({"configVersion": 0, "a": {"b": [1, {"c": 2}]}});
        assert!(keeps_every_value(
            &original,
            &json!({"configVersion": 1, "a": {"b": [1, {"c": 2, "d": 3}], "e": 4}})
        ));
        assert!(!keeps_every_value(&original, &json!({"a": {"b": [1]}})));
        assert!(!keeps_every_value(
            &original,
            &json!({"a": {"b": [1, {"c": 5}]}})
        ));
        assert!(!keeps_every_value(&json!({"x": 1}), &json!({})));
    }

    #[test]
    fn a_missing_config_is_created_from_the_defaults() {
        let dir = TestDir::new("config-create");
        let path = dir.join(CONFIG_FILE_NAME);
        let loaded = load_user_config_at(&path).unwrap();
        assert_eq!(loaded.value, default_user_config());
        assert!(path.is_file());
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
    fn a_file_broken_while_running_is_kept_aside_and_replaced() {
        let dir = TestDir::new("config-broken-on-save");
        let path = dir.join(CONFIG_FILE_NAME);
        let config = default_user_config();
        for broken in [&b"{\"appearance\": "[..], &[0xff, 0xfe][..]] {
            fs::write(&path, broken).unwrap();
            write_user_config(&path, &config).unwrap();
            let saved: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
            assert_eq!(saved, config);
            let kept = fs::read_dir(&*dir)
                .unwrap()
                .map(|entry| entry.unwrap().path())
                .any(|copy| copy != path && fs::read(&copy).unwrap() == broken);
            assert!(kept, "the broken bytes are kept");
        }
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
