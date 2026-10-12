use super::editor_history::DEFAULT_EDITOR_HISTORY_LIMIT;
use super::*;

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

/// Keeps a copy of the config as it was before a migration, once per old
/// version: an older build does not know the migrated config and would lose
/// what it no longer understands. The copy holds no API keys: the migration
/// moves them into the system keychain, and a copy in the clear would undo
/// that.
fn back_up_config_before_migration(path: &Path, version: u64, original: &Value) {
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
fn scrub_config_backups(path: &Path) {
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
        .get("chatHistoryEnabled")
        .and_then(Value::as_bool)
        .is_none()
    {
        config.insert(
            String::from("chatHistoryEnabled"),
            defaults["chatHistoryEnabled"].clone(),
        );
        changed = true;
    }

    if config
        .get("chatHistoryRetentionDays")
        .and_then(Value::as_u64)
        .is_none()
    {
        config.insert(
            String::from("chatHistoryRetentionDays"),
            defaults["chatHistoryRetentionDays"].clone(),
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

    if !translation
        .get("correctionPrompt")
        .is_some_and(Value::is_string)
    {
        translation.insert(String::from("correctionPrompt"), json!(""));
        changed = true;
    }

    changed
}

fn normalize_main_actions_config(user_config: &mut Value) -> bool {
    let defaults = default_user_config();
    let Some(config) = user_config.as_object_mut() else {
        return false;
    };

    let mut changed = false;
    if config
        .get("mainActions")
        .and_then(Value::as_array)
        .is_none()
    {
        config.insert(String::from("mainActions"), defaults["mainActions"].clone());
        changed = true;
    }
    if config.get("commands").and_then(Value::as_array).is_none() {
        config.insert(String::from("commands"), json!([]));
        changed = true;
    }

    changed
}

/// Gives every AI task without one a stable `id`, `task-<n>`, which the main
/// action menu refers to the task by. Empty slots stay empty.
fn assign_ai_task_ids(tasks: &mut [Value]) -> bool {
    let has_id = |task: &Value| {
        task.get("id")
            .and_then(Value::as_str)
            .is_some_and(|id| !id.trim().is_empty())
    };
    let mut used: Vec<String> = tasks
        .iter()
        .filter(|task| has_id(task))
        .filter_map(|task| task["id"].as_str().map(str::to_owned))
        .collect();
    let mut changed = false;
    for task in tasks.iter_mut() {
        if has_id(task) {
            continue;
        }
        let Some(fields) = task.as_object_mut() else {
            continue;
        };
        let id = (1..)
            .map(|n| format!("task-{n}"))
            .find(|id| !used.contains(id))
            .unwrap_or_default();
        fields.insert(String::from("id"), Value::String(id.clone()));
        used.push(id);
        changed = true;
    }
    changed
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

    match config.get_mut("aiTasks").and_then(Value::as_array_mut) {
        Some(tasks) => changed |= assign_ai_task_ids(tasks),
        None => {
            config.insert(String::from("aiTasks"), defaults["aiTasks"].clone());
            changed = true;
        }
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

pub fn read_or_create_local_state(app: &AppHandle) -> Result<LocalState, AppError> {
    let path = app_state_dir(app)?.join(STATE_FILE_NAME);
    move_legacy_file(&app_config_dir(app)?.join(STATE_FILE_NAME), &path);

    if let Some(state) = read_or_quarantine(&path, |raw| Ok(serde_json::from_str(raw)?))? {
        return Ok(state);
    }

    let default_state = LocalState::default();
    if let Err(error) = save_local_state(app, &default_state) {
        log::error!("Could not save the local state: {error}");
    }

    Ok(default_state)
}

pub const VALID_LOCAL_STATE_KEYS: &[&str] = &[
    "lastChatId",
    "lastMode",
    "lastChatModelId",
    "recentAiPrompts",
    "recentTranslateLanguages",
    "diffMode",
    "translationViewMode",
];

/// `current` with the fields of `patch` replaced; a `null` clears a field.
pub fn merge_local_state(
    current: &LocalState,
    patch: serde_json::Map<String, Value>,
) -> Result<LocalState, AppError> {
    for key in patch.keys() {
        if !VALID_LOCAL_STATE_KEYS.contains(&key.as_str()) {
            return Err(AppError::Message(format!(
                "Unknown field in local state patch: {key}"
            )));
        }
    }
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

#[cfg(test)]
mod tests {
    use super::*;
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

    #[test]
    fn local_state_without_the_menu_history_reads_with_defaults() {
        let state: LocalState = serde_json::from_value(json!({ "lastChatId": "chat" })).unwrap();

        assert!(state.recent_ai_prompts.is_empty());
        assert!(state.recent_translate_languages.is_empty());

        let merged = merge_local_state(
            &state,
            json!({ "recentAiPrompts": ["shorter"] })
                .as_object()
                .unwrap()
                .clone(),
        )
        .unwrap();

        assert_eq!(merged.recent_ai_prompts, vec![String::from("shorter")]);
        assert_eq!(merged.last_chat_id.as_deref(), Some("chat"));
    }

    #[test]
    fn merge_local_state_replaces_only_the_patched_fields() {
        let current = LocalState {
            last_chat_id: Some(String::from("chat")),
            last_mode: Some(String::from("editor")),
            ..LocalState::default()
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
    fn merge_local_state_rejects_an_unknown_field() {
        let patch = json!({ "nonExistentKey": "value" });
        assert!(
            merge_local_state(&LocalState::default(), patch.as_object().unwrap().clone()).is_err()
        );
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
            "hotkeys": { "history": "Ctrl+Alt+H" },
            "selectionHotkeys": { "correction": "Ctrl+Alt+X", "translate.0": "Ctrl+Alt+1" },
            "selectionReplace": { "whenEmpty": "selectAll" }
        });

        assert!(normalize_hotkeys_config(&mut config));
        assert!(config["hotkeys"].get("history").is_none());
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
        assert_eq!(config["translation"]["qualityGate"], json!("off"));
        assert_eq!(config["translation"]["correctionPrompt"], json!(""));
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
    fn normalize_ai_rules_and_tasks_gives_tasks_ids() {
        let mut config = json!({
            "aiTasks": [
                { "name": "a", "rule": "x" },
                null,
                { "id": "task-1", "name": "b", "rule": "y" },
                { "id": " ", "name": "c", "rule": "z" }
            ]
        });

        assert!(normalize_ai_rules_and_tasks(&mut config));
        assert_eq!(config["aiTasks"][0]["id"], json!("task-2"));
        assert_eq!(config["aiTasks"][1], Value::Null);
        assert_eq!(config["aiTasks"][2]["id"], json!("task-1"));
        assert_eq!(config["aiTasks"][3]["id"], json!("task-3"));
        assert!(!normalize_ai_rules_and_tasks(&mut config));
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
