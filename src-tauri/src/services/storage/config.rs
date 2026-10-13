mod backups;
mod normalization;
mod yaml;

use super::*;
use backups::{
    back_up_config_before_migration, back_up_config_before_repair, scrub_config_backups,
};
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
        let migration_backup_ready = if migrated {
            match back_up_config_before_migration(&path, previous_version, &original) {
                Ok(()) => true,
                Err(error) => {
                    log::error!("Could not back up config before migration: {error}");
                    false
                }
            }
        } else {
            true
        };
        scrub_config_backups(&path);

        let normalized = migrated
            | normalize_window_insertion_config(&mut value)
            | normalize_hotkeys_config(&mut value)
            | normalize_appearance_config(&mut value)
            | normalize_language_config(&mut value)
            | normalize_editor_config(&mut value)
            | normalize_translation_config(&mut value)
            | normalize_main_actions_config(&mut value)
            | llm_config::migrate_user_config(app, &mut value)?
            | config_migration::update_provider_models(&mut value)
            | normalize_stt_config(&mut value)
            | normalize_ai_rules_and_tasks(&mut value);
        // LLM migration has consumed the old usage map before it is removed.
        value.as_object_mut().unwrap().remove("aiModelUsage");
        let repaired = crate::services::config_schema::normalize_user_config(&mut value);
        let changed =
            crate::services::webhook_secrets::migrate(app, &mut value)? | normalized | repaired;

        // the app starts with the config in memory either way; the next
        // save writes it
        let can_save = if changed && !migrated {
            match back_up_config_before_repair(&path, &original) {
                Ok(()) => true,
                Err(error) => {
                    log::error!("Could not back up config before repair: {error}");
                    false
                }
            }
        } else {
            migration_backup_ready
        };
        let saved = !changed
            || can_save
                && match save_user_config(app, &value) {
                    Ok(()) => true,
                    Err(error) => {
                        log::error!("Could not save the updated config: {error}");
                        false
                    }
                };
        if saved {
            crate::services::webhook_secrets::cleanup_after_startup(app, &value)?;
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
    crate::services::config_schema::validate_user_config(user_config)?;
    let path = app_config_dir(app)?.join(CONFIG_FILE_NAME);
    let previous = match fs::read_to_string(&path) {
        Ok(raw) => Some(raw),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.into()),
    };
    if let Some(raw) = &previous {
        let original: Value = serde_yaml::from_str(raw)?;
        if config_migration::is_newer_than_supported(&original) {
            return Err(newer_config_error());
        }
        if crate::services::config_schema::validate_user_config(&original).is_err() {
            back_up_config_before_repair(&path, &original)?;
        }
    }
    let rendered = yaml::render_config(previous.as_deref(), user_config)?;
    write_private(&path, &rendered)
}

pub fn newer_config_error() -> AppError {
    AppError::UnsupportedConfig(String::from(
        "The config was written by a newer version of Tyco; update Tyco to change the settings",
    ))
}
