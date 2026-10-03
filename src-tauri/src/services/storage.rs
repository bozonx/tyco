use std::fs;
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::errors::AppError;
use crate::models::{
    default_user_config, ChatHistoryItem, EditorHistoryEntry, EditorHistoryItem, EditorHistoryKind,
    LocalState, StorageInfo, CONFIG_FILE_NAME, STATE_FILE_NAME,
};
use crate::services::atomic_file::{quarantine, write_private};
use crate::services::{app_paths::AppPaths, llm_config};

fn app_config_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = AppPaths::resolve(app)?.config_dir;

    fs::create_dir_all(&dir)?;

    Ok(dir)
}

pub fn app_data_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = AppPaths::resolve(app)?.data_dir;

    fs::create_dir_all(&dir)?;

    Ok(dir)
}

fn app_data_sub_dir(app: &AppHandle, sub: &str) -> Result<PathBuf, AppError> {
    let dir = app_data_dir(app)?.join(sub);
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn app_cache_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = AppPaths::resolve(app)?.cache_dir;
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

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), AppError> {
    write_private(path, &serde_json::to_string_pretty(value)?)
}

fn read_jsonl<T: DeserializeOwned>(path: &PathBuf) -> Result<Vec<T>, AppError> {
    if !path.exists() {
        return Ok(Vec::new());
    }

    let raw = fs::read_to_string(path)?;
    let mut items = Vec::new();
    for (index, line) in raw.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str(line) {
            Ok(parsed) => items.push(parsed),
            // the next write drops the line, so the log is all that is left of it
            Err(error) => log::warn!(
                "Skipping unreadable line {} of {}: {error}",
                index + 1,
                path.display()
            ),
        }
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

/// Reads the user config. A config that cannot be parsed is set aside and
/// replaced by the defaults: the app must start either way, and the user keeps
/// the broken file to fix it.
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
        let changed = normalize_window_insertion_config(&mut value)
            | normalize_hotkeys_config(&mut value)
            | normalize_appearance_config(&mut value)
            | normalize_language_config(&mut value)
            | normalize_editor_config(&mut value)
            | normalize_translation_config(&mut value)
            | normalize_main_actions_config(&mut value)
            | llm_config::migrate_user_config(app, &mut value)
            | normalize_stt_config(&mut value)
            | normalize_ai_rules_and_tasks(&mut value);

        if changed {
            save_user_config(app, &value)?;
        }

        return Ok(value);
    }

    let default_config = default_user_config();
    save_user_config(app, &default_config)?;

    Ok(default_config)
}

/// Parses the file at `path`; `None` when there is none or it was unreadable
/// and has been moved aside.
fn read_or_quarantine<T>(
    path: &Path,
    parse: impl FnOnce(&str) -> Result<T, AppError>,
) -> Result<Option<T>, AppError> {
    if !path.exists() {
        return Ok(None);
    }

    let parsed = fs::read_to_string(path)
        .map_err(AppError::from)
        .and_then(|raw| parse(&raw));
    match parsed {
        Ok(value) => Ok(Some(value)),
        Err(error) => {
            let target = quarantine(path)?;
            log::error!(
                "{} is unreadable ({error}); moved it to {} and starting with defaults",
                path.display(),
                target.display()
            );
            Ok(None)
        }
    }
}

/// Deepgram is the only speech provider; other entries are dropped, and the
/// user's own Deepgram settings survive.
fn normalize_stt_config(user_config: &mut Value) -> bool {
    let defaults = default_user_config();
    let default_model = defaults
        .get("sttModels")
        .and_then(Value::as_array)
        .and_then(|models| models.first())
        .cloned()
        .unwrap_or_default();
    let default_id = default_model.get("id").cloned().unwrap_or(Value::Null);
    let provider = default_model
        .get("provider")
        .cloned()
        .unwrap_or(Value::Null);
    let Some(config) = user_config.as_object_mut() else {
        return false;
    };

    let mut model = default_model.as_object().cloned().unwrap_or_default();
    if let Some(existing) = config
        .get("sttModels")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_object)
        .find(|model| model.get("provider") == Some(&provider))
    {
        model.extend(existing.clone());
    }
    model.insert(String::from("id"), default_id.clone());
    let models = json!([model]);

    let mut usage = config
        .get("aiModelUsage")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    usage.insert(String::from("stt"), default_id);
    let usage = Value::Object(usage);

    if config.get("sttModels") == Some(&models) && config.get("aiModelUsage") == Some(&usage) {
        return false;
    }
    config.insert(String::from("sttModels"), models);
    config.insert(String::from("aiModelUsage"), usage);
    true
}

fn normalize_hotkeys_config(user_config: &mut Value) -> bool {
    let defaults = default_user_config();
    let default_hotkeys = defaults
        .get("hotkeys")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let default_quick_input = defaults
        .get("quickInputHotkeys")
        .cloned()
        .unwrap_or_default();
    let default_selection_hotkeys = defaults
        .get("selectionHotkeys")
        .cloned()
        .unwrap_or_default();
    let default_selection_replace = defaults
        .get("selectionReplace")
        .cloned()
        .unwrap_or_default();

    let Some(config) = user_config.as_object_mut() else {
        return false;
    };
    let mut changed = false;

    // Hotkeys mapping
    let mut hotkeys = config
        .get("hotkeys")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let previous_hotkeys = hotkeys.clone();
    hotkeys.remove("history");
    hotkeys.remove("config");
    for (mode, shortcut) in default_hotkeys {
        hotkeys.entry(mode).or_insert(shortcut);
    }
    if hotkeys != previous_hotkeys || config.get("hotkeys").and_then(Value::as_object).is_none() {
        config.insert(String::from("hotkeys"), Value::Object(hotkeys));
        changed = true;
    }

    // Quick input hotkeys
    if config.remove("quickInputSubmit").is_some() {
        changed = true;
    }
    if config.remove("quickCorrection").is_some() {
        changed = true;
    }

    if let Some(quick) = config
        .get_mut("quickInputHotkeys")
        .and_then(Value::as_object_mut)
    {
        if let Some(def_quick) = default_quick_input.as_object() {
            for (action, default_key) in def_quick {
                if !quick.contains_key(action) {
                    quick.insert(action.clone(), default_key.clone());
                    changed = true;
                }
            }
        }
        if quick.get("next").and_then(Value::as_str) == Some("Ctrl+S")
            || quick.get("next").and_then(Value::as_str) == Some("Tab")
        {
            quick.insert(
                String::from("next"),
                Value::String(String::from("Ctrl+Enter")),
            );
            changed = true;
        }
    } else {
        config.insert(String::from("quickInputHotkeys"), default_quick_input);
        changed = true;
    }

    // Quick toggles
    let prefetch = config
        .get("quickCorrectionPrefetch")
        .and_then(Value::as_bool);
    if prefetch.is_none() {
        config.insert(String::from("quickCorrectionPrefetch"), Value::Bool(false));
        changed = true;
    }

    let hide_on_blur = config.get("quickHideOnBlur").and_then(Value::as_bool);
    if hide_on_blur.is_none() {
        config.insert(String::from("quickHideOnBlur"), Value::Bool(true));
        changed = true;
    }

    // Selection hotkeys
    if let Some(sel_hotkeys) = config
        .get_mut("selectionHotkeys")
        .and_then(Value::as_object_mut)
    {
        if let Some(def_sel) = default_selection_hotkeys.as_object() {
            for (action, default_key) in def_sel {
                if !sel_hotkeys.contains_key(action) {
                    sel_hotkeys.insert(action.clone(), default_key.clone());
                    changed = true;
                }
            }
        }
    } else {
        config.insert(String::from("selectionHotkeys"), default_selection_hotkeys);
        changed = true;
    }

    // Selection replace
    let when_empty = config
        .get("selectionReplace")
        .and_then(|v| v.get("whenEmpty"))
        .and_then(Value::as_str);
    if !matches!(when_empty, Some("nothing" | "selectAll")) {
        config.insert(String::from("selectionReplace"), default_selection_replace);
        changed = true;
    }

    changed
}

fn normalize_appearance_config(user_config: &mut Value) -> bool {
    let defaults = default_user_config();
    let Some(config) = user_config.as_object_mut() else {
        return false;
    };
    let mut changed = false;

    let theme = config.get("theme").and_then(Value::as_str);
    if !matches!(theme, Some("auto" | "light" | "dark")) {
        config.insert(String::from("theme"), defaults["theme"].clone());
        changed = true;
    }

    let contrast = config.get("contrast").and_then(Value::as_str);
    if !matches!(contrast, Some("auto" | "normal" | "more")) {
        config.insert(String::from("contrast"), defaults["contrast"].clone());
        changed = true;
    }

    let motion = config.get("motion").and_then(Value::as_str);
    if !matches!(motion, Some("auto" | "normal" | "reduced")) {
        config.insert(String::from("motion"), defaults["motion"].clone());
        changed = true;
    }

    let ui_scale = config.get("uiScale").and_then(Value::as_u64);
    if !matches!(ui_scale, Some(70..=200)) {
        config.insert(String::from("uiScale"), defaults["uiScale"].clone());
        changed = true;
    }

    changed
}

fn normalize_language_config(user_config: &mut Value) -> bool {
    let defaults = default_user_config();
    let Some(config) = user_config.as_object_mut() else {
        return false;
    };
    let mut changed = false;

    if config.get("appLanguage").and_then(Value::as_str).is_none() {
        config.insert(String::from("appLanguage"), defaults["appLanguage"].clone());
        changed = true;
    }

    if config.get("userLanguage").and_then(Value::as_str).is_none() {
        config.insert(
            String::from("userLanguage"),
            defaults["userLanguage"].clone(),
        );
        changed = true;
    }

    let valid_to_translate = config
        .get("toTranslateLanguages")
        .and_then(Value::as_array)
        .map(|arr| arr.len() == 4)
        .unwrap_or(false);

    if !valid_to_translate {
        config.insert(
            String::from("toTranslateLanguages"),
            defaults["toTranslateLanguages"].clone(),
        );
        changed = true;
    }

    changed
}

fn normalize_editor_config(user_config: &mut Value) -> bool {
    let defaults = default_user_config();
    let Some(config) = user_config.as_object_mut() else {
        return false;
    };
    let mut changed = false;

    let paste_mode = config.get("pasteMode").and_then(Value::as_str);
    if !matches!(paste_mode, Some("markdown" | "plain" | "ask")) {
        config.insert(String::from("pasteMode"), defaults["pasteMode"].clone());
        changed = true;
    }

    let editor_syntax = config.get("editorSyntax").and_then(Value::as_str);
    if !matches!(editor_syntax, Some("markdown" | "none")) {
        config.insert(
            String::from("editorSyntax"),
            defaults["editorSyntax"].clone(),
        );
        changed = true;
    }

    if config
        .get("editorHistoryMaxItems")
        .and_then(Value::as_u64)
        .is_none()
    {
        config.insert(
            String::from("editorHistoryMaxItems"),
            defaults["editorHistoryMaxItems"].clone(),
        );
        changed = true;
    }

    if config
        .get("chatHistoryMaxItems")
        .and_then(Value::as_u64)
        .is_none()
    {
        config.insert(
            String::from("chatHistoryMaxItems"),
            defaults["chatHistoryMaxItems"].clone(),
        );
        changed = true;
    }

    changed
}

fn normalize_translation_config(user_config: &mut Value) -> bool {
    let defaults = default_user_config();
    let default_translation = &defaults["translation"];
    let Some(config) = user_config.as_object_mut() else {
        return false;
    };
    let mut changed = false;

    let Some(translation) = config.get_mut("translation").and_then(Value::as_object_mut) else {
        config.insert(String::from("translation"), default_translation.clone());
        return true;
    };

    let provider = translation.get("provider").and_then(Value::as_str);
    if !matches!(provider, Some("deepl" | "google" | "llm")) {
        translation.insert(
            String::from("provider"),
            default_translation["provider"].clone(),
        );
        changed = true;
    }

    let quality_gate = translation.get("qualityGate").and_then(Value::as_str);
    if !matches!(quality_gate, Some("off" | "on_problems" | "always")) {
        translation.insert(
            String::from("qualityGate"),
            default_translation["qualityGate"].clone(),
        );
        changed = true;
    }

    let deepl_endpoint = translation.get("deeplEndpoint").and_then(Value::as_str);
    if !matches!(deepl_endpoint, Some("free" | "pro")) {
        translation.insert(
            String::from("deeplEndpoint"),
            default_translation["deeplEndpoint"].clone(),
        );
        changed = true;
    }

    if translation
        .get("glossary")
        .and_then(Value::as_array)
        .is_none()
    {
        translation.insert(String::from("glossary"), json!([]));
        changed = true;
    }

    changed
}

fn normalize_main_actions_config(user_config: &mut Value) -> bool {
    let defaults = default_user_config();
    let Some(config) = user_config.as_object_mut() else {
        return false;
    };

    if config
        .get("mainActions")
        .and_then(Value::as_array)
        .is_none()
    {
        config.insert(String::from("mainActions"), defaults["mainActions"].clone());
        return true;
    }

    false
}

fn normalize_ai_rules_and_tasks(user_config: &mut Value) -> bool {
    let defaults = default_user_config();
    let default_rules = &defaults["aiRules"];
    let Some(config) = user_config.as_object_mut() else {
        return false;
    };
    let mut changed = false;

    if config.remove("chatRoles").is_some() {
        changed = true;
    }

    if let Some(rules) = config.get_mut("aiRules").and_then(Value::as_object_mut) {
        if let Some(def_rules) = default_rules.as_object() {
            for (key, default_val) in def_rules {
                if rules.get(key).and_then(Value::as_str).is_none() {
                    rules.insert(key.clone(), default_val.clone());
                    changed = true;
                }
            }
        }
    } else {
        config.insert(String::from("aiRules"), default_rules.clone());
        changed = true;
    }

    if config.get("aiTasks").and_then(Value::as_array).is_none() {
        config.insert(String::from("aiTasks"), defaults["aiTasks"].clone());
        changed = true;
    }

    if config.get("plugins").and_then(Value::as_object).is_none() {
        config.insert(String::from("plugins"), json!({}));
        changed = true;
    }

    changed
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
    let default_paste_shortcut = default_window_insertion
        .get("pasteShortcut")
        .and_then(Value::as_str)
        .unwrap_or("ctrl+v");

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
    let paste_shortcut = window_insertion
        .and_then(|value| value.get("pasteShortcut"))
        .and_then(Value::as_str)
        .filter(|value| *value == "ctrl+v" || *value == "ctrl+shift+v" || *value == "shift+insert")
        .unwrap_or(default_paste_shortcut);
    let normalized = json!({
        "method": method,
        "xdotoolBin": xdotool_bin,
        "ydotoolBin": ydotool_bin,
        "pasteShortcut": paste_shortcut,
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
    write_private(&path, &serde_yaml::to_string(user_config)?)
}

pub fn read_or_create_local_state(app: &AppHandle) -> Result<LocalState, AppError> {
    let path = app_config_dir(app)?.join(STATE_FILE_NAME);

    if let Some(state) = read_or_quarantine(&path, |raw| Ok(serde_json::from_str(raw)?))? {
        return Ok(state);
    }

    let default_state = LocalState::default();
    save_local_state(app, &default_state)?;

    Ok(default_state)
}

/// `current` with the fields of `patch` replaced; a `null` clears a field.
pub fn merge_local_state(
    current: &LocalState,
    patch: serde_json::Map<String, Value>,
) -> Result<LocalState, AppError> {
    let mut merged = serde_json::to_value(current)?;
    if let Some(fields) = merged.as_object_mut() {
        fields.extend(patch);
    }
    Ok(serde_json::from_value(merged)?)
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

    upsert_chat_index(&mut history, &chat_history_item, limit);
    remove_orphan_chat_files(&chats_dir, &history)?;

    write_json(&chats_dir.join("index.json"), &history)
}

/// Puts the chat on top of the index, without its messages to keep the index
/// small. The chat just written is the most recent one, also when it existed
/// before; otherwise the limit could drop the very chat in use.
fn upsert_chat_index(history: &mut Vec<ChatHistoryItem>, chat: &ChatHistoryItem, limit: usize) {
    let mut index_item = chat.clone();
    index_item.messages = Vec::new();
    history.retain(|item| item.id != index_item.id);
    history.insert(0, index_item);
    history.truncate(limit);
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
    let file_name = format!("{}.json", sanitize_chat_id(&id)?);
    let chats_dir = app_data_sub_dir(app, "chats")?;
    let mut history = get_chat_history(app)?;
    history.retain(|item| item.id != id);
    write_json(&chats_dir.join("index.json"), &history)?;

    let chat_file_path = chats_dir.join(file_name);
    if chat_file_path.exists() {
        if let Err(error) = fs::remove_file(&chat_file_path) {
            log::warn!("Could not remove {}: {error}", chat_file_path.display());
        }
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
                if let Err(error) = fs::remove_file(&path) {
                    log::warn!("Could not remove {}: {error}", path.display());
                }
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
    fn merge_local_state_replaces_only_the_patched_fields() {
        let current = LocalState {
            last_chat_id: Some(String::from("chat")),
            last_mode: Some(String::from("editor")),
        };
        let patch = json!({ "lastMode": "write" });

        let merged = merge_local_state(&current, patch.as_object().unwrap().clone()).unwrap();

        assert_eq!(merged.last_chat_id.as_deref(), Some("chat"));
        assert_eq!(merged.last_mode.as_deref(), Some("write"));

        let cleared = merge_local_state(
            &merged,
            json!({ "lastChatId": null }).as_object().unwrap().clone(),
        )
        .unwrap();
        assert_eq!(cleared.last_chat_id, None);
    }

    #[test]
    fn merge_local_state_rejects_a_mistyped_field() {
        let patch = json!({ "lastMode": 1 });
        assert!(
            merge_local_state(&LocalState::default(), patch.as_object().unwrap().clone()).is_err()
        );
    }

    #[test]
    fn upsert_chat_index_moves_an_updated_chat_to_the_top() {
        let mut history = vec![chat_item("a"), chat_item("b"), chat_item("c")];
        let mut updated = chat_item("c");
        updated.description = String::from("updated");

        upsert_chat_index(&mut history, &updated, 3);

        let ids: Vec<_> = history.iter().map(|item| item.id.as_str()).collect();
        assert_eq!(ids, ["c", "a", "b"]);
        assert_eq!(history[0].description, "updated");
        assert!(history[0].messages.is_empty());
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
                "pasteShortcut": "ctrl+v",
            })
        );
    }

    #[test]
    fn normalize_window_insertion_replaces_an_unknown_method() {
        let mut config = json!({ "windowInsertion": { "method": "wtype" } });

        assert!(normalize_window_insertion_config(&mut config));
        assert_eq!(config["windowInsertion"]["method"], json!("xdotool"));
        assert_eq!(config["windowInsertion"]["pasteShortcut"], json!("ctrl+v"));
    }

    #[test]
    fn normalize_window_insertion_is_idempotent() {
        let mut config = json!({});

        assert!(normalize_window_insertion_config(&mut config));
        assert!(!normalize_window_insertion_config(&mut config));
    }

    #[test]
    fn normalize_stt_keeps_only_deepgram_and_its_settings() {
        let mut config = json!({
            "sttModels": [
                { "id": "assemblyai-stt", "provider": "assemblyai", "model": "universal-3-pro" },
                {
                    "id": "deepgram-stt",
                    "provider": "deepgram",
                    "model": "nova-3-general",
                    "formatWithLlm": false
                }
            ],
            "aiModelUsage": { "stt": "assemblyai-stt" }
        });

        assert!(normalize_stt_config(&mut config));
        assert_eq!(
            config["sttModels"],
            json!([{
                "id": "deepgram-stt",
                "provider": "deepgram",
                "model": "nova-3-general",
                "description": "Deepgram speech recognition",
                "formatWithLlm": false,
                "language": "auto"
            }])
        );
        assert_eq!(config["aiModelUsage"], json!({ "stt": "deepgram-stt" }));
        assert!(!normalize_stt_config(&mut config));
    }

    #[test]
    fn normalize_stt_fills_a_missing_section() {
        let mut config = json!({});

        assert!(normalize_stt_config(&mut config));
        assert_eq!(config["sttModels"], default_user_config()["sttModels"]);
        assert_eq!(config["aiModelUsage"]["stt"], json!("deepgram-stt"));
        assert!(!normalize_stt_config(&mut config));
    }

    #[test]
    fn normalize_hotkeys_adds_defaults_and_keeps_overrides() {
        let mut config = json!({ "hotkeys": { "editor": "Super+Space" } });

        assert!(normalize_hotkeys_config(&mut config));
        assert_eq!(config["hotkeys"]["editor"], json!("Super+Space"));
        assert_eq!(config["hotkeys"]["voice"], json!("Ctrl+Alt+V"));
        assert_eq!(
            config["quickInputHotkeys"]["correctAndInsert"],
            json!("Enter")
        );
        assert_eq!(config["quickCorrectionPrefetch"], json!(false));
        assert_eq!(config["quickHideOnBlur"], json!(true));
        assert!(!normalize_hotkeys_config(&mut config));
    }

    #[test]
    fn normalize_appearance_and_language_fills_defaults() {
        let mut config = json!({ "theme": "invalid-theme" });

        assert!(normalize_appearance_config(&mut config));
        assert_eq!(config["theme"], json!("auto"));
        assert_eq!(config["uiScale"], json!(100));
        assert!(!normalize_appearance_config(&mut config));

        assert!(normalize_language_config(&mut config));
        assert_eq!(config["appLanguage"], json!("auto"));
        assert_eq!(
            config["toTranslateLanguages"],
            json!(["en_US", "ru_RU", "es_AR", "tr_TR"])
        );
        assert!(!normalize_language_config(&mut config));
    }

    #[test]
    fn normalize_editor_and_translation_fills_defaults() {
        let mut config = json!({ "pasteMode": "invalid" });

        assert!(normalize_editor_config(&mut config));
        assert_eq!(config["pasteMode"], json!("markdown"));
        assert_eq!(config["editorSyntax"], json!("markdown"));
        assert_eq!(config["editorHistoryMaxItems"], json!(100));
        assert!(!normalize_editor_config(&mut config));

        assert!(normalize_translation_config(&mut config));
        assert_eq!(config["translation"]["provider"], json!("llm"));
        assert_eq!(config["translation"]["qualityGate"], json!("on_problems"));
        assert!(!normalize_translation_config(&mut config));
    }

    #[test]
    fn normalize_ai_rules_and_tasks_cleans_legacy() {
        let mut config = json!({
            "chatRoles": ["assistant", "user"],
            "aiRules": { "base": "custom base rule" }
        });

        assert!(normalize_ai_rules_and_tasks(&mut config));
        assert!(config.get("chatRoles").is_none());
        assert_eq!(config["aiRules"]["base"], json!("custom base rule"));
        assert!(config["aiRules"]["translate"].as_str().is_some());
        assert!(config["aiTasks"].as_array().is_some());
        assert!(!normalize_ai_rules_and_tasks(&mut config));
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
