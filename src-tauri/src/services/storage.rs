use std::fs;
use std::path::PathBuf;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::errors::AppError;
use crate::models::{
    default_user_config, ChatHistoryItem, EditorHistoryEntry, EditorHistoryItem, EditorHistoryKind,
    LocalState, StorageInfo, CONFIG_FILE_NAME, STATE_FILE_NAME,
};
use crate::services::llm_config;

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
    write_atomic(path, &serde_json::to_string_pretty(value)?)
}

/// Writes a temporary file next to `path` and renames it over: a crash in the
/// middle of the write leaves the previous content intact instead of a torn file
fn write_atomic(path: &PathBuf, raw: &str) -> Result<(), AppError> {
    let mut tmp_name = path.file_name().unwrap_or_default().to_os_string();
    tmp_name.push(".tmp");
    let tmp_path = path.with_file_name(tmp_name);

    fs::write(&tmp_path, raw)?;
    fs::rename(&tmp_path, path)?;
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
    write_atomic(path, &raw)
}

/// How many entries to keep; 0 turns the history off. A missing or invalid
/// value falls back to `default`. Numeric strings are accepted, as older
/// settings screens stored the field as text
fn history_limit(user_config: &Value, key: &str, default: usize) -> usize {
    let value = user_config.get(key);
    let parsed = match value {
        Some(Value::Number(number)) => number.as_u64(),
        Some(Value::String(text)) => text.trim().parse::<u64>().ok(),
        _ => None,
    };

    parsed
        .and_then(|value| usize::try_from(value).ok())
        .unwrap_or(default)
}

pub fn read_or_create_user_config(app: &AppHandle) -> Result<Value, AppError> {
    let path = app_config_dir(app)?.join(CONFIG_FILE_NAME);

    if path.exists() {
        let raw = fs::read_to_string(&path)?;
        let mut value = serde_yaml::from_str(&raw)?;

        if normalize_window_insertion_config(&mut value)
            | normalize_hotkeys_config(&mut value)
            | llm_config::migrate_user_config(app, &mut value)
        {
            save_user_config(app, &value)?;
        }

        return Ok(value);
    }

    let default_config = default_user_config();
    save_user_config(app, &default_config)?;

    Ok(default_config)
}

fn normalize_hotkeys_config(user_config: &mut Value) -> bool {
    let defaults = default_user_config()
        .get("hotkeys")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let Some(config) = user_config.as_object_mut() else {
        return false;
    };
    let mut hotkeys = config
        .get("hotkeys")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let previous = hotkeys.clone();
    for (mode, shortcut) in defaults {
        hotkeys.entry(mode).or_insert(shortcut);
    }
    if hotkeys == previous && config.get("hotkeys").and_then(Value::as_object).is_some() {
        return false;
    }
    config.insert(String::from("hotkeys"), Value::Object(hotkeys));
    true
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

const EDITOR_HISTORY_FILE: &str = "editor-history.jsonl";
const DEFAULT_EDITOR_HISTORY_LIMIT: usize = 100;

/// A line of `editor-history.jsonl`: a plain string in the legacy format.
#[derive(Deserialize)]
#[serde(untagged)]
enum StoredEditorHistoryLine {
    Item(EditorHistoryItem),
    Legacy(String),
}

fn editor_history_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    Ok(app_data_sub_dir(app, "history")?.join(EDITOR_HISTORY_FILE))
}

pub fn get_editor_history(app: &AppHandle) -> Result<Vec<EditorHistoryItem>, AppError> {
    read_editor_history(&editor_history_path(app)?)
}

fn read_editor_history(path: &PathBuf) -> Result<Vec<EditorHistoryItem>, AppError> {
    let lines: Vec<StoredEditorHistoryLine> = read_jsonl(path)?;

    Ok(lines
        .into_iter()
        .enumerate()
        .map(|(index, line)| match line {
            StoredEditorHistoryLine::Item(item) => item,
            // stable while the file is untouched; the next write persists it
            StoredEditorHistoryLine::Legacy(text) => EditorHistoryItem {
                id: format!("legacy-{index}"),
                text,
                kind: EditorHistoryKind::Draft,
                operation: None,
                created_at: 0,
                result: None,
            },
        })
        .collect())
}

/// Adds an entry and returns its id, or `None` when nothing was stored: the
/// text is blank or the history is turned off
pub fn save_editor_history(
    app: &AppHandle,
    user_config: &Value,
    entry: EditorHistoryEntry,
) -> Result<Option<String>, AppError> {
    let limit = editor_history_limit(user_config);

    if entry.text.trim().is_empty() || limit == 0 {
        return Ok(None);
    }

    let path = editor_history_path(app)?;
    let mut history = read_editor_history(&path)?;
    let created_at = now_ms();
    let item = EditorHistoryItem {
        id: new_history_id(created_at),
        text: entry.text,
        kind: entry.kind,
        operation: entry.operation,
        created_at,
        result: None,
    };
    let id = item.id.clone();

    push_editor_history(&mut history, item, entry.replace_id.as_deref(), limit);
    write_jsonl(&path, &history)?;

    Ok(Some(id))
}

fn editor_history_limit(user_config: &Value) -> usize {
    history_limit(
        user_config,
        "editorHistoryMaxItems",
        DEFAULT_EDITOR_HISTORY_LIMIT,
    )
}

/// How much an entry says about the text: a text that was sent somewhere or
/// fed to the AI must not turn into a plain draft just because it is still in
/// the editor
fn kind_rank(kind: EditorHistoryKind) -> u8 {
    match kind {
        EditorHistoryKind::Draft => 0,
        EditorHistoryKind::Source => 1,
        EditorHistoryKind::Output => 2,
    }
}

fn collapses_duplicate(new_kind: EditorHistoryKind, existing_kind: EditorHistoryKind) -> bool {
    match (new_kind, existing_kind) {
        // A source supersedes an incidental draft, but every AI operation and
        // every actual output remains a separate event.
        (EditorHistoryKind::Source, EditorHistoryKind::Draft) => true,
        (EditorHistoryKind::Source, _) | (_, EditorHistoryKind::Source) => false,
        _ => true,
    }
}

/// Puts `item` on top. Draft snapshots are collapsed, and repeated outputs are
/// moved to the top. Sources stay separate because the same text may be used by
/// several AI operations and every result must remain attached to its source.
fn push_editor_history(
    history: &mut Vec<EditorHistoryItem>,
    mut item: EditorHistoryItem,
    replace_id: Option<&str>,
    limit: usize,
) {
    if let Some(replace_id) = replace_id {
        history.retain(|existing| {
            existing.id != replace_id || existing.kind != EditorHistoryKind::Draft
        });
    }

    let text = item.text.trim();
    let duplicates: Vec<EditorHistoryItem> = history
        .iter()
        .filter(|existing| {
            existing.text.trim() == text && collapses_duplicate(item.kind, existing.kind)
        })
        .cloned()
        .collect();

    history.retain(|existing| {
        existing.text.trim() != text || !collapses_duplicate(item.kind, existing.kind)
    });

    if let Some(stronger) = duplicates
        .iter()
        .filter(|existing| kind_rank(existing.kind) > kind_rank(item.kind))
        .max_by_key(|existing| kind_rank(existing.kind))
    {
        item.kind = stronger.kind;
        item.operation = stronger.operation;
    }

    // what the AI made of the text stays comparable whatever happens to it next
    if item.result.is_none() {
        item.result = duplicates.into_iter().find_map(|existing| existing.result);
    }

    history.insert(0, item);
    history.truncate(limit);
}

/// Attaches the AI result to the `Source` entry it was produced from.
pub fn set_editor_history_result(
    app: &AppHandle,
    id: String,
    result: String,
) -> Result<(), AppError> {
    let path = editor_history_path(app)?;
    let mut history = read_editor_history(&path)?;

    if !apply_editor_history_result(&mut history, &id, result) {
        return Ok(());
    }

    write_jsonl(&path, &history)
}

fn apply_editor_history_result(
    history: &mut [EditorHistoryItem],
    id: &str,
    result: String,
) -> bool {
    let Some(item) = history.iter_mut().find(|item| item.id == id) else {
        return false;
    };

    item.result = (!result.trim().is_empty()).then_some(result);
    true
}

/// Puts a removed entry back where it was (undo of a removal).
pub fn restore_editor_history_item(
    app: &AppHandle,
    user_config: &Value,
    item: EditorHistoryItem,
) -> Result<(), AppError> {
    let limit = editor_history_limit(user_config);

    if limit == 0 {
        return Ok(());
    }

    let path = editor_history_path(app)?;
    let mut history = read_editor_history(&path)?;

    if insert_restored_item(&mut history, item, limit) {
        write_jsonl(&path, &history)?;
    }

    Ok(())
}

/// Entries are ordered newest first, so the item goes before the first older
/// one. Nothing is inserted when the same text has been added again meanwhile
fn insert_restored_item(
    history: &mut Vec<EditorHistoryItem>,
    item: EditorHistoryItem,
    limit: usize,
) -> bool {
    let text = item.text.trim();

    if history
        .iter()
        .any(|existing| existing.id == item.id || existing.text.trim() == text)
    {
        return false;
    }

    let index = history
        .iter()
        .position(|existing| existing.created_at < item.created_at)
        .unwrap_or(history.len());

    if index >= limit {
        return false;
    }

    history.insert(index, item);
    history.truncate(limit);
    true
}

pub fn remove_from_editor_history(app: &AppHandle, id: String) -> Result<(), AppError> {
    let path = editor_history_path(app)?;
    let mut history = read_editor_history(&path)?;
    history.retain(|item| item.id != id);
    write_jsonl(&path, &history)
}

pub fn clear_editor_history(app: &AppHandle) -> Result<(), AppError> {
    write_jsonl(&editor_history_path(app)?, &Vec::<EditorHistoryItem>::new())
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
    let limit = history_limit(user_config, "chatHistoryMaxItems", 50);

    if limit == 0 {
        return Ok(());
    }

    let chats_dir = app_data_sub_dir(app, "chats")?;
    let mut history = get_chat_history(app)?;

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
    use crate::models::EditorHistoryOperation;
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
        let config = json!({ "chatHistoryLimit": "many", "negative": -3 });

        assert_eq!(history_limit(&config, "chatHistoryLimit", 20), 20);
        assert_eq!(history_limit(&config, "negative", 20), 20);
        assert_eq!(history_limit(&config, "missing", 10), 10);
    }

    #[test]
    fn history_limit_reads_a_number_or_a_numeric_string() {
        let config = json!({ "editorHistoryLimit": 5, "chatHistoryLimit": " 7 " });

        assert_eq!(history_limit(&config, "editorHistoryLimit", 50), 5);
        assert_eq!(history_limit(&config, "chatHistoryLimit", 50), 7);
    }

    #[test]
    fn history_limit_zero_turns_the_history_off() {
        let config = json!({ "editorHistoryLimit": 0, "chatHistoryLimit": "0" });

        assert_eq!(history_limit(&config, "editorHistoryLimit", 50), 0);
        assert_eq!(history_limit(&config, "chatHistoryLimit", 50), 0);
    }

    #[test]
    fn write_atomic_replaces_the_file_and_leaves_no_temp_file() {
        let dir = temp_dir("atomic");
        let path = dir.join("state.json");

        write_atomic(&path, "old").unwrap();
        write_atomic(&path, "new").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "new");
        assert!(!dir.join("state.json.tmp").exists());

        fs::remove_dir_all(&dir).unwrap();
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
    fn normalize_hotkeys_adds_defaults_and_keeps_overrides() {
        let mut config = json!({ "hotkeys": { "editor": "Super+Space" } });

        assert!(normalize_hotkeys_config(&mut config));
        assert_eq!(config["hotkeys"]["editor"], json!("Super+Space"));
        assert_eq!(config["hotkeys"]["voice"], json!("Ctrl+Alt+V"));
        assert!(!normalize_hotkeys_config(&mut config));
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

    fn history_item(id: &str, text: &str, kind: EditorHistoryKind) -> EditorHistoryItem {
        EditorHistoryItem {
            id: id.to_string(),
            text: text.to_string(),
            kind,
            operation: None,
            created_at: 1,
            result: None,
        }
    }

    fn history_texts(history: &[EditorHistoryItem]) -> Vec<&str> {
        history.iter().map(|item| item.text.as_str()).collect()
    }

    #[test]
    fn push_editor_history_moves_a_duplicate_to_the_top() {
        let mut history = vec![
            history_item("b", "second", EditorHistoryKind::Draft),
            history_item("a", "first", EditorHistoryKind::Draft),
        ];

        push_editor_history(
            &mut history,
            history_item("c", "  first\n", EditorHistoryKind::Source),
            None,
            10,
        );

        assert_eq!(history_texts(&history), vec!["  first\n", "second"]);
        assert_eq!(history[0].id, "c");
        assert_eq!(history[0].kind, EditorHistoryKind::Source);
    }

    #[test]
    fn push_editor_history_keeps_an_output_and_a_new_source_separate() {
        let mut history = vec![history_item("a", "sent", EditorHistoryKind::Output)];
        let mut source = history_item("b", "sent", EditorHistoryKind::Source);
        source.operation = Some(EditorHistoryOperation::Translate);

        push_editor_history(&mut history, source, None, 10);

        assert_eq!(history.len(), 2);
        assert_eq!(history[0].id, "b");
        assert_eq!(history[0].kind, EditorHistoryKind::Source);
        assert_eq!(
            history[0].operation,
            Some(EditorHistoryOperation::Translate)
        );
        assert_eq!(history[1].kind, EditorHistoryKind::Output);
    }

    #[test]
    fn push_editor_history_keeps_repeated_ai_operations_separate() {
        let mut first = history_item("a", "text", EditorHistoryKind::Source);
        first.operation = Some(EditorHistoryOperation::Translate);
        first.result = Some(String::from("Translation"));
        let mut second = history_item("b", "text", EditorHistoryKind::Source);
        second.operation = Some(EditorHistoryOperation::Correction);
        let mut history = vec![first];

        push_editor_history(&mut history, second, None, 10);

        assert_eq!(history.len(), 2);
        assert_eq!(history[0].id, "b");
        assert_eq!(history[0].result, None);
        assert_eq!(history[1].id, "a");
        assert_eq!(history[1].result.as_deref(), Some("Translation"));
    }

    #[test]
    fn push_editor_history_keeps_a_source_when_the_same_text_becomes_a_draft() {
        let mut source = history_item("a", "text", EditorHistoryKind::Source);
        source.operation = Some(EditorHistoryOperation::Correction);
        source.result = Some(String::from("Text."));
        let mut history = vec![source];

        push_editor_history(
            &mut history,
            history_item("b", "text", EditorHistoryKind::Draft),
            None,
            10,
        );

        assert_eq!(history.len(), 2);
        assert_eq!(history[0].kind, EditorHistoryKind::Draft);
        assert_eq!(history[1].kind, EditorHistoryKind::Source);
        assert_eq!(
            history[1].operation,
            Some(EditorHistoryOperation::Correction)
        );
        assert_eq!(history[1].result.as_deref(), Some("Text."));
    }

    #[test]
    fn push_editor_history_keeps_the_ai_source_and_its_sent_output() {
        let mut source = history_item("a", "text", EditorHistoryKind::Source);
        source.result = Some(String::from("Text."));
        let mut history = vec![source];

        push_editor_history(
            &mut history,
            history_item("b", "text", EditorHistoryKind::Output),
            None,
            10,
        );

        assert_eq!(history.len(), 2);
        assert_eq!(history[0].kind, EditorHistoryKind::Output);
        assert_eq!(history[0].result, None);
        assert_eq!(history[1].kind, EditorHistoryKind::Source);
        assert_eq!(history[1].result.as_deref(), Some("Text."));
    }

    #[test]
    fn push_editor_history_replaces_the_draft_of_the_same_session() {
        let mut history = vec![
            history_item("d", "hello", EditorHistoryKind::Draft),
            history_item("o", "older", EditorHistoryKind::Output),
        ];

        push_editor_history(
            &mut history,
            history_item("e", "hello world", EditorHistoryKind::Draft),
            Some("d"),
            10,
        );

        assert_eq!(history_texts(&history), vec!["hello world", "older"]);
    }

    #[test]
    fn push_editor_history_never_replaces_a_non_draft() {
        let mut history = vec![history_item("o", "sent", EditorHistoryKind::Output)];

        push_editor_history(
            &mut history,
            history_item("e", "sent and edited", EditorHistoryKind::Draft),
            Some("o"),
            10,
        );

        assert_eq!(history_texts(&history), vec!["sent and edited", "sent"]);
    }

    #[test]
    fn push_editor_history_truncates_to_the_limit() {
        let mut history = vec![
            history_item("b", "second", EditorHistoryKind::Draft),
            history_item("a", "first", EditorHistoryKind::Draft),
        ];

        push_editor_history(
            &mut history,
            history_item("c", "third", EditorHistoryKind::Output),
            None,
            2,
        );

        assert_eq!(history_texts(&history), vec!["third", "second"]);
    }

    #[test]
    fn apply_editor_history_result_sets_and_clears_the_result() {
        let mut history = vec![history_item("a", "text", EditorHistoryKind::Source)];

        assert!(apply_editor_history_result(
            &mut history,
            "a",
            String::from("Text.")
        ));
        assert_eq!(history[0].result.as_deref(), Some("Text."));

        assert!(apply_editor_history_result(
            &mut history,
            "a",
            String::from("  ")
        ));
        assert_eq!(history[0].result, None);

        assert!(!apply_editor_history_result(
            &mut history,
            "missing",
            String::from("x")
        ));
    }

    #[test]
    fn insert_restored_item_goes_back_to_its_place() {
        let mut newer = history_item("n", "newer", EditorHistoryKind::Draft);
        newer.created_at = 30;
        let mut older = history_item("o", "older", EditorHistoryKind::Draft);
        older.created_at = 10;
        let mut history = vec![newer, older];
        let mut removed = history_item("r", "removed", EditorHistoryKind::Output);
        removed.created_at = 20;

        assert!(insert_restored_item(&mut history, removed, 10));
        assert_eq!(history_texts(&history), vec!["newer", "removed", "older"]);
    }

    #[test]
    fn insert_restored_item_skips_a_text_added_again() {
        let mut history = vec![history_item("n", "same", EditorHistoryKind::Draft)];

        assert!(!insert_restored_item(
            &mut history,
            history_item("r", " same ", EditorHistoryKind::Output),
            10
        ));
        assert_eq!(history.len(), 1);
    }

    #[test]
    fn insert_restored_item_respects_the_limit() {
        let mut newer = history_item("n", "newer", EditorHistoryKind::Draft);
        newer.created_at = 30;
        let mut history = vec![newer];
        let mut removed = history_item("r", "removed", EditorHistoryKind::Draft);
        removed.created_at = 10;

        assert!(!insert_restored_item(&mut history, removed, 1));
        assert_eq!(history_texts(&history), vec!["newer"]);
    }

    #[test]
    fn read_editor_history_upgrades_legacy_lines() {
        let dir = temp_dir("editor-history");
        let path = dir.join(EDITOR_HISTORY_FILE);
        let item = history_item("x", "new", EditorHistoryKind::Output);
        let raw = format!(
            "{}\n{}\n",
            serde_json::to_string("old").unwrap(),
            serde_json::to_string(&item).unwrap()
        );
        fs::write(&path, raw).unwrap();

        let history = read_editor_history(&path).unwrap();

        assert_eq!(history[0].id, "legacy-0");
        assert_eq!(history[0].text, "old");
        assert_eq!(history[0].kind, EditorHistoryKind::Draft);
        assert_eq!(history[0].created_at, 0);
        assert_eq!(history[1], item);

        fs::remove_dir_all(&dir).unwrap();
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
                "operation": "voice-correction",
                "createdAt": 1,
                "result": "Text.",
            })
        );
    }

    #[test]
    fn editor_history_entry_reads_the_replace_id() {
        let entry: EditorHistoryEntry = serde_json::from_value(json!({
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
