use std::fs;
use std::path::PathBuf;

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::errors::AppError;
use crate::models::{
    default_user_config, ChatHistoryItem, LocalState, StorageInfo, CONFIG_FILE_NAME,
    STATE_FILE_NAME,
};

fn app_config_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| AppError::Message(error.to_string()))?;

    fs::create_dir_all(&dir)?;

    Ok(dir)
}

pub fn app_data_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Message(error.to_string()))?;

    fs::create_dir_all(&dir)?;

    Ok(dir)
}

fn app_data_sub_dir(app: &AppHandle, sub: &str) -> Result<PathBuf, AppError> {
    let dir = app_data_dir(app)?.join(sub);
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn app_cache_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| AppError::Message(error.to_string()))?;
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn get_storage_info(app: &AppHandle) -> Result<StorageInfo, AppError> {
    let config_dir = app_config_dir(app)?;
    let data_dir = app_data_dir(app)?;
    let history_dir = app_data_sub_dir(app, "history")?;
    let chats_dir = app_data_sub_dir(app, "chats")?;
    let cache_dir = app_cache_dir(app)?;
    let user_config_file = config_dir.join(CONFIG_FILE_NAME);

    Ok(StorageInfo {
        config_dir: path_to_string(config_dir),
        data_dir: path_to_string(data_dir),
        history_dir: path_to_string(history_dir),
        chats_dir: path_to_string(chats_dir),
        cache_dir: path_to_string(cache_dir),
        user_config_file: path_to_string(user_config_file),
    })
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

fn write_json<T: Serialize>(path: &PathBuf, value: &T) -> Result<(), AppError> {
    let raw = serde_json::to_string_pretty(value)?;
    fs::write(path, raw)?;
    Ok(())
}

fn read_jsonl<T: DeserializeOwned>(path: &PathBuf) -> Result<Vec<T>, AppError> {
    if !path.exists() {
        return Ok(Vec::new());
    }

    let raw = fs::read_to_string(path)?;
    let mut items = Vec::new();
    for line in raw.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(parsed) = serde_json::from_str(line) {
            items.push(parsed);
        }
    }
    Ok(items)
}

fn write_jsonl<T: Serialize>(path: &PathBuf, items: &[T]) -> Result<(), AppError> {
    let mut raw = String::new();
    for item in items {
        raw.push_str(&serde_json::to_string(item)?);
        raw.push('\n');
    }
    fs::write(path, raw)?;
    Ok(())
}

fn history_limit(user_config: &Value, key: &str, default: usize) -> usize {
    user_config
        .get(key)
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .filter(|value| *value > 0)
        .unwrap_or(default)
}

pub fn read_or_create_user_config(app: &AppHandle) -> Result<Value, AppError> {
    let path = app_config_dir(app)?.join(CONFIG_FILE_NAME);

    if path.exists() {
        let raw = fs::read_to_string(&path)?;
        let mut value = serde_yaml::from_str(&raw)?;

        if normalize_window_insertion_config(&mut value) {
            save_user_config(app, &value)?;
        }

        return Ok(value);
    }

    let default_config = default_user_config();
    save_user_config(app, &default_config)?;

    Ok(default_config)
}

fn normalize_window_insertion_config(user_config: &mut Value) -> bool {
    let defaults = default_user_config();
    let default_window_insertion = defaults
        .get("windowInsertion")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let default_method = default_window_insertion
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("xdotool");
    let default_xdotool_bin = default_window_insertion
        .get("xdotoolBin")
        .and_then(Value::as_str)
        .unwrap_or("/usr/bin/xdotool");
    let default_ydotool_bin = default_window_insertion
        .get("ydotoolBin")
        .and_then(Value::as_str)
        .unwrap_or("/usr/bin/ydotool");

    let Some(config) = user_config.as_object_mut() else {
        return false;
    };

    let legacy_xdotool_bin = config
        .get("xdotoolBin")
        .and_then(Value::as_str)
        .unwrap_or(default_xdotool_bin);
    let window_insertion = config.get("windowInsertion");
    let method = window_insertion
        .and_then(|value| value.get("method"))
        .and_then(Value::as_str)
        .filter(|value| *value == "xdotool" || *value == "ydotool")
        .unwrap_or(default_method);
    let xdotool_bin = window_insertion
        .and_then(|value| value.get("xdotoolBin"))
        .and_then(Value::as_str)
        .unwrap_or(legacy_xdotool_bin);
    let ydotool_bin = window_insertion
        .and_then(|value| value.get("ydotoolBin"))
        .and_then(Value::as_str)
        .unwrap_or(default_ydotool_bin);
    let normalized = json!({
        "method": method,
        "xdotoolBin": xdotool_bin,
        "ydotoolBin": ydotool_bin,
    });
    let needs_update = config.get("windowInsertion") != Some(&normalized)
        || config.get("xdotoolBin").and_then(Value::as_str).is_none();

    if needs_update {
        config.insert(
            String::from("xdotoolBin"),
            Value::String(xdotool_bin.to_owned()),
        );
        config.insert(String::from("windowInsertion"), normalized);
    }

    needs_update
}

pub fn save_user_config(app: &AppHandle, user_config: &Value) -> Result<(), AppError> {
    let path = app_config_dir(app)?.join(CONFIG_FILE_NAME);
    let raw = serde_yaml::to_string(user_config)?;
    fs::write(path, raw)?;
    Ok(())
}

pub fn read_or_create_local_state(app: &AppHandle) -> Result<LocalState, AppError> {
    let path = app_config_dir(app)?.join(STATE_FILE_NAME);

    if path.exists() {
        return read_json(&path, LocalState::default());
    }

    let default_state = LocalState::default();
    save_local_state(app, &default_state)?;

    Ok(default_state)
}

pub fn save_local_state(app: &AppHandle, local_state: &LocalState) -> Result<(), AppError> {
    let path = app_config_dir(app)?.join(STATE_FILE_NAME);
    write_json(&path, local_state)?;
    Ok(())
}

pub fn get_editor_history(app: &AppHandle) -> Result<Vec<String>, AppError> {
    read_jsonl(&app_data_sub_dir(app, "history")?.join("editor-history.jsonl"))
}

pub fn save_editor_history(
    app: &AppHandle,
    user_config: &Value,
    value: String,
) -> Result<(), AppError> {
    let mut history = get_editor_history(app)?;
    let limit = history_limit(user_config, "editorHistoryMaxItems", 50);
    history.retain(|item| item != &value);
    history.insert(0, value);
    history.truncate(limit);
    write_jsonl(
        &app_data_sub_dir(app, "history")?.join("editor-history.jsonl"),
        &history,
    )
}

pub fn remove_from_editor_history(app: &AppHandle, value: String) -> Result<(), AppError> {
    let mut history = get_editor_history(app)?;
    history.retain(|item| item != &value);
    write_jsonl(
        &app_data_sub_dir(app, "history")?.join("editor-history.jsonl"),
        &history,
    )
}

pub fn clear_editor_history(app: &AppHandle) -> Result<(), AppError> {
    write_jsonl(
        &app_data_sub_dir(app, "history")?.join("editor-history.jsonl"),
        &Vec::<String>::new(),
    )
}

pub fn get_transform_history(app: &AppHandle) -> Result<Vec<String>, AppError> {
    read_jsonl(&app_data_sub_dir(app, "history")?.join("transform-history.jsonl"))
}

pub fn save_transform_history(
    app: &AppHandle,
    user_config: &Value,
    value: String,
) -> Result<(), AppError> {
    let mut history = get_transform_history(app)?;
    let limit = history_limit(user_config, "transformHistoryMaxItems", 50);
    history.retain(|item| item != &value);
    history.insert(0, value);
    history.truncate(limit);
    write_jsonl(
        &app_data_sub_dir(app, "history")?.join("transform-history.jsonl"),
        &history,
    )
}

pub fn remove_from_transform_history(app: &AppHandle, value: String) -> Result<(), AppError> {
    let mut history = get_transform_history(app)?;
    history.retain(|item| item != &value);
    write_jsonl(
        &app_data_sub_dir(app, "history")?.join("transform-history.jsonl"),
        &history,
    )
}

pub fn clear_transform_history(app: &AppHandle) -> Result<(), AppError> {
    write_jsonl(
        &app_data_sub_dir(app, "history")?.join("transform-history.jsonl"),
        &Vec::<String>::new(),
    )
}

pub fn get_chat_history(app: &AppHandle) -> Result<Vec<ChatHistoryItem>, AppError> {
    read_json(
        &app_data_sub_dir(app, "chats")?.join("index.json"),
        Vec::<ChatHistoryItem>::new(),
    )
}

pub fn save_chat_history(
    app: &AppHandle,
    user_config: &Value,
    chat_history_item: ChatHistoryItem,
) -> Result<(), AppError> {
    let chats_dir = app_data_sub_dir(app, "chats")?;
    let mut history = get_chat_history(app)?;
    let limit = history_limit(user_config, "chatHistoryMaxItems", 50);

    // Save full chat to its own file
    let chat_file_path =
        chats_dir.join(format!("{}.json", sanitize_chat_id(&chat_history_item.id)?));
    write_json(&chat_file_path, &chat_history_item)?;

    // Create index item (strip messages to keep index small)
    let mut index_item = chat_history_item.clone();
    index_item.messages = Vec::new();

    if let Some(existing) = history.iter_mut().find(|item| item.id == index_item.id) {
        existing.last_msg_date = index_item.last_msg_date;
        existing.description = index_item.description;
        existing.messages = Vec::new(); // ensure messages are empty in index
    } else {
        history.insert(0, index_item);
    }

    history.truncate(limit);
    remove_orphan_chat_files(&chats_dir, &history)?;

    write_json(&chats_dir.join("index.json"), &history)
}

pub fn get_chat(app: &AppHandle, id: String) -> Result<Option<ChatHistoryItem>, AppError> {
    let chats_dir = app_data_sub_dir(app, "chats")?;
    let chat_file_path = chats_dir.join(format!("{}.json", sanitize_chat_id(&id)?));

    if !chat_file_path.exists() {
        return Ok(None);
    }

    Ok(Some(read_json(
        &chat_file_path,
        ChatHistoryItem {
            id,
            description: String::new(),
            last_msg_date: String::new(),
            messages: Vec::new(),
        },
    )?))
}

pub fn remove_from_chat_history(app: &AppHandle, id: String) -> Result<(), AppError> {
    let chats_dir = app_data_sub_dir(app, "chats")?;
    let mut history = get_chat_history(app)?;
    history.retain(|item| item.id != id);
    write_json(&chats_dir.join("index.json"), &history)?;

    let chat_file_path = chats_dir.join(format!("{}.json", sanitize_chat_id(&id)?));
    if chat_file_path.exists() {
        let _ = fs::remove_file(chat_file_path);
    }

    Ok(())
}

pub fn clear_chat_history(app: &AppHandle) -> Result<(), AppError> {
    let chats_dir = app_data_sub_dir(app, "chats")?;
    write_json(
        &chats_dir.join("index.json"),
        &Vec::<ChatHistoryItem>::new(),
    )?;

    // Also clear all individual chat files
    if let Ok(entries) = fs::read_dir(&chats_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && path.file_name() != Some(std::ffi::OsStr::new("index.json")) {
                let _ = fs::remove_file(path);
            }
        }
    }

    Ok(())
}

pub fn save_main_input_tmp(app: &AppHandle, value: String) -> Result<(), AppError> {
    write_json(
        &app_data_sub_dir(app, "history")?.join("main-input-tmp.json"),
        &serde_json::json!({
            "value": value,
            "lastSaved": chrono_like_now(),
        }),
    )
}

pub fn clear_main_input_tmp(app: &AppHandle) -> Result<(), AppError> {
    write_json(
        &app_data_sub_dir(app, "history")?.join("main-input-tmp.json"),
        &serde_json::json!({
            "value": "",
            "lastSaved": "",
        }),
    )
}

fn chrono_like_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    now.to_string()
}

fn sanitize_chat_id(id: &str) -> Result<String, AppError> {
    let is_safe = !id.is_empty()
        && id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_');

    if !is_safe {
        return Err(AppError::Message(String::from("Invalid chat id")));
    }

    Ok(id.to_string())
}

fn remove_orphan_chat_files(
    chats_dir: &PathBuf,
    history: &[ChatHistoryItem],
) -> Result<(), AppError> {
    let active_ids = history
        .iter()
        .map(|item| format!("{}.json", item.id))
        .collect::<std::collections::HashSet<_>>();

    if let Ok(entries) = fs::read_dir(chats_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };

            if path.is_file() && file_name != "index.json" && !active_ids.contains(file_name) {
                fs::remove_file(path)?;
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// Creates a unique empty directory under the system temp dir.
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

    fn chat_item(id: &str) -> ChatHistoryItem {
        ChatHistoryItem {
            id: id.to_string(),
            description: String::from("chat"),
            last_msg_date: String::from("0"),
            messages: Vec::new(),
        }
    }

    #[test]
    fn history_limit_falls_back_to_the_default() {
        let config = json!({ "editorHistoryLimit": 0, "chatHistoryLimit": "many" });

        assert_eq!(history_limit(&config, "editorHistoryLimit", 50), 50);
        assert_eq!(history_limit(&config, "chatHistoryLimit", 20), 20);
        assert_eq!(history_limit(&config, "missing", 10), 10);
    }

    #[test]
    fn history_limit_reads_a_positive_value() {
        let config = json!({ "editorHistoryLimit": 5 });

        assert_eq!(history_limit(&config, "editorHistoryLimit", 50), 5);
    }

    #[test]
    fn sanitize_chat_id_rejects_path_traversal() {
        assert!(sanitize_chat_id("../../etc/passwd").is_err());
        assert!(sanitize_chat_id("chat/id").is_err());
        assert!(sanitize_chat_id("").is_err());
        assert_eq!(sanitize_chat_id("chat-1_A").unwrap(), "chat-1_A");
    }

    #[test]
    fn normalize_window_insertion_migrates_the_legacy_key() {
        let mut config = json!({ "xdotoolBin": "/opt/bin/xdotool" });

        assert!(normalize_window_insertion_config(&mut config));
        assert_eq!(
            config["windowInsertion"],
            json!({
                "method": "xdotool",
                "xdotoolBin": "/opt/bin/xdotool",
                "ydotoolBin": "/usr/bin/ydotool",
            })
        );
    }

    #[test]
    fn normalize_window_insertion_replaces_an_unknown_method() {
        let mut config = json!({ "windowInsertion": { "method": "wtype" } });

        assert!(normalize_window_insertion_config(&mut config));
        assert_eq!(config["windowInsertion"]["method"], json!("xdotool"));
    }

    #[test]
    fn normalize_window_insertion_is_idempotent() {
        let mut config = json!({});

        assert!(normalize_window_insertion_config(&mut config));
        assert!(!normalize_window_insertion_config(&mut config));
    }

    #[test]
    fn jsonl_round_trip_skips_blank_and_broken_lines() {
        let dir = temp_dir("jsonl");
        let path = dir.join("history.jsonl");

        write_jsonl(&path, &[String::from("first"), String::from("second")]).unwrap();
        let mut raw = fs::read_to_string(&path).unwrap();
        raw.push_str("\n{not json}\n");
        fs::write(&path, raw).unwrap();

        let items: Vec<String> = read_jsonl(&path).unwrap();

        assert_eq!(items, vec![String::from("first"), String::from("second")]);

        fs::remove_dir_all(&dir).unwrap();
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
    fn remove_orphan_chat_files_keeps_active_chats_and_the_index() {
        let dir = temp_dir("orphans");
        fs::write(dir.join("index.json"), "[]").unwrap();
        fs::write(dir.join("kept.json"), "{}").unwrap();
        fs::write(dir.join("orphan.json"), "{}").unwrap();

        remove_orphan_chat_files(&dir, &[chat_item("kept")]).unwrap();

        assert!(dir.join("index.json").exists());
        assert!(dir.join("kept.json").exists());
        assert!(!dir.join("orphan.json").exists());

        fs::remove_dir_all(&dir).unwrap();
    }
}
