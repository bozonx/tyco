#[cfg(test)]
mod test_support;

mod chat_history;
mod config;
mod editor_history;
mod history_store;

pub use chat_history::ChatHistoryPolicy;
pub use config::*;
pub use editor_history::apply_history_settings_on_startup;
pub use history_store::*;

use std::fs;
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
#[cfg(test)]
use serde_json::json;
use serde_json::Value;
use tauri::AppHandle;

use crate::errors::AppError;
use crate::models::{
    default_user_config, Chat, ChatSummary, CreateEditorHistoryRequest, EditorHistoryRecord,
    StorageInfo, StorageKind, StorageLocation, CONFIG_FILE_NAME,
};
use crate::services::atomic_file::{create_private_dir, read_or_quarantine, write_private};
use crate::services::{app_paths::AppPaths, config_version};

fn app_config_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = AppPaths::resolve(app)?.config_dir;

    create_private_dir(&dir)?;

    Ok(dir)
}

pub fn app_data_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = AppPaths::resolve(app)?.data_dir;

    create_private_dir(&dir)?;

    Ok(dir)
}

pub fn app_data_sub_dir(app: &AppHandle, sub: &str) -> Result<PathBuf, AppError> {
    let dir = app_data_dir(app)?.join(sub);
    create_private_dir(&dir)?;
    Ok(dir)
}

fn app_cache_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = AppPaths::resolve(app)?.cache_dir;
    create_private_dir(&dir)?;
    Ok(dir)
}

pub fn app_log_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = AppPaths::resolve(app)?.log_dir;
    create_private_dir(&dir)?;
    Ok(dir)
}

/// Where each kind of file is; listing them creates no directory.
pub fn get_storage_info(app: &AppHandle) -> Result<StorageInfo, AppError> {
    let paths = AppPaths::resolve(app)?;
    Ok(StorageInfo {
        locations: group_storage_locations([
            (StorageKind::Config, paths.config_dir),
            (StorageKind::Data, paths.data_dir),
            (StorageKind::Cache, paths.cache_dir),
            (StorageKind::Logs, paths.log_dir),
        ]),
    })
}

/// The directory of a storage kind, for the user to open.
pub fn storage_dir(app: &AppHandle, kind: StorageKind) -> Result<PathBuf, AppError> {
    match kind {
        StorageKind::Config => app_config_dir(app),
        StorageKind::Data => app_data_dir(app),
        StorageKind::Cache => app_cache_dir(app),
        StorageKind::Logs => app_log_dir(app),
    }
}

/// Only the root directories: a kind in the same directory as another, or
/// inside it, joins that one's location.
fn group_storage_locations(
    dirs: impl IntoIterator<Item = (StorageKind, PathBuf)>,
) -> Vec<StorageLocation> {
    let mut roots: Vec<(Vec<StorageKind>, PathBuf)> = Vec::new();
    for (kind, dir) in dirs {
        if let Some((kinds, _)) = roots.iter_mut().find(|(_, root)| dir.starts_with(root)) {
            kinds.push(kind);
            continue;
        }
        // a root inside the new directory joins it instead
        let mut kinds = Vec::new();
        roots.retain(|(nested_kinds, root)| {
            let nested = root.starts_with(&dir);
            if nested {
                kinds.extend(nested_kinds);
            }
            !nested
        });
        kinds.push(kind);
        roots.push((kinds, dir));
    }
    roots
        .into_iter()
        .map(|(kinds, dir)| StorageLocation {
            kinds,
            path: path_to_string(dir),
        })
        .collect()
}

fn path_to_string(path: PathBuf) -> String {
    path.to_string_lossy().to_string()
}

fn read_json<T: DeserializeOwned>(path: &PathBuf, fallback: T) -> Result<T, AppError> {
    if !path.exists() {
        return Ok(fallback);
    }

    let raw = fs::read_to_string(path)?;
    let parsed = serde_json::from_str(&raw)?;

    Ok(parsed)
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), AppError> {
    write_private(path, &serde_json::to_string_pretty(value)?)
}

fn read_jsonl<T: DeserializeOwned>(path: &Path) -> Result<Vec<T>, AppError> {
    if !path.exists() {
        return Ok(Vec::new());
    }

    let raw = fs::read(path)?;
    let mut items = Vec::new();
    let mut damaged = false;
    for (index, line) in raw.split(|byte| *byte == b'\n').enumerate() {
        if line.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        match serde_json::from_slice(line) {
            Ok(parsed) => items.push(parsed),
            Err(error) => {
                damaged = true;
                log::warn!(
                    "Skipping unreadable line {} of {}: {error}",
                    index + 1,
                    path.display()
                );
            }
        }
    }
    if damaged {
        crate::services::atomic_file::preserve_broken_copy(path, &raw)?;
    }
    Ok(items)
}

fn write_jsonl<T: Serialize>(path: &Path, items: &[T]) -> Result<(), AppError> {
    let mut raw = String::new();
    for item in items {
        raw.push_str(&serde_json::to_string(item)?);
        raw.push('\n');
    }
    write_private(path, &raw)
}

/// How many entries to keep; 0 turns the history off. Missing or invalid
/// numbers use the domain default; serialized numeric strings are not accepted.
fn history_limit(config: &Value, key: &str, default: usize) -> usize {
    config
        .get(key)
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .unwrap_or(default)
}

fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| u64::try_from(duration.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or_default()
}

fn new_history_id(now_ms: u64) -> String {
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    format!("{now_ms:x}-{:x}", COUNTER.fetch_add(1, Ordering::Relaxed))
}

const DAY_MS: u64 = 24 * 60 * 60 * 1000;

fn remove_file_if_exists(path: &Path) -> Result<(), AppError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{EditorHistoryKind, EditorHistoryOperation};
    use crate::services::storage::test_support::{history_item, TestDir};

    #[test]
    fn history_limit_falls_back_to_the_default() {
        let config = json!({ "maxItems": "many", "negative": -3 });

        assert_eq!(history_limit(&config, "maxItems", 20), 20);
        assert_eq!(history_limit(&config, "negative", 20), 20);
        assert_eq!(history_limit(&config, "missing", 10), 10);
    }

    #[test]
    fn history_limit_accepts_numbers_and_rejects_numeric_strings() {
        assert_eq!(history_limit(&json!({ "maxItems": 5 }), "maxItems", 50), 5);
        assert_eq!(
            history_limit(&json!({ "maxItems": " 7 " }), "maxItems", 50),
            50
        );
    }

    #[test]
    fn history_limit_zero_turns_the_history_off() {
        assert_eq!(history_limit(&json!({ "maxItems": 0 }), "maxItems", 50), 0);
        assert_eq!(
            history_limit(&json!({ "maxItems": "0" }), "maxItems", 50),
            50
        );
    }

    #[test]
    fn jsonl_round_trip_skips_blank_and_broken_lines() {
        let dir = TestDir::new("jsonl");
        let path = dir.join("history.jsonl");

        write_jsonl(&path, &[String::from("first"), String::from("second")]).unwrap();
        let mut raw = fs::read_to_string(&path).unwrap();
        raw.push_str("\n{not json}\n");
        fs::write(&path, raw).unwrap();

        let items: Vec<String> = read_jsonl(&path).unwrap();

        assert_eq!(items, vec![String::from("first"), String::from("second")]);
    }

    #[test]
    fn damaged_jsonl_keeps_exact_bytes_once_before_rewriting() {
        let dir = TestDir::new("jsonl-preservation");
        let path = dir.join("history.jsonl");
        let bytes = b"\"valid\"\n{broken\n\xff\n";
        fs::write(&path, bytes).unwrap();
        let items: Vec<String> = read_jsonl(&path).unwrap();
        assert_eq!(items, vec!["valid"]);
        let _: Vec<String> = read_jsonl(&path).unwrap();
        let backups: Vec<_> = fs::read_dir(path.parent().unwrap())
            .unwrap()
            .flatten()
            .filter(|entry| entry.path() != path)
            .collect();
        assert_eq!(backups.len(), 1);
        assert_eq!(fs::read(backups[0].path()).unwrap(), bytes);
        write_jsonl(&path, &items).unwrap();
        assert_eq!(fs::read(backups[0].path()).unwrap(), bytes);
    }

    #[test]
    fn editor_history_item_uses_the_ui_field_names() {
        let mut item = history_item("x", "text", EditorHistoryKind::Source);
        item.operation = Some(EditorHistoryOperation::VoiceCorrection);
        item.result = Some(String::from("Text."));

        assert_eq!(
            serde_json::to_value(&item).unwrap(),
            json!({
                "id": "x",
                "text": "text",
                "kind": "source",
                "operation": "voiceCorrection",
                "createdAt": 1,
                "result": "Text.",
            })
        );

        item.is_result_applied = true;

        assert_eq!(
            serde_json::to_value(&item).unwrap()["isResultApplied"],
            json!(true)
        );
    }

    #[test]
    fn editor_history_entry_reads_the_replace_id() {
        let entry: CreateEditorHistoryRequest = serde_json::from_value(json!({
            "text": "text",
            "kind": "draft",
            "replaceId": "abc",
        }))
        .unwrap();

        assert_eq!(entry.replace_id.as_deref(), Some("abc"));
    }

    #[test]
    fn new_history_id_is_unique_within_a_millisecond() {
        assert_ne!(new_history_id(5), new_history_id(5));
    }

    #[test]
    fn read_jsonl_returns_empty_for_a_missing_file() {
        let items: Vec<String> = read_jsonl(&PathBuf::from("/nonexistent/history.jsonl")).unwrap();

        assert!(items.is_empty());
    }

    #[test]
    fn read_json_returns_the_fallback_for_a_missing_file() {
        let value: Value = read_json(&PathBuf::from("/nonexistent/state.json"), json!({})).unwrap();

        assert_eq!(value, json!({}));
    }

    #[test]
    fn storage_info_serializes_locations() {
        let info = StorageInfo {
            locations: vec![StorageLocation {
                kinds: vec![StorageKind::Config, StorageKind::Logs],
                path: "/config".into(),
            }],
        };

        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(
            json,
            json!({ "locations": [{ "kinds": ["config", "logs"], "path": "/config" }] })
        );
    }

    #[test]
    fn groups_storage_locations_by_root() {
        let group = |dirs: &[(StorageKind, &str)]| {
            group_storage_locations(
                dirs.iter()
                    .map(|(kind, dir)| (*kind, PathBuf::from(dir)))
                    .collect::<Vec<_>>(),
            )
            .into_iter()
            .map(|location| (location.kinds, location.path))
            .collect::<Vec<_>>()
        };
        use StorageKind::*;

        // Linux: every kind in a directory of its own
        assert_eq!(
            group(&[
                (Config, "/h/.config/id"),
                (Data, "/h/.local/share/id"),
                (Cache, "/h/.cache/id"),
                (Logs, "/h/.local/state/id/logs"),
            ]),
            [
                (vec![Config], String::from("/h/.config/id")),
                (vec![Data], String::from("/h/.local/share/id")),
                (vec![Cache], String::from("/h/.cache/id")),
                (vec![Logs], String::from("/h/.local/state/id/logs")),
            ]
        );
        // Windows: the same directory, and logs inside the cache
        assert_eq!(
            group(&[
                (Config, "/r/id"),
                (Data, "/r/id"),
                (Cache, "/l/id"),
                (Logs, "/l/id/logs"),
            ]),
            [
                (vec![Config, Data], String::from("/r/id")),
                (vec![Cache, Logs], String::from("/l/id")),
            ]
        );
        // a root listed after the directory inside it
        assert_eq!(
            group(&[(Logs, "/l/id/logs"), (Cache, "/l/id")]),
            [(vec![Logs, Cache], String::from("/l/id"))]
        );
        // a common prefix of the name is not a parent
        assert_eq!(group(&[(Cache, "/l/id"), (Logs, "/l/id2")]).len(), 2);
    }
}
