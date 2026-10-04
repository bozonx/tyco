use std::fs;
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::errors::AppError;
use crate::models::{
    default_user_config, ChatHistoryItem, EditorHistoryEntry, EditorHistoryItem, EditorHistoryKind,
    LocalState, StorageInfo, StorageKind, StorageLocation, CONFIG_FILE_NAME, STATE_FILE_NAME,
};
use crate::services::atomic_file::{read_or_quarantine, write_private};
use crate::services::secret_detector::redact_secrets;
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

pub fn app_log_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = AppPaths::resolve(app)?.log_dir;
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn app_state_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = AppPaths::resolve(app)?.state_dir;
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn get_storage_info(app: &AppHandle) -> Result<StorageInfo, AppError> {
    Ok(StorageInfo {
        locations: group_storage_locations([
            (StorageKind::Config, app_config_dir(app)?),
            (StorageKind::Data, app_data_dir(app)?),
            (StorageKind::Cache, app_cache_dir(app)?),
            (StorageKind::Logs, app_log_dir(app)?),
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

/// One speech model per provider: the defaults with the user's own settings
/// for that provider laid over them. Entries of unknown providers are dropped,
/// and the active model falls back to the first default when it is not one of
/// them.
fn normalize_stt_config(user_config: &mut Value) -> bool {
    let defaults = default_user_config();
    let default_models: Vec<Value> = defaults
        .get("sttModels")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let Some(config) = user_config.as_object_mut() else {
        return false;
    };
    let existing: Vec<&serde_json::Map<String, Value>> = config
        .get("sttModels")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_object)
        .collect();

    let models: Vec<Value> = default_models
        .iter()
        .filter_map(Value::as_object)
        .map(|default_model| {
            let mut model = default_model.clone();
            let provider = default_model.get("provider");
            if let Some(own) = existing
                .iter()
                .find(|model| provider.is_some() && model.get("provider") == provider)
            {
                model.extend((*own).clone());
            }
            if let Some(id) = default_model.get("id") {
                model.insert(String::from("id"), id.clone());
            }
            Value::Object(model)
        })
        .collect();

    let mut usage = config
        .get("aiModelUsage")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let active_is_known = usage
        .get("stt")
        .is_some_and(|active| models.iter().any(|model| model.get("id") == Some(active)));
    if !active_is_known {
        let first_id = models
            .first()
            .and_then(|model| model.get("id"))
            .cloned()
            .unwrap_or(Value::Null);
        usage.insert(String::from("stt"), first_id);
    }
    let models = Value::Array(models);
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
    let default_selection_hotkeys = defaults
        .get("selectionHotkeys")
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
    // the correction with review is no longer a global hotkey
    hotkeys.remove("correction");
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

    // The per-action quick input bindings gave way to a single submit key:
    // whoever sent with Ctrl+Enter keeps doing so
    let legacy_submit = config
        .remove("quickInputHotkeys")
        .map(|quick| quick.get("correctAndInsert").and_then(Value::as_str) == Some("Ctrl+Enter"));
    if legacy_submit.is_some() {
        changed = true;
    }
    let submit_key = config.get("submitKey").and_then(Value::as_str);
    if !matches!(submit_key, Some("enter" | "ctrlEnter")) {
        let migrated = if legacy_submit == Some(true) {
            "ctrlEnter"
        } else {
            "enter"
        };
        config.insert(String::from("submitKey"), Value::String(migrated.into()));
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

    // Selection hotkeys: only the correction replaces the selection from a
    // hotkey, translations and AI tasks no longer do
    if let Some(sel_hotkeys) = config
        .get_mut("selectionHotkeys")
        .and_then(Value::as_object_mut)
    {
        let before = sel_hotkeys.len();
        sel_hotkeys.retain(|action, _| default_selection_hotkeys.get(action).is_some());
        changed |= sel_hotkeys.len() != before;
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

    // Replacing the selection always takes the selection, never the whole field
    if config.remove("selectionReplace").is_some() {
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
    // the storage replaced the "memory only" flag and the zero limit that
    // turned the history off; the limit then gets a usable value for when the
    // history is turned on again
    let storage = EditorHistoryStorage::from_config(user_config);
    let zero_limit = history_limit(
        user_config,
        "editorHistoryMaxItems",
        DEFAULT_EDITOR_HISTORY_LIMIT,
    ) == 0;
    let Some(config) = user_config.as_object_mut() else {
        return false;
    };
    let mut changed = false;

    // highlighting and HTML conversion on paste are no longer settings, and
    // the "memory only" flag became the storage
    for removed in ["pasteMode", "editorSyntax", "clearEditorHistoryOnExit"] {
        changed |= config.remove(removed).is_some();
    }

    if config.get("editorHistoryStorage").and_then(Value::as_str) != Some(storage.as_str()) {
        config.insert(
            String::from("editorHistoryStorage"),
            Value::String(storage.as_str().into()),
        );
        changed = true;
    }

    if storage == EditorHistoryStorage::Off && zero_limit {
        config.insert(
            String::from("editorHistoryMaxItems"),
            defaults["editorHistoryMaxItems"].clone(),
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
        .get("editorHistoryRetentionDays")
        .and_then(Value::as_u64)
        .is_none()
    {
        config.insert(
            String::from("editorHistoryRetentionDays"),
            defaults["editorHistoryRetentionDays"].clone(),
        );
        changed = true;
    }

    if config
        .get("sanitizeSecretsInEditorHistory")
        .and_then(Value::as_bool)
        .is_none()
    {
        config.insert(
            String::from("sanitizeSecretsInEditorHistory"),
            defaults["sanitizeSecretsInEditorHistory"].clone(),
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
        // the common rule was replaced by per-task rules
        if rules.remove("base").is_some() {
            changed = true;
        }
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
    let path = app_state_dir(app)?.join(STATE_FILE_NAME);
    move_legacy_file(&app_config_dir(app)?.join(STATE_FILE_NAME), &path);

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

/// Moves a file kept by an older version to its current place, unless that
/// already has one. A failure only costs what the file remembered.
fn move_legacy_file(legacy: &Path, path: &Path) {
    if legacy == path || !legacy.exists() || path.exists() {
        return;
    }
    if let Err(error) = fs::rename(legacy, path) {
        log::warn!(
            "Could not move {} to {}: {error}",
            legacy.display(),
            path.display()
        );
    }
}

pub fn save_local_state(app: &AppHandle, local_state: &LocalState) -> Result<(), AppError> {
    let path = app_state_dir(app)?.join(STATE_FILE_NAME);
    write_json(&path, local_state)?;
    Ok(())
}

const EDITOR_HISTORY_FILE: &str = "editor-history.jsonl";
const DEFAULT_EDITOR_HISTORY_LIMIT: usize = 100;
const DEFAULT_CHAT_HISTORY_LIMIT: usize = 50;
const DAY_MS: u64 = 24 * 60 * 60 * 1000;

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

/// Entries without a date (the legacy format) get the time the file was last
/// written: the latest they can be from, so that the retention period applies
/// to them too.
fn read_editor_history(path: &Path) -> Result<Vec<EditorHistoryItem>, AppError> {
    let lines: Vec<StoredEditorHistoryLine> = read_jsonl(path)?;
    let file_time = || {
        fs::metadata(path)
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .and_then(|duration| u64::try_from(duration.as_millis()).ok())
            .unwrap_or_else(now_ms)
    };

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
                sent: false,
            },
        })
        .map(|mut item| {
            if item.created_at == 0 {
                item.created_at = file_time();
            }
            item
        })
        .collect())
}

fn remove_file_if_exists(path: &Path) -> Result<(), AppError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

/// Where the editor history lives.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EditorHistoryStorage {
    /// Nothing is kept.
    Off,
    /// The memory of the process only: nothing outlives the app.
    Session,
    Disk,
}

impl EditorHistoryStorage {
    /// Configs older than the setting said it with a zero limit (off) and the
    /// `clearEditorHistoryOnExit` flag (session).
    pub fn from_config(user_config: &Value) -> Self {
        match user_config
            .get("editorHistoryStorage")
            .and_then(Value::as_str)
        {
            Some("off") => return Self::Off,
            Some("session") => return Self::Session,
            Some("disk") => return Self::Disk,
            _ => {}
        }

        if history_limit(
            user_config,
            "editorHistoryMaxItems",
            DEFAULT_EDITOR_HISTORY_LIMIT,
        ) == 0
        {
            Self::Off
        } else if user_config
            .get("clearEditorHistoryOnExit")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            Self::Session
        } else {
            Self::Disk
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Session => "session",
            Self::Disk => "disk",
        }
    }
}

/// What the settings say about the editor history.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EditorHistoryPolicy {
    /// How many entries to keep; 0 keeps none.
    pub limit: usize,
    /// The entries live in the memory of the process only and never reach the
    /// disk, so nothing of them outlives the app, whichever way it ends.
    pub memory_only: bool,
    /// Entries older than this many days are dropped; 0 keeps them forever.
    /// Applies on the disk only, as does `sanitize`.
    pub retention_days: u64,
    /// What looks like a password or a key is masked before it is stored.
    pub sanitize: bool,
}

impl EditorHistoryPolicy {
    pub fn from_config(user_config: &Value) -> Self {
        let flag = |key: &str| {
            user_config
                .get(key)
                .and_then(Value::as_bool)
                .unwrap_or(false)
        };

        let storage = EditorHistoryStorage::from_config(user_config);
        let on_disk = storage == EditorHistoryStorage::Disk;

        Self {
            limit: if storage == EditorHistoryStorage::Off {
                0
            } else {
                history_limit(
                    user_config,
                    "editorHistoryMaxItems",
                    DEFAULT_EDITOR_HISTORY_LIMIT,
                )
            },
            memory_only: storage == EditorHistoryStorage::Session,
            retention_days: if on_disk {
                user_config
                    .get("editorHistoryRetentionDays")
                    .and_then(Value::as_u64)
                    .unwrap_or(0)
            } else {
                0
            },
            sanitize: on_disk && flag("sanitizeSecretsInEditorHistory"),
        }
    }

    fn redact(&self, text: String) -> String {
        if self.sanitize {
            redact_secrets(&text)
        } else {
            text
        }
    }

    /// Brings stored entries in line with the settings: drops those past the
    /// retention period or over the limit and masks secrets when asked, also
    /// in entries stored before the setting was turned on.
    fn enforce(&self, history: &mut Vec<EditorHistoryItem>, now_ms: u64) {
        if self.retention_days > 0 {
            let cutoff = now_ms.saturating_sub(self.retention_days.saturating_mul(DAY_MS));
            history.retain(|item| item.created_at >= cutoff);
        }
        history.truncate(self.limit);
        if self.sanitize {
            for item in history.iter_mut() {
                item.text = redact_secrets(&item.text);
                item.result = item.result.take().map(|result| redact_secrets(&result));
            }
        }
    }
}

/// Where the editor history lives: its file, or the memory of the process.
enum EditorHistoryStore<'a> {
    File(PathBuf),
    Memory(&'a mut Vec<EditorHistoryItem>),
}

impl EditorHistoryStore<'_> {
    fn read(&self) -> Result<Vec<EditorHistoryItem>, AppError> {
        match self {
            Self::File(path) => read_editor_history(path),
            Self::Memory(items) => Ok(items.to_vec()),
        }
    }

    /// An empty history leaves no file behind.
    fn write(&mut self, items: Vec<EditorHistoryItem>) -> Result<(), AppError> {
        match self {
            Self::File(path) if items.is_empty() => remove_file_if_exists(path),
            Self::File(path) => write_jsonl(path, &items),
            Self::Memory(memory) => {
                **memory = items;
                Ok(())
            }
        }
    }
}

/// The editor history as the settings let it be seen and changed.
struct EditorHistory<'a> {
    store: EditorHistoryStore<'a>,
    policy: EditorHistoryPolicy,
}

impl<'a> EditorHistory<'a> {
    /// `memory` holds the entries while the history is kept in memory only.
    fn open(
        app: &AppHandle,
        user_config: &Value,
        memory: &'a mut Vec<EditorHistoryItem>,
    ) -> Result<Self, AppError> {
        let policy = EditorHistoryPolicy::from_config(user_config);
        let store = if policy.memory_only {
            EditorHistoryStore::Memory(memory)
        } else {
            EditorHistoryStore::File(editor_history_path(app)?)
        };

        Ok(Self { store, policy })
    }

    fn load(&self) -> Result<Vec<EditorHistoryItem>, AppError> {
        let mut items = self.store.read()?;
        self.policy.enforce(&mut items, now_ms());
        Ok(items)
    }

    fn save(&mut self, items: Vec<EditorHistoryItem>) -> Result<(), AppError> {
        self.store.write(items)
    }
}

pub fn get_editor_history(
    app: &AppHandle,
    user_config: &Value,
    memory: &mut Vec<EditorHistoryItem>,
) -> Result<Vec<EditorHistoryItem>, AppError> {
    EditorHistory::open(app, user_config, memory)?.load()
}

/// Adds an entry and returns its id, or `None` when nothing was stored: the
/// text is blank or the history is turned off
pub fn save_editor_history(
    app: &AppHandle,
    user_config: &Value,
    memory: &mut Vec<EditorHistoryItem>,
    entry: EditorHistoryEntry,
) -> Result<Option<String>, AppError> {
    save_editor_history_entry(&mut EditorHistory::open(app, user_config, memory)?, entry)
}

fn save_editor_history_entry(
    history: &mut EditorHistory,
    mut entry: EditorHistoryEntry,
) -> Result<Option<String>, AppError> {
    let policy = history.policy;

    if entry.text.trim().is_empty() || policy.limit == 0 {
        return Ok(None);
    }

    entry.text = policy.redact(entry.text);

    let mut items = history.load()?;
    let created_at = now_ms();
    let item = EditorHistoryItem {
        id: new_history_id(created_at),
        text: entry.text,
        kind: entry.kind,
        operation: entry.operation,
        created_at,
        result: None,
        sent: false,
    };

    let id = push_editor_history(&mut items, item, entry.replace_id.as_deref(), policy.limit);
    history.save(items)?;

    Ok(Some(id))
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

/// Puts `item` on top and returns the id of the entry that now holds the text.
/// Draft snapshots are collapsed, and repeated outputs are moved to the top.
/// Sources stay separate because the same text may be used by several AI
/// operations and every result must remain attached to its source. A draft or
/// an output of an AI result is not a new entry: its source is moved to the top
/// instead, marked as sent in the case of an output.
fn push_editor_history(
    history: &mut Vec<EditorHistoryItem>,
    mut item: EditorHistoryItem,
    replace_id: Option<&str>,
    limit: usize,
) -> String {
    if let Some(replace_id) = replace_id {
        history.retain(|existing| {
            existing.id != replace_id || existing.kind != EditorHistoryKind::Draft
        });
    }

    let text = item.text.trim();

    if item.kind != EditorHistoryKind::Source {
        if let Some(index) = history.iter().position(|existing| {
            existing.kind == EditorHistoryKind::Source
                && existing.result.as_deref().map(str::trim) == Some(text)
        }) {
            let mut source = history.remove(index);
            source.sent |= item.kind == EditorHistoryKind::Output;
            source.created_at = item.created_at;
            history.retain(|existing| {
                existing.kind == EditorHistoryKind::Source || existing.text.trim() != text
            });

            let id = source.id.clone();
            history.insert(0, source);
            history.truncate(limit);
            return id;
        }
    }

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

    let id = item.id.clone();
    history.insert(0, item);
    history.truncate(limit);
    id
}

/// Attaches the AI result to the `Source` entry it was produced from.
pub fn set_editor_history_result(
    app: &AppHandle,
    user_config: &Value,
    memory: &mut Vec<EditorHistoryItem>,
    id: String,
    result: String,
) -> Result<(), AppError> {
    let mut history = EditorHistory::open(app, user_config, memory)?;
    let result = history.policy.redact(result);
    let mut items = history.load()?;

    if !apply_editor_history_result(&mut items, &id, result) {
        return Ok(());
    }

    history.save(items)
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
    memory: &mut Vec<EditorHistoryItem>,
    mut item: EditorHistoryItem,
) -> Result<(), AppError> {
    let mut history = EditorHistory::open(app, user_config, memory)?;
    let policy = history.policy;

    if policy.limit == 0 {
        return Ok(());
    }

    item.text = policy.redact(item.text);
    item.result = item.result.map(|result| policy.redact(result));

    let mut items = history.load()?;

    if insert_restored_item(&mut items, item, policy.limit) {
        history.save(items)?;
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

pub fn remove_from_editor_history(
    app: &AppHandle,
    user_config: &Value,
    memory: &mut Vec<EditorHistoryItem>,
    id: String,
) -> Result<(), AppError> {
    let mut history = EditorHistory::open(app, user_config, memory)?;
    let mut items = history.load()?;
    items.retain(|item| item.id != id);
    history.save(items)
}

/// Removes every entry, from the memory and from the disk, whichever of them
/// the settings use now.
pub fn clear_editor_history(
    app: &AppHandle,
    memory: &mut Vec<EditorHistoryItem>,
) -> Result<(), AppError> {
    memory.clear();
    remove_file_if_exists(&editor_history_path(app)?)
}

/// Applies the history settings to what is stored. At startup the
/// memory-only mode means that the history of the previous run is gone, also
/// when that run ended without a chance to clean up.
pub fn apply_history_settings_on_startup(
    app: &AppHandle,
    user_config: &Value,
) -> Result<(), AppError> {
    let policy = EditorHistoryPolicy::from_config(user_config);
    let path = editor_history_path(app)?;

    if policy.memory_only {
        remove_file_if_exists(&path)?;
    } else {
        enforce_editor_history_file(&path, &policy, now_ms())?;
    }

    enforce_chat_history_limit(app, chat_history_limit(user_config))
}

fn enforce_editor_history_file(
    path: &Path,
    policy: &EditorHistoryPolicy,
    now_ms: u64,
) -> Result<(), AppError> {
    let stored = read_editor_history(path)?;
    let mut items = stored.clone();
    policy.enforce(&mut items, now_ms);

    if items != stored {
        EditorHistoryStore::File(path.to_path_buf()).write(items)?;
    }

    Ok(())
}

/// Applies a change of the history settings right away, as far as it is safe
/// to: the limit field passes through intermediate values while the user
/// types, so a lower limit or a shorter retention period are applied on the
/// next write or start instead. Turning the history off (limit 0) does delete
/// what is stored, as the settings promise.
pub fn apply_history_settings_change(
    app: &AppHandle,
    previous_config: &Value,
    user_config: &Value,
    memory: &mut Vec<EditorHistoryItem>,
) -> Result<(), AppError> {
    let before = EditorHistoryPolicy::from_config(previous_config);
    let after = EditorHistoryPolicy::from_config(user_config);
    let path = editor_history_path(app)?;

    switch_editor_history_store(&path, &before, &after, memory, now_ms())?;

    if chat_history_limit(user_config) == 0 && chat_history_limit(previous_config) != 0 {
        clear_chat_history(app)?;
    }

    Ok(())
}

fn switch_editor_history_store(
    path: &Path,
    before: &EditorHistoryPolicy,
    after: &EditorHistoryPolicy,
    memory: &mut Vec<EditorHistoryItem>,
    now_ms: u64,
) -> Result<(), AppError> {
    let mut file = EditorHistoryStore::File(path.to_path_buf());

    if after.memory_only != before.memory_only {
        // the entries move to where the history lives now
        let mut items = if after.memory_only {
            file.read()?
        } else {
            std::mem::take(memory)
        };
        after.enforce(&mut items, now_ms);

        if after.memory_only {
            *memory = items;
            return remove_file_if_exists(path);
        }
        return file.write(items);
    }

    let turned_off = after.limit == 0 && before.limit != 0;
    let sanitize_turned_on = after.sanitize && !before.sanitize;

    if turned_off || sanitize_turned_on {
        let mut store = if after.memory_only {
            EditorHistoryStore::Memory(memory)
        } else {
            file
        };
        let mut items = store.read()?;
        after.enforce(&mut items, now_ms);
        store.write(items)?;
    }

    Ok(())
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
    let limit = chat_history_limit(user_config);

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

/// Gives a stored chat another title. Neither its messages nor its place in
/// the index change: a rename is not activity in the chat.
pub fn rename_chat(app: &AppHandle, id: String, description: String) -> Result<(), AppError> {
    let chats_dir = app_data_sub_dir(app, "chats")?;
    let Some(mut chat) = get_chat(app, id.clone())? else {
        return Err(AppError::Message(String::from("Chat not found")));
    };
    chat.description = description;
    write_json(
        &chats_dir.join(format!("{}.json", sanitize_chat_id(&id)?)),
        &chat,
    )?;

    let mut history = get_chat_history(app)?;
    rename_in_chat_index(&mut history, &id, &chat.description);
    write_json(&chats_dir.join("index.json"), &history)
}

fn rename_in_chat_index(history: &mut [ChatHistoryItem], id: &str, description: &str) {
    if let Some(item) = history.iter_mut().find(|item| item.id == id) {
        item.description = description.to_string();
    }
}

/// Ids of the chats whose title or messages contain `query`, in index order.
/// The index holds no messages, so each chat file is read.
pub fn search_chat_history(app: &AppHandle, query: String) -> Result<Vec<String>, AppError> {
    let history = get_chat_history(app)?;
    let mut found = Vec::new();

    for item in history {
        let matches = match get_chat(app, item.id.clone()) {
            Ok(Some(chat)) => chat_matches(&chat, &query),
            _ => chat_matches(&item, &query),
        };
        if matches {
            found.push(item.id);
        }
    }

    Ok(found)
}

fn chat_matches(chat: &ChatHistoryItem, query: &str) -> bool {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return true;
    }

    chat.description.to_lowercase().contains(&query)
        || chat
            .messages
            .iter()
            .any(|message| message.content.to_lowercase().contains(&query))
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

fn chat_history_limit(user_config: &Value) -> usize {
    history_limit(
        user_config,
        "chatHistoryMaxItems",
        DEFAULT_CHAT_HISTORY_LIMIT,
    )
}

/// Drops the oldest chats over `limit`, and all of them when it is 0.
fn enforce_chat_history_limit(app: &AppHandle, limit: usize) -> Result<(), AppError> {
    if limit == 0 {
        return clear_chat_history(app);
    }

    let mut history = get_chat_history(app)?;
    if history.len() <= limit {
        return Ok(());
    }

    let chats_dir = app_data_sub_dir(app, "chats")?;
    history.truncate(limit);
    write_json(&chats_dir.join("index.json"), &history)?;
    remove_orphan_chat_files(&chats_dir, &history)
}

/// Removes the index and every chat file.
pub fn clear_chat_history(app: &AppHandle) -> Result<(), AppError> {
    let chats_dir = app_data_sub_dir(app, "chats")?;

    for entry in fs::read_dir(&chats_dir)?.flatten() {
        let path = entry.path();
        if path.is_file() {
            remove_file_if_exists(&path)?;
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
            last_chat_model_id: None,
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
    fn rename_in_chat_index_keeps_the_order() {
        let mut history = vec![chat_item("a"), chat_item("b")];

        rename_in_chat_index(&mut history, "b", "renamed");

        assert_eq!(history[0].id, "a");
        assert_eq!(history[1].id, "b");
        assert_eq!(history[1].description, "renamed");
    }

    #[test]
    fn chat_matches_the_title_and_the_messages_ignoring_case() {
        let mut chat = chat_item("a");
        chat.description = String::from("Trip plan");
        chat.messages = vec![crate::models::ChatMessage {
            role: String::from("user"),
            content: String::from("Где купить БИЛЕТЫ?"),
            attachments: Vec::new(),
            status: None,
        }];

        assert!(chat_matches(&chat, "trip"));
        assert!(chat_matches(&chat, " билеты "));
        assert!(!chat_matches(&chat, "hotel"));
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
        let expected_method = if crate::services::platform::session::current().is_wayland() {
            "ydotool"
        } else {
            "xdotool"
        };
        assert_eq!(
            config["windowInsertion"],
            json!({
                "method": expected_method,
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
        let expected_method = if crate::services::platform::session::current().is_wayland() {
            "ydotool"
        } else {
            "xdotool"
        };
        assert_eq!(config["windowInsertion"]["method"], json!(expected_method));
        assert_eq!(config["windowInsertion"]["pasteShortcut"], json!("ctrl+v"));
    }

    #[test]
    fn normalize_window_insertion_is_idempotent() {
        let mut config = json!({});

        assert!(normalize_window_insertion_config(&mut config));
        assert!(!normalize_window_insertion_config(&mut config));
    }

    #[test]
    fn normalize_stt_keeps_one_model_per_known_provider_with_its_settings() {
        let mut config = json!({
            "sttModels": [
                { "id": "assemblyai-stt", "provider": "assemblyai", "model": "universal-3-pro" },
                {
                    "id": "deepgram-stt",
                    "provider": "deepgram",
                    "model": "nova-3-general",
                    "formatWithLlm": false
                },
                {
                    "id": "custom",
                    "provider": "sherpa-onnx",
                    "baseUrl": "ws://speech.lan:6006",
                    "formatWithLlm": true
                }
            ],
            "aiModelUsage": { "stt": "assemblyai-stt" }
        });

        assert!(normalize_stt_config(&mut config));
        assert_eq!(
            config["sttModels"],
            json!([
                {
                    "id": "deepgram-stt",
                    "provider": "deepgram",
                    "model": "nova-3-general",
                    "description": "Deepgram speech recognition",
                    "formatWithLlm": false,
                    "language": "auto"
                },
                {
                    "id": "sherpa-onnx-stt",
                    "provider": "sherpa-onnx",
                    "model": "sherpa-onnx",
                    "description": "Self-hosted sherpa-onnx streaming server",
                    "formatWithLlm": true,
                    "baseUrl": "ws://speech.lan:6006"
                }
            ])
        );
        assert_eq!(config["aiModelUsage"], json!({ "stt": "deepgram-stt" }));
        assert!(!normalize_stt_config(&mut config));
    }

    #[test]
    fn normalize_stt_keeps_the_chosen_provider() {
        let mut config = json!({ "aiModelUsage": { "stt": "sherpa-onnx-stt" } });

        assert!(normalize_stt_config(&mut config));
        assert_eq!(config["aiModelUsage"]["stt"], json!("sherpa-onnx-stt"));
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
        assert_eq!(config["submitKey"], json!("enter"));
        assert_eq!(config["quickCorrectionPrefetch"], json!(false));
        assert_eq!(config["quickHideOnBlur"], json!(true));
        assert!(!normalize_hotkeys_config(&mut config));
    }

    #[test]
    fn normalize_hotkeys_drops_removed_hotkeys() {
        let mut config = json!({
            "hotkeys": { "correction": "Ctrl+Alt+R" },
            "selectionHotkeys": { "correction": "Ctrl+Alt+X", "translate.0": "Ctrl+Alt+1" },
            "selectionReplace": { "whenEmpty": "selectAll" }
        });

        assert!(normalize_hotkeys_config(&mut config));
        assert!(config["hotkeys"].get("correction").is_none());
        assert_eq!(
            config["selectionHotkeys"],
            json!({ "correction": "Ctrl+Alt+X" })
        );
        assert!(config.get("selectionReplace").is_none());
        assert!(!normalize_hotkeys_config(&mut config));
    }

    #[test]
    fn normalize_hotkeys_migrates_quick_input_bindings_to_submit_key() {
        let mut ctrl = json!({
            "quickInputHotkeys": { "correctAndInsert": "Ctrl+Enter", "next": "Tab" }
        });
        assert!(normalize_hotkeys_config(&mut ctrl));
        assert_eq!(ctrl["submitKey"], json!("ctrlEnter"));
        assert!(ctrl.get("quickInputHotkeys").is_none());

        let mut enter = json!({ "quickInputHotkeys": { "correctAndInsert": "Ctrl+S" } });
        assert!(normalize_hotkeys_config(&mut enter));
        assert_eq!(enter["submitKey"], json!("enter"));

        let mut kept = json!({ "submitKey": "ctrlEnter" });
        normalize_hotkeys_config(&mut kept);
        assert_eq!(kept["submitKey"], json!("ctrlEnter"));

        let mut invalid = json!({ "submitKey": "Ctrl+Enter" });
        assert!(normalize_hotkeys_config(&mut invalid));
        assert_eq!(invalid["submitKey"], json!("enter"));
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
        let mut config = json!({ "pasteMode": "ask", "editorSyntax": "none" });

        assert!(normalize_editor_config(&mut config));
        assert!(config.get("pasteMode").is_none());
        assert!(config.get("editorSyntax").is_none());
        assert_eq!(config["editorHistoryStorage"], json!("disk"));
        assert_eq!(config["editorHistoryMaxItems"], json!(1000));
        assert_eq!(config["editorHistoryRetentionDays"], json!(30));
        assert_eq!(config["sanitizeSecretsInEditorHistory"], json!(true));
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
        assert!(config["aiRules"].get("base").is_none());
        assert_eq!(config["aiRules"]["chat"], json!(""));
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
            sent: false,
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
    fn push_editor_history_marks_the_source_of_a_sent_ai_result() {
        let mut source = history_item("a", "text", EditorHistoryKind::Source);
        source.result = Some(String::from("Text."));
        let mut history = vec![
            history_item("d", "Text.", EditorHistoryKind::Draft),
            history_item("o", "older", EditorHistoryKind::Output),
            source,
        ];
        let mut output = history_item("b", "Text.\n", EditorHistoryKind::Output);
        output.created_at = 5;

        let id = push_editor_history(&mut history, output, None, 10);

        assert_eq!(id, "a");
        assert_eq!(history_texts(&history), vec!["text", "older"]);
        assert!(history[0].sent);
        assert_eq!(history[0].created_at, 5);
        assert_eq!(history[0].kind, EditorHistoryKind::Source);
    }

    #[test]
    fn push_editor_history_keeps_an_ai_result_draft_in_its_source() {
        let mut source = history_item("a", "text", EditorHistoryKind::Source);
        source.result = Some(String::from("Text."));
        let mut history = vec![
            history_item("o", "older", EditorHistoryKind::Output),
            source,
        ];

        let id = push_editor_history(
            &mut history,
            history_item("d", "Text.", EditorHistoryKind::Draft),
            None,
            10,
        );

        assert_eq!(id, "a");
        assert_eq!(history_texts(&history), vec!["text", "older"]);
        assert!(!history[0].sent);
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
        // the time the file was written, so that the retention period applies
        assert!(history[0].created_at > 0);
        assert!(history[0].created_at <= now_ms());
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

        item.sent = true;

        assert_eq!(serde_json::to_value(&item).unwrap()["sent"], json!(true));
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

    fn policy() -> EditorHistoryPolicy {
        EditorHistoryPolicy {
            limit: 100,
            memory_only: false,
            retention_days: 0,
            sanitize: false,
        }
    }

    fn entry(text: &str) -> EditorHistoryEntry {
        serde_json::from_value(json!({ "text": text, "kind": "draft" })).unwrap()
    }

    #[test]
    fn normalize_editor_config_migrates_the_history_storage() {
        let mut session = json!({
            "editorHistoryMaxItems": 20,
            "clearEditorHistoryOnExit": true,
        });
        assert!(normalize_editor_config(&mut session));
        assert_eq!(session["editorHistoryStorage"], json!("session"));
        assert_eq!(session["editorHistoryMaxItems"], json!(20));
        assert!(session.get("clearEditorHistoryOnExit").is_none());

        let mut off = json!({
            "editorHistoryMaxItems": 0,
            "clearEditorHistoryOnExit": false,
        });
        assert!(normalize_editor_config(&mut off));
        assert_eq!(off["editorHistoryStorage"], json!("off"));
        assert_eq!(off["editorHistoryMaxItems"], json!(1000));
        assert!(!normalize_editor_config(&mut off));
    }

    #[test]
    fn policy_reads_the_settings() {
        let config = json!({
            "editorHistoryStorage": "disk",
            "editorHistoryMaxItems": "20",
            "editorHistoryRetentionDays": 7,
            "sanitizeSecretsInEditorHistory": true,
        });

        assert_eq!(
            EditorHistoryPolicy::from_config(&config),
            EditorHistoryPolicy {
                limit: 20,
                memory_only: false,
                retention_days: 7,
                sanitize: true,
            }
        );
        assert_eq!(
            EditorHistoryPolicy::from_config(&json!({
                "editorHistoryStorage": "session",
                "editorHistoryMaxItems": 20,
                "editorHistoryRetentionDays": 7,
                "sanitizeSecretsInEditorHistory": true,
            })),
            EditorHistoryPolicy {
                limit: 20,
                memory_only: true,
                ..policy()
            }
        );
        assert_eq!(
            EditorHistoryPolicy::from_config(&json!({
                "editorHistoryStorage": "off",
                "editorHistoryMaxItems": 20,
            })),
            EditorHistoryPolicy {
                limit: 0,
                ..policy()
            }
        );
        // a config not migrated yet
        assert_eq!(
            EditorHistoryPolicy::from_config(&json!({
                "editorHistoryMaxItems": 20,
                "clearEditorHistoryOnExit": true,
            })),
            EditorHistoryPolicy {
                limit: 20,
                memory_only: true,
                ..policy()
            }
        );
        assert_eq!(
            EditorHistoryPolicy::from_config(&json!({})),
            EditorHistoryPolicy {
                limit: DEFAULT_EDITOR_HISTORY_LIMIT,
                ..policy()
            }
        );
    }

    #[test]
    fn enforce_drops_expired_entries_and_those_over_the_limit() {
        let now = 100 * DAY_MS;
        let mut fresh = history_item("fresh", "fresh", EditorHistoryKind::Draft);
        fresh.created_at = now - DAY_MS;
        let mut second = history_item("second", "second", EditorHistoryKind::Draft);
        second.created_at = now - 2 * DAY_MS;
        let mut old = history_item("old", "old", EditorHistoryKind::Draft);
        old.created_at = now - 3 * DAY_MS;
        let mut history = vec![fresh, second, old];

        EditorHistoryPolicy {
            retention_days: 2,
            ..policy()
        }
        .enforce(&mut history, now);
        assert_eq!(history_texts(&history), ["fresh", "second"]);

        EditorHistoryPolicy {
            limit: 1,
            ..policy()
        }
        .enforce(&mut history, now);
        assert_eq!(history_texts(&history), ["fresh"]);
    }

    #[test]
    fn enforce_masks_secrets_in_entries_stored_before() {
        let mut item = history_item("a", "password=hunter22", EditorHistoryKind::Source);
        item.result = Some(String::from("token: abcdef123456"));
        let mut history = vec![item];

        EditorHistoryPolicy {
            sanitize: true,
            ..policy()
        }
        .enforce(&mut history, now_ms());

        assert_eq!(history[0].text, "password=[REDACTED SECRET]");
        assert_eq!(
            history[0].result.as_deref(),
            Some("token: [REDACTED SECRET]")
        );
    }

    #[test]
    fn save_editor_history_entry_masks_secrets_when_enabled() {
        let dir = temp_dir("save-secrets");
        let path = dir.join(EDITOR_HISTORY_FILE);
        let mut history = EditorHistory {
            store: EditorHistoryStore::File(path.clone()),
            policy: EditorHistoryPolicy {
                sanitize: true,
                ..policy()
            },
        };

        save_editor_history_entry(
            &mut history,
            entry("Here is my key: sk-proj-1234567890abcdef1234567890"),
        )
        .unwrap();

        let raw = fs::read_to_string(&path).unwrap();
        assert!(raw.contains("[REDACTED API KEY]"));
        assert!(!raw.contains("sk-proj-"));

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn save_editor_history_entry_stores_nothing_when_the_history_is_off() {
        let dir = temp_dir("save-off");
        let path = dir.join(EDITOR_HISTORY_FILE);
        let mut history = EditorHistory {
            store: EditorHistoryStore::File(path.clone()),
            policy: EditorHistoryPolicy {
                limit: 0,
                ..policy()
            },
        };

        assert_eq!(
            save_editor_history_entry(&mut history, entry("text")).unwrap(),
            None
        );
        assert!(!path.exists());

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_memory_store_never_touches_the_disk() {
        let dir = temp_dir("memory-store");
        let mut memory = Vec::new();
        let mut history = EditorHistory {
            store: EditorHistoryStore::Memory(&mut memory),
            policy: EditorHistoryPolicy {
                memory_only: true,
                ..policy()
            },
        };

        save_editor_history_entry(&mut history, entry("kept in memory")).unwrap();

        assert_eq!(history_texts(&memory), ["kept in memory"]);
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn an_emptied_file_store_leaves_no_file() {
        let dir = temp_dir("empty-store");
        let path = dir.join(EDITOR_HISTORY_FILE);
        let mut store = EditorHistoryStore::File(path.clone());

        store
            .write(vec![history_item("a", "a", EditorHistoryKind::Draft)])
            .unwrap();
        assert!(path.exists());
        store.write(Vec::new()).unwrap();
        assert!(!path.exists());

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn switching_to_memory_only_moves_the_file_into_memory() {
        let dir = temp_dir("switch-on");
        let path = dir.join(EDITOR_HISTORY_FILE);
        let now = now_ms();
        let mut item = history_item("a", "stored", EditorHistoryKind::Draft);
        item.created_at = now;
        write_jsonl(&path, &[item]).unwrap();
        let mut memory = Vec::new();

        switch_editor_history_store(
            &path,
            &policy(),
            &EditorHistoryPolicy {
                memory_only: true,
                ..policy()
            },
            &mut memory,
            now,
        )
        .unwrap();

        assert!(!path.exists());
        assert_eq!(history_texts(&memory), ["stored"]);

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn switching_memory_only_off_writes_the_memory_to_the_file() {
        let dir = temp_dir("switch-off");
        let path = dir.join(EDITOR_HISTORY_FILE);
        let now = now_ms();
        let mut item = history_item("a", "in memory", EditorHistoryKind::Draft);
        item.created_at = now;
        let mut memory = vec![item];

        switch_editor_history_store(
            &path,
            &EditorHistoryPolicy {
                memory_only: true,
                ..policy()
            },
            &policy(),
            &mut memory,
            now,
        )
        .unwrap();

        assert!(memory.is_empty());
        assert_eq!(
            history_texts(&read_editor_history(&path).unwrap()),
            ["in memory"]
        );

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn turning_the_history_off_deletes_the_file() {
        let dir = temp_dir("turn-off");
        let path = dir.join(EDITOR_HISTORY_FILE);
        write_jsonl(&path, &[history_item("a", "a", EditorHistoryKind::Draft)]).unwrap();

        switch_editor_history_store(
            &path,
            &policy(),
            &EditorHistoryPolicy {
                limit: 0,
                ..policy()
            },
            &mut Vec::new(),
            now_ms(),
        )
        .unwrap();

        assert!(!path.exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_lower_limit_waits_for_the_next_write() {
        let dir = temp_dir("lower-limit");
        let path = dir.join(EDITOR_HISTORY_FILE);
        let items = vec![
            history_item("a", "a", EditorHistoryKind::Draft),
            history_item("b", "b", EditorHistoryKind::Draft),
        ];
        write_jsonl(&path, &items).unwrap();

        switch_editor_history_store(
            &path,
            &policy(),
            &EditorHistoryPolicy {
                limit: 1,
                ..policy()
            },
            &mut Vec::new(),
            now_ms(),
        )
        .unwrap();

        assert_eq!(read_editor_history(&path).unwrap().len(), 2);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn startup_drops_expired_entries_and_legacy_lines_expire_too() {
        let dir = temp_dir("startup");
        let path = dir.join(EDITOR_HISTORY_FILE);
        let now = now_ms();
        let mut fresh = history_item("fresh", "fresh", EditorHistoryKind::Draft);
        fresh.created_at = now;
        let raw = format!(
            "{}\n{}\n",
            serde_json::to_string(&fresh).unwrap(),
            serde_json::to_string("legacy").unwrap()
        );
        fs::write(&path, raw).unwrap();
        let retention = EditorHistoryPolicy {
            retention_days: 1,
            ..policy()
        };

        // the legacy line is as old as the file, which is new
        enforce_editor_history_file(&path, &retention, now).unwrap();
        assert_eq!(read_editor_history(&path).unwrap().len(), 2);

        enforce_editor_history_file(&path, &retention, now + 2 * DAY_MS).unwrap();
        assert!(!path.exists());

        fs::remove_dir_all(&dir).unwrap();
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

    #[test]
    fn moves_a_legacy_file_once() {
        let dir = temp_dir("legacy-file");
        let legacy = dir.join("old.json");
        let path = dir.join("new.json");

        fs::write(&legacy, "old").unwrap();
        move_legacy_file(&legacy, &path);
        assert_eq!(fs::read_to_string(&path).unwrap(), "old");
        assert!(!legacy.exists());

        // the current file wins over a legacy one
        fs::write(&legacy, "older").unwrap();
        move_legacy_file(&legacy, &path);
        assert_eq!(fs::read_to_string(&path).unwrap(), "old");

        fs::remove_dir_all(&dir).unwrap();
    }
}
