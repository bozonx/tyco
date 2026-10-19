mod backups;
mod normalization;

use super::*;
use backups::back_up_config_before_repair;
use normalization::*;

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
    let path = app_config_dir(app)?.join(CONFIG_FILE_NAME);

    if let Some(mut value) = read_or_quarantine(&path, |raw| {
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
        let changed = normalize_loaded_config(&mut value);

        // the app starts with the config in memory either way; the next
        // save writes it
        let is_on_disk = !changed
            || match back_up_config_before_repair(&path, &original) {
                Ok(()) => match save_user_config(app, &value) {
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
    let is_on_disk = match save_user_config(app, &default_config) {
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

/// Repairs disk input using domain rules followed by the shared schema.
/// Returns true when the normalized configuration differs from the input.
fn normalize_loaded_config(value: &mut Value) -> bool {
    let normalized = normalize_window_insertion_config(value)
        | normalize_hotkeys_config(value)
        | normalize_language_config(value);
    let repaired = crate::services::settings::schema::normalize_user_config(value);
    normalized | repaired
}

/// Writes `user_config`, which the caller has validated: the settings
/// service before it applies a change, the startup by normalizing it. A file
/// a newer Tyco wrote meanwhile is left alone.
pub fn save_user_config(app: &AppHandle, user_config: &Value) -> Result<(), AppError> {
    debug_assert!(crate::services::settings::schema::validate_user_config(user_config).is_ok());
    let path = app_config_dir(app)?.join(CONFIG_FILE_NAME);
    let previous = match fs::read_to_string(&path) {
        Ok(raw) => Some(raw),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.into()),
    };
    if let Some(raw) = previous {
        let original: Value = serde_json::from_str(&raw)?;
        if version::is_newer_than_supported(&original) {
            return Err(newer_config_error());
        }
        if crate::services::settings::schema::validate_user_config(&original).is_err() {
            back_up_config_before_repair(&path, &original)?;
        }
    }
    write_json(&path, user_config)
}

pub fn newer_config_error() -> AppError {
    AppError::UnsupportedConfig(String::from(
        "The config was written by a newer version of Tyco; update Tyco to open this configuration",
    ))
}
