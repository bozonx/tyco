//! Validation and repair use the portable schema shared with the webview.
use crate::locks::MutexExt;
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use serde_json::{json, Value};

use crate::errors::AppError;

/// The largest integer a JavaScript number holds exactly
/// (`Number.MAX_SAFE_INTEGER`).
pub(crate) const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

static SCHEMA: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(include_str!(
        "../../../../packages/shared/src/user-config-schema.json"
    ))
    .expect("valid user config schema")
});

/// The defaults both runtimes share; the platform ones of
/// `defaults::default_user_config` differ in the hotkeys only, those of the
/// launcher pages included.
#[cfg(test)]
static PORTABLE_DEFAULTS: LazyLock<Value> =
    LazyLock::new(crate::services::settings::defaults::portable_user_config);

/// The compiled `pattern`s of the schema; a save validates the whole config,
/// so each is compiled once rather than on every check.
static PATTERNS: LazyLock<std::sync::Mutex<HashMap<String, regex::Regex>>> =
    LazyLock::new(Default::default);

fn matches_pattern(pattern: &str, text: &str) -> bool {
    let mut patterns = PATTERNS.locked();
    patterns
        .entry(pattern.to_owned())
        .or_insert_with(|| regex::Regex::new(pattern).expect("valid schema pattern"))
        .is_match(text)
}

fn default_of<'a>(schema: &'a Value, defaults: &'a Value) -> &'a Value {
    if let Some(path) = schema["defaultPath"].as_str() {
        &defaults[path]
    } else {
        &schema["default"]
    }
}

fn invalid(path: &str) -> AppError {
    AppError::InvalidInput(format!("Invalid configuration field: {path}"))
}

fn validate(value: &Value, schema: &Value, path: &str) -> Result<(), AppError> {
    if let Some(choices) = schema["anyOf"].as_array() {
        return if choices
            .iter()
            .any(|choice| validate(value, choice, path).is_ok())
        {
            Ok(())
        } else {
            Err(invalid(path))
        };
    }
    if let Some(choices) = schema["enum"].as_array() {
        if !choices.contains(value) {
            return Err(invalid(path));
        }
    }
    match schema["type"].as_str() {
        Some("object") => {
            let fields = value.as_object().ok_or_else(|| invalid(path))?;
            for key in schema["required"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
            {
                if !fields.contains_key(key) {
                    return Err(invalid(&format!("{path}.{key}")));
                }
            }
            for (key, value) in fields {
                let nested_path = format!("{path}.{key}");
                if schema["propertyNames"].is_object()
                    && validate(&json!(key), &schema["propertyNames"], &nested_path).is_err()
                {
                    return Err(invalid(&nested_path));
                }
                if let Some(child) = schema["properties"].get(key) {
                    validate(value, child, &nested_path)?;
                } else if schema["additionalProperties"] == false {
                    return Err(invalid(&nested_path));
                } else if schema["additionalProperties"].is_object() {
                    validate(value, &schema["additionalProperties"], &nested_path)?;
                }
            }
        }
        Some("array") => {
            let items = value.as_array().ok_or_else(|| invalid(path))?;
            if schema["minItems"]
                .as_u64()
                .is_some_and(|min| items.len() < min as usize)
                || schema["maxItems"]
                    .as_u64()
                    .is_some_and(|max| items.len() > max as usize)
            {
                return Err(invalid(path));
            }
            for (index, item) in items.iter().enumerate() {
                validate(item, &schema["items"], &format!("{path}[{index}]"))?;
                if schema["uniqueItems"] == true && items[..index].contains(item) {
                    return Err(invalid(path));
                }
            }
        }
        Some("string") => {
            let text = value.as_str().ok_or_else(|| invalid(path))?;
            if let Some(pattern) = schema["pattern"].as_str() {
                if !matches_pattern(pattern, text) {
                    return Err(invalid(path));
                }
            }
            if schema["maxLength"]
                .as_u64()
                .is_some_and(|maximum| text.chars().count() > maximum as usize)
            {
                return Err(invalid(path));
            }
            if schema["minLength"]
                .as_u64()
                .is_some_and(|minimum| text.trim().chars().count() < minimum as usize)
            {
                return Err(invalid(path));
            }
        }
        Some("boolean") if !value.is_boolean() => return Err(invalid(path)),
        Some("null") if !value.is_null() => return Err(invalid(path)),
        Some("integer" | "number") => {
            let number = value.as_f64().ok_or_else(|| invalid(path))?;
            if !number.is_finite()
                || (schema["type"] == "integer" && value.as_u64().is_none())
                || schema["minimum"]
                    .as_f64()
                    .is_some_and(|minimum| number < minimum)
                || schema["maximum"]
                    .as_f64()
                    .is_some_and(|maximum| number > maximum)
            {
                return Err(invalid(path));
            }
        }
        _ => {}
    }
    Ok(())
}

fn repair(value: &Value, schema: &Value, defaults: &Value) -> Value {
    if schema["type"] == "integer" {
        if let Some(number) = value.as_f64().filter(|number| {
            number.is_finite()
                && number.fract() == 0.0
                && *number >= 0.0
                && *number <= MAX_SAFE_INTEGER
        }) {
            let canonical = json!(number as u64);
            if validate(&canonical, schema, "").is_ok() {
                return canonical;
            }
        }
    }

    if let Some(choices) = schema["anyOf"].as_array() {
        if choices
            .iter()
            .any(|choice| validate(value, choice, "").is_ok())
        {
            return value.clone();
        }
        if let Some(choice) = choices.iter().find(|choice| {
            choice["type"] == "object"
                && value.is_object()
                && choice["properties"]["type"]["enum"]
                    .as_array()
                    .is_none_or(|tags| tags.contains(&value["type"]))
        }) {
            return repair(value, choice, defaults);
        }
        return default_of(schema, defaults).clone();
    }
    match schema["type"].as_str() {
        Some("object") => {
            let source = if value.is_object() {
                value.clone()
            } else {
                default_of(schema, defaults).clone()
            };
            let mut result = source.as_object().cloned().unwrap_or_default();
            for key in schema["required"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
            {
                result
                    .entry(key.to_owned())
                    .or_insert_with(|| default_of(&schema["properties"][key], defaults).clone());
            }
            result.retain(|key, value| {
                if schema["propertyNames"].is_object()
                    && validate(&json!(key), &schema["propertyNames"], "").is_err()
                {
                    return false;
                }
                if let Some(child) = schema["properties"].get(key) {
                    *value = repair(value, child, defaults);
                    let required = schema["required"]
                        .as_array()
                        .is_some_and(|keys| keys.contains(&json!(key)));
                    if !required && validate(value, child, "").is_err() {
                        return false;
                    }
                } else if schema["additionalProperties"] == false {
                    return false;
                } else if schema["additionalProperties"].is_object() {
                    *value = repair(value, &schema["additionalProperties"], defaults);
                    return validate(value, &schema["additionalProperties"], "").is_ok();
                }
                true
            });
            Value::Object(result)
        }
        Some("array") => {
            let source = value
                .as_array()
                .or_else(|| default_of(schema, defaults).as_array());
            let mut result = Vec::new();
            for item in source.into_iter().flatten() {
                let item = repair(item, &schema["items"], defaults);
                if validate(&item, &schema["items"], "").is_ok()
                    && (schema["uniqueItems"] != true || !result.contains(&item))
                {
                    result.push(item);
                }
            }
            if let Some(max) = schema["maxItems"].as_u64() {
                result.truncate(max as usize);
            }
            if let Some(min) = schema["minItems"].as_u64() {
                while result.len() < min as usize {
                    let item = repair(
                        default_of(&schema["items"], defaults),
                        &schema["items"],
                        defaults,
                    );
                    if validate(&item, &schema["items"], "").is_err() {
                        return default_of(schema, defaults).clone();
                    }
                    result.push(item);
                }
            }
            Value::Array(result)
        }
        _ if validate(value, schema, "").is_ok() => value.clone(),
        _ => default_of(schema, defaults).clone(),
    }
}

/// The ids of the entity collection at `pointer`.
fn ids<'a>(config: &'a Value, pointer: &str) -> HashSet<&'a str> {
    config
        .pointer(pointer)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item["id"].as_str())
        .collect()
}

/// The filled slots of a shortcut grid.
fn slot_values(slots: &Value) -> impl Iterator<Item = &Value> {
    slots
        .as_object()
        .into_iter()
        .flat_map(|slots| slots.values())
}

const BUILTIN_LLM_PROVIDERS: [&str; 3] = ["google", "openrouter", "deepseek"];
const CUSTOM_LLM_PROVIDER_TYPE: &str = "openaiCompatible";

/// The entity collections, each with distinct ids.
const ENTITY_COLLECTIONS: [&str; 5] = [
    "/commands",
    "/launcherPages",
    "/aiTasks/items",
    "/llm/providers",
    "/llm/models",
];

fn tool_config_schema(tool_id: &Value) -> Option<&'static Value> {
    match tool_id.as_str() {
        Some("script") => Some(&SCHEMA["$defs"]["scriptToolConfig"]),
        Some("webhook") => Some(&SCHEMA["$defs"]["webhookToolConfig"]),
        _ => None,
    }
}

fn validate_references(config: &Value) -> Result<(), AppError> {
    for pointer in ENTITY_COLLECTIONS {
        let mut seen = HashSet::new();
        for item in config
            .pointer(pointer)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if !seen.insert(item["id"].as_str()) {
                return Err(invalid(pointer));
            }
        }
    }
    let tasks = ids(config, "/aiTasks/items");
    for (slots, key) in [
        (&config["aiTasks"]["slots"], "aiTasks.slots"),
        (
            &config["translation"]["targetLanguages"],
            "translation.targetLanguages",
        ),
    ] {
        let mut seen = HashSet::new();
        for value in slot_values(slots) {
            if !seen.insert(value.as_str()) {
                return Err(invalid(key));
            }
        }
    }
    for id in slot_values(&config["aiTasks"]["slots"]).filter_map(Value::as_str) {
        if !tasks.contains(id) {
            return Err(invalid("aiTasks.slots"));
        }
    }
    let providers = ids(config, "/llm/providers");
    for provider in config["llm"]["providers"].as_array().into_iter().flatten() {
        let id = provider["id"].as_str().unwrap_or_default();
        let builtin = BUILTIN_LLM_PROVIDERS.contains(&id);
        if (builtin && provider["type"] != id)
            || (!builtin && provider["type"] != CUSTOM_LLM_PROVIDER_TYPE)
        {
            return Err(invalid("llm.providers.type"));
        }
    }
    let models = ids(config, "/llm/models");
    let commands = ids(config, "/commands");
    let pages = ids(config, "/launcherPages");
    for model in config["llm"]["models"].as_array().into_iter().flatten() {
        if !providers.contains(model["providerId"].as_str().unwrap_or_default()) {
            return Err(invalid("llm.models.providerId"));
        }
    }
    for chain in config["llm"]["tasks"]
        .as_object()
        .into_iter()
        .flat_map(|tasks| tasks.values())
        .map(|task| &task["modelChain"])
    {
        for id in chain
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            if !models.contains(id) {
                return Err(invalid("llm.tasks.modelChain"));
            }
        }
    }
    for slot in slot_values(&config["mainActions"]) {
        match slot["type"].as_str() {
            Some("command")
                if !commands.contains(slot["commandId"].as_str().unwrap_or_default()) =>
            {
                return Err(invalid("mainActions.commandId"))
            }
            Some("aiTask") if !tasks.contains(slot["taskId"].as_str().unwrap_or_default()) => {
                return Err(invalid("mainActions.taskId"))
            }
            Some("launcherPage")
                if !pages.contains(slot["pageId"].as_str().unwrap_or_default()) =>
            {
                return Err(invalid("mainActions.pageId"));
            }
            _ => {}
        }
    }
    for page in config["launcherPages"].as_array().into_iter().flatten() {
        for id in slot_values(&page["slots"]).filter_map(Value::as_str) {
            if !commands.contains(id) {
                return Err(invalid("launcherPages.slots"));
            }
        }
    }
    Ok(())
}

pub fn validate_user_config(config: &Value) -> Result<(), AppError> {
    validate(config, &SCHEMA, "userConfig")?;
    if config["configVersion"] != json!(crate::services::settings::version::CONFIG_VERSION) {
        return Err(invalid("configVersion"));
    }
    for command in config["commands"].as_array().into_iter().flatten() {
        if let Some(schema) = tool_config_schema(&command["toolId"]) {
            validate(&command["toolConfig"], schema, "commands.toolConfig")?;
        }
        if command["toolId"] == "webhook" && command["toolConfig"]["isAuthEnabled"] == true {
            let id = command["toolConfig"]["authSecretId"]
                .as_str()
                .ok_or_else(|| invalid("commands.toolConfig.authSecretId"))?;
            if !crate::services::secrets::is_valid_id(id) {
                return Err(invalid("commands.toolConfig.authSecretId"));
            }
        }
    }
    validate_references(config)
}

/// Repairs untrusted disk input; IPC saves reject invalid input instead.
/// Missing and broken fields take the defaults of this platform.
pub fn normalize_user_config(config: &mut Value) -> bool {
    normalize_with_defaults(
        config,
        &crate::services::settings::defaults::default_user_config(),
    )
}

/// The rules of `normalizeUserConfig` in `@tyco/shared`; the shared fixtures
/// check that both give the same result.
fn normalize_with_defaults(config: &mut Value, defaults: &Value) -> bool {
    let original = config.clone();
    *config = repair(config, &SCHEMA, defaults);
    config["configVersion"] = json!(crate::services::settings::version::CONFIG_VERSION);
    for command in config["commands"].as_array_mut().into_iter().flatten() {
        command["toolId"] = json!(command["toolId"].as_str().unwrap_or_default().trim());
    }
    let builtin_ids = BUILTIN_LLM_PROVIDERS;
    let mut providers = config["llm"]["providers"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    providers.retain(|provider| {
        let id = provider["id"].as_str().unwrap_or_default();
        if builtin_ids.contains(&id) {
            provider["type"] == id
        } else {
            provider["type"] == CUSTOM_LLM_PROVIDER_TYPE
        }
    });
    let mut ordered = Vec::new();
    for default in defaults["llm"]["providers"]
        .as_array()
        .into_iter()
        .flatten()
    {
        if builtin_ids.contains(&default["id"].as_str().unwrap_or_default()) {
            ordered.push(
                providers
                    .iter()
                    .find(|provider| provider["id"] == default["id"])
                    .unwrap_or(default)
                    .clone(),
            );
        }
    }
    ordered.extend(
        providers
            .into_iter()
            .filter(|provider| !builtin_ids.contains(&provider["id"].as_str().unwrap_or_default())),
    );
    for provider in &mut ordered {
        if provider["type"] != CUSTOM_LLM_PROVIDER_TYPE {
            if let Some(fields) = provider.as_object_mut() {
                fields.shift_remove("baseUrl");
            }
        }
    }
    config["llm"]["providers"] = json!(ordered);
    if let Some(glossary) = config["translation"]["glossary"].as_array_mut() {
        for entry in glossary.iter_mut() {
            for key in ["term", "translation"] {
                entry[key] = json!(entry[key].as_str().unwrap_or_default().trim());
            }
        }
        glossary.retain(|entry| {
            ["term", "translation"]
                .iter()
                .all(|key| entry[key].as_str().is_some_and(|text| !text.is_empty()))
        });
    }
    let mut languages = HashSet::new();
    retain_slots(&mut config["translation"]["targetLanguages"], |language| {
        languages.insert(language.as_str().unwrap_or_default().to_owned())
    });
    for pointer in ENTITY_COLLECTIONS {
        if let Some(collection) = config.pointer_mut(pointer) {
            deduplicate_by_id(collection);
        }
    }
    for command in config["commands"].as_array_mut().into_iter().flatten() {
        if let Some(schema) = tool_config_schema(&command["toolId"]) {
            command["toolConfig"] = repair(&command["toolConfig"], schema, defaults);
        }
    }
    let task_ids: HashSet<String> = ids(config, "/aiTasks/items")
        .into_iter()
        .map(str::to_owned)
        .collect();
    let mut slotted_tasks = HashSet::new();
    retain_slots(&mut config["aiTasks"]["slots"], |id| {
        let id = id.as_str().unwrap_or_default();
        task_ids.contains(id) && slotted_tasks.insert(id.to_owned())
    });
    let provider_ids: HashSet<String> = ids(config, "/llm/providers")
        .into_iter()
        .map(str::to_owned)
        .collect();
    if let Some(models) = config["llm"]["models"].as_array_mut() {
        models.retain(|model| {
            provider_ids.contains(model["providerId"].as_str().unwrap_or_default())
        });
    }
    let model_ids: HashSet<String> = ids(config, "/llm/models")
        .into_iter()
        .map(str::to_owned)
        .collect();
    if let Some(tasks) = config["llm"]["tasks"].as_object_mut() {
        for chain in tasks
            .values_mut()
            .filter_map(|task| task.get_mut("modelChain").and_then(Value::as_array_mut))
        {
            chain.retain(|id| model_ids.contains(id.as_str().unwrap_or_default()));
        }
    }
    let command_ids: HashSet<String> = ids(config, "/commands")
        .into_iter()
        .map(str::to_owned)
        .collect();
    let page_ids: HashSet<String> = ids(config, "/launcherPages")
        .into_iter()
        .map(str::to_owned)
        .collect();
    retain_slots(&mut config["mainActions"], |slot| {
        match slot["type"].as_str() {
            Some("command") => command_ids.contains(slot["commandId"].as_str().unwrap_or_default()),
            Some("aiTask") => task_ids.contains(slot["taskId"].as_str().unwrap_or_default()),
            Some("launcherPage") => page_ids.contains(slot["pageId"].as_str().unwrap_or_default()),
            _ => true,
        }
    });
    for page in config["launcherPages"].as_array_mut().into_iter().flatten() {
        retain_slots(&mut page["slots"], |id| {
            command_ids.contains(id.as_str().unwrap_or_default())
        });
    }
    *config != original
}

fn deduplicate_by_id(collection: &mut Value) {
    let mut seen_ids = HashSet::new();
    if let Some(items) = collection.as_array_mut() {
        items.retain(|item| seen_ids.insert(item["id"].as_str().unwrap_or_default().to_owned()));
    }
}

/// Keeps the slots of a shortcut grid that pass `keep`, visited in the order
/// of the shortcut keys, so that the first of two duplicates stays.
fn retain_slots(slots: &mut Value, mut keep: impl FnMut(&Value) -> bool) {
    let Some(slots) = slots.as_object_mut() else {
        return;
    };
    let mut dropped = Vec::new();
    for key in SHORTCUT_SLOT_KEYS {
        if let Some(value) = slots.get(key) {
            if !keep(value) {
                dropped.push(key);
            }
        }
    }
    for key in dropped {
        slots.shift_remove(key);
    }
}

/// The keys of the shortcut grids, row by row; see `SHORTCUT_SLOT_KEYS` of
/// the shared package.
const SHORTCUT_SLOT_KEYS: [&str; 15] = [
    "q", "w", "e", "r", "t", "a", "s", "d", "f", "g", "z", "x", "c", "v", "b",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_repair_fixtures_match_the_webview() {
        let cases: Vec<Value> = serde_json::from_str(include_str!(
            "../../../../packages/shared/fixtures/config-normalization.json"
        ))
        .unwrap();
        for case in cases {
            let mut config = case["input"].clone();
            normalize_with_defaults(&mut config, &PORTABLE_DEFAULTS);
            assert_eq!(config, case["expected"], "{}", case["name"]);
            validate_user_config(&config).unwrap();
            assert!(!normalize_with_defaults(&mut config, &PORTABLE_DEFAULTS));
        }
    }

    #[test]
    fn missing_fields_take_the_platform_defaults() {
        let defaults = crate::services::settings::defaults::default_user_config();
        let mut config = PORTABLE_DEFAULTS.clone();
        config["hotkeys"]
            .as_object_mut()
            .unwrap()
            .shift_remove("voice");
        normalize_user_config(&mut config);
        assert_eq!(config["hotkeys"]["voice"], defaults["hotkeys"]["voice"]);
        assert_eq!(
            defaults["launcherPages"][0]["hotkey"],
            json!(crate::services::hotkeys::default_launcher_page_shortcut())
        );
    }

    #[test]
    fn voice_permissions_are_opt_in() {
        let mut config = serde_json::json!({
            "commands": [{ "id": "note", "toolId": "script", "phrases": ["save note"] }]
        });
        normalize_user_config(&mut config);
        assert_eq!(config["commands"][0]["isVoiceEnabled"], false);
        assert_eq!(config["commands"][0]["isAvailableExternally"], false);
        assert_eq!(config["commands"][0]["outputAction"], "none");
    }

    #[test]
    fn defaults_satisfy_the_shared_schema() {
        validate_user_config(&crate::services::settings::defaults::default_user_config()).unwrap();
    }

    #[test]
    fn rejects_bad_types_counts_duplicate_ids_and_dangling_references() {
        let defaults = crate::services::settings::defaults::default_user_config();
        for (path, value) in [
            ("/editor/history/maxItems", json!(1.5)),
            ("/editor/history/maxItems", json!(0)),
            ("/editor/history/retentionDays", json!(0)),
            ("/aiTasks/items/0/id", json!("Deep edit")),
            ("/launcherPages/0/id", json!("Main")),
            ("/llm/models/0/id", json!(" ollama-qwen")),
            ("/stt/providers", json!("bad")),
            ("/stt/provider", json!("missing")),
            ("/commands", json!([{"id":"a"}])),
            (
                "/mainActions",
                json!({"q": {"type":"command","commandId":"missing"}}),
            ),
            (
                "/mainActions",
                json!({"y": {"type":"standard","actionId":"askInChat"}}),
            ),
            ("/launcherPages/0/slots", json!([])),
            ("/launcherPages/0/slots", json!({"q": "missing"})),
            ("/launcherPages", json!([])),
            (
                "/translation/targetLanguages",
                json!({"q": "en-US", "w": "en-US"}),
            ),
            ("/aiTasks/slots", json!({"q": "missing"})),
            (
                "/aiTasks/slots",
                json!({"q": "deep-edit", "w": "deep-edit"}),
            ),
        ] {
            let mut config = defaults.clone();
            *config.pointer_mut(path).unwrap() = value;
            assert!(validate_user_config(&config).is_err(), "{path}");
        }
        for pointer in ["/llm/models", "/aiTasks/items"] {
            let mut config = defaults.clone();
            let items = config.pointer_mut(pointer).unwrap().as_array_mut().unwrap();
            items.push(items[0].clone());
            assert!(validate_user_config(&config).is_err(), "{pointer}");
        }
    }

    #[test]
    fn startup_repair_is_idempotent_and_removes_dangling_references() {
        let mut config = crate::services::settings::defaults::default_user_config();
        config["editor"]["history"]["maxItems"] = json!(1.5);
        config["stt"]["isVoiceCorrectionEnabled"] = json!("yes");
        config["mainActions"] = json!({
            "q": {"type":"command","commandId":"missing"},
            "w": {"type":"standard","actionId":"askInChat"},
            "y": {"type":"standard","actionId":"askInChat"},
        });
        config["translation"]["targetLanguages"] = json!({"q": "en-US", "w": "en-US", "e": 1});
        config["aiTasks"]["slots"] = json!({"q": "gone", "w": "deep-edit", "e": "deep-edit"});
        assert!(normalize_user_config(&mut config));
        validate_user_config(&config).unwrap();
        assert!(!normalize_user_config(&mut config));
        assert_eq!(
            config["mainActions"],
            json!({"w": {"type":"standard","actionId":"askInChat"}})
        );
        assert_eq!(
            config["translation"]["targetLanguages"],
            json!({"q": "en-US"})
        );
        assert_eq!(config["aiTasks"]["slots"], json!({"w": "deep-edit"}));
        assert_eq!(config["stt"]["isVoiceCorrectionEnabled"], false);
    }

    #[test]
    fn unknown_fields_of_a_newer_build_survive_repair_and_save() {
        let mut config = crate::services::settings::defaults::default_user_config();
        config["futureSection"] = json!({ "isEnabled": true });
        config["editor"]["futureField"] = json!(3);
        config["llm"]["models"][0]["futureCapability"] = json!("x");
        let expected = config.clone();
        assert!(!normalize_user_config(&mut config));
        assert_eq!(config, expected);
        validate_user_config(&config).unwrap();
    }

    #[test]
    fn llm_providers_carry_the_fields_of_their_type() {
        let mut config = crate::services::settings::defaults::default_user_config();
        config["llm"]["providers"][0]["baseUrl"] = json!("http://example.com");
        config["llm"]["providers"][3]
            .as_object_mut()
            .unwrap()
            .shift_remove("baseUrl");
        assert!(normalize_user_config(&mut config));
        assert!(config["llm"]["providers"][0].get("baseUrl").is_none());
        assert_eq!(config["llm"]["providers"][3]["baseUrl"], "");

        let mut config = crate::services::settings::defaults::default_user_config();
        config["llm"]["providers"][3]
            .as_object_mut()
            .unwrap()
            .shift_remove("baseUrl");
        assert!(validate_user_config(&config).is_err());
    }

    #[test]
    fn translation_languages_may_be_empty() {
        let mut config = crate::services::settings::defaults::default_user_config();
        config["translation"]["targetLanguages"] = json!({});
        assert!(!normalize_user_config(&mut config));
        validate_user_config(&config).unwrap();
    }
}
