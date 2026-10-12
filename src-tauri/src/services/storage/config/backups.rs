use super::super::{config_migration, fs, write_private, AppError, Path, Value, CONFIG_FILE_NAME};

/// Keeps a copy of the config as it was before a migration, once per old
/// version: an older build does not know the migrated config and would lose
/// what it no longer understands. The copy holds no API keys: the migration
/// moves them into the system keychain, and a copy in the clear would undo
/// that.
pub(super) fn back_up_config_before_migration(path: &Path, version: u64, original: &Value) {
    let backup = path.with_file_name(config_migration::backup_file_name(
        CONFIG_FILE_NAME,
        version,
    ));
    if backup.exists() {
        return;
    }
    let copied = serde_yaml::to_string(&without_api_keys(original))
        .map_err(AppError::from)
        .and_then(|raw| write_private(&backup, &raw));
    match copied {
        Ok(()) => log::info!(
            "Migrating the config from version {version}; the previous one is kept in {}",
            backup.display()
        ),
        Err(error) => {
            log::error!("Could not keep a copy of the config before migrating it: {error}")
        }
    }
}

/// Takes the API keys out of the backups that earlier versions wrote with
/// them. A backup that cannot be read is left alone.
pub(super) fn scrub_config_backups(path: &Path) {
    let Some(dir) = path.parent() else {
        return;
    };
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let stem = CONFIG_FILE_NAME
        .rsplit_once('.')
        .map_or(CONFIG_FILE_NAME, |(stem, _)| stem);
    for backup in entries.flatten().map(|entry| entry.path()) {
        let is_backup = backup
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with(&format!("{stem}.v")) && name.ends_with(".bak"));
        if !is_backup {
            continue;
        }
        let Ok(value) = fs::read_to_string(&backup)
            .map_err(AppError::from)
            .and_then(|raw| Ok(serde_yaml::from_str::<Value>(&raw)?))
        else {
            continue;
        };
        let scrubbed = without_api_keys(&value);
        if scrubbed == value {
            continue;
        }
        let written = serde_yaml::to_string(&scrubbed)
            .map_err(AppError::from)
            .and_then(|raw| write_private(&backup, &raw));
        if let Err(error) = written {
            log::warn!(
                "Could not remove the API keys from {}: {error}",
                backup.display()
            );
        }
    }
}

/// `value` without the fields that held API keys, at any depth.
fn without_api_keys(value: &Value) -> Value {
    match value {
        Value::Object(fields) => Value::Object(
            fields
                .iter()
                .filter(|(key, _)| !key.to_ascii_lowercase().ends_with("apikey"))
                .map(|(key, field)| (key.clone(), without_api_keys(field)))
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.iter().map(without_api_keys).collect()),
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};
    fn temp_dir(label: &str) -> PathBuf {
        static COUNTER: AtomicU32 = AtomicU32::new(0);

        let unique = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "tyco-storage-test-{}-{}-{}",
            label,
            std::process::id(),
            unique
        ));

        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("failed to create the temp dir");

        dir
    }

    #[test]
    fn config_backups_hold_no_api_keys() {
        let dir = temp_dir("backup-scrub");
        let path = dir.join(CONFIG_FILE_NAME);
        let legacy = json!({
            "theme": "dark",
            "llmModels": [{ "baseUrl": "https://x.example", "apiKey": "sk-secret" }],
        });

        back_up_config_before_migration(&path, 0, &legacy);
        let backup = dir.join(config_migration::backup_file_name(CONFIG_FILE_NAME, 0));
        let raw = fs::read_to_string(&backup).unwrap();
        assert!(!raw.contains("sk-secret"));
        assert!(raw.contains("x.example"));

        // a backup of an earlier version still holds its key
        let old = dir.join(config_migration::backup_file_name(CONFIG_FILE_NAME, 1));
        fs::write(&old, serde_yaml::to_string(&legacy).unwrap()).unwrap();
        scrub_config_backups(&path);
        assert!(!fs::read_to_string(&old).unwrap().contains("sk-secret"));

        fs::remove_dir_all(&dir).unwrap();
    }
}
