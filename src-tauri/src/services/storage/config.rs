mod backups;
mod normalization;

use super::*;
use backups::{back_up_config_before_migration, scrub_config_backups};
use normalization::*;

pub fn read_or_create_user_config(app: &AppHandle) -> Result<Value, AppError> {
    let path = app_config_dir(app)?.join(CONFIG_FILE_NAME);

    if let Some(mut value) = read_or_quarantine(&path, |raw| {
        let value: Value = serde_yaml::from_str(raw)?;

        if value.is_object() {
            Ok(value)
        } else {
            Err(AppError::Message(String::from(
                "the config is not a mapping",
            )))
        }
    })? {
        // a newer build wrote it: its settings are kept as they are, and the
        // config is never written over (see `save_user_config`)
        if config_migration::is_newer_than_supported(&value) {
            log::warn!(
                "{} is of config version {}, newer than {} this build supports; \
                 it is used as it is and not saved",
                path.display(),
                config_migration::config_version(&value),
                config_migration::CONFIG_VERSION
            );
            return Ok(value);
        }

        let previous_version = config_migration::config_version(&value);
        let original = value.clone();
        let migrated = config_migration::migrate(&mut value);
        if migrated {
            back_up_config_before_migration(&path, previous_version, &original);
        }
        scrub_config_backups(&path);

        let changed = migrated
            | normalize_window_insertion_config(&mut value)
            | normalize_hotkeys_config(&mut value)
            | normalize_appearance_config(&mut value)
            | normalize_language_config(&mut value)
            | normalize_editor_config(&mut value)
            | normalize_translation_config(&mut value)
            | normalize_main_actions_config(&mut value)
            | llm_config::migrate_user_config(app, &mut value)
            | normalize_stt_config(&mut value)
            | normalize_ai_rules_and_tasks(&mut value);

        // the app starts with the config in memory either way; the next
        // save writes it
        if changed {
            if let Err(error) = save_user_config(app, &value) {
                log::error!("Could not save the updated config: {error}");
            }
        }

        return Ok(value);
    }

    let default_config = default_user_config();
    if let Err(error) = save_user_config(app, &default_config) {
        log::error!("Could not save the default config: {error}");
    }

    Ok(default_config)
}

pub fn save_user_config(app: &AppHandle, user_config: &Value) -> Result<(), AppError> {
    if config_migration::is_newer_than_supported(user_config) {
        return Err(newer_config_error());
    }
    let path = app_config_dir(app)?.join(CONFIG_FILE_NAME);
    write_private(&path, &serde_yaml::to_string(user_config)?)
}

pub fn newer_config_error() -> AppError {
    AppError::UnsupportedConfig(String::from(
        "The config was written by a newer version of Tyco; update Tyco to change the settings",
    ))
}
