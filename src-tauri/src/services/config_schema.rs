//! Validation and repair use the portable schema shared with the webview.
use std::collections::HashSet;
use std::sync::LazyLock;

use serde_json::{json, Value};

use crate::errors::AppError;

static SCHEMA: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(include_str!(
        "../../../packages/shared/src/user-config-schema.json"
    ))
    .expect("valid user config schema")
});

static DEFAULTS: LazyLock<Value> = LazyLock::new(|| {
    let mut defaults: Value = serde_json::from_str(include_str!(
        "../../../packages/shared/src/user-config-defaults.json"
    ))
    .expect("valid portable defaults");
    defaults["configVersion"] = json!(super::config_version::CONFIG_VERSION);
    defaults
});

fn default_of(schema: &Value) -> &Value {
    if let Some(path) = schema["defaultPath"].as_str() {
        &DEFAULTS[path]
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
                if !regex::Regex::new(pattern)
                    .expect("valid schema pattern")
                    .is_match(text)
                {
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

fn repair(value: &Value, schema: &Value) -> Value {
    if schema["type"] == "integer" {
        if let Some(number) = value.as_f64().filter(|number| {
            number.is_finite()
                && number.fract() == 0.0
                && *number >= 0.0
                && *number <= 9_007_199_254_740_991.0
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
            return repair(value, choice);
        }
        return default_of(schema).clone();
    }
    match schema["type"].as_str() {
        Some("object") => {
            let source = if value.is_object() {
                value.clone()
            } else {
                default_of(schema).clone()
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
                    .or_insert_with(|| default_of(&schema["properties"][key]).clone());
            }
            result.retain(|key, value| {
                if schema["propertyNames"].is_object()
                    && validate(&json!(key), &schema["propertyNames"], "").is_err()
                {
                    return false;
                }
                if let Some(child) = schema["properties"].get(key) {
                    *value = repair(value, child);
                    let required = schema["required"]
                        .as_array()
                        .is_some_and(|keys| keys.contains(&json!(key)));
                    if !required && validate(value, child, "").is_err() {
                        return false;
                    }
                } else if schema["additionalProperties"] == false {
                    return false;
                } else if schema["additionalProperties"].is_object() {
                    *value = repair(value, &schema["additionalProperties"]);
                    return validate(value, &schema["additionalProperties"], "").is_ok();
                }
                true
            });
            Value::Object(result)
        }
        Some("array") => {
            let source = value.as_array().or_else(|| default_of(schema).as_array());
            let mut result = Vec::new();
            for item in source.into_iter().flatten() {
                let item = repair(item, &schema["items"]);
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
                    let item = repair(default_of(&schema["items"]), &schema["items"]);
                    if validate(&item, &schema["items"], "").is_err() {
                        return default_of(schema).clone();
                    }
                    result.push(item);
                }
            }
            Value::Array(result)
        }
        _ if validate(value, schema, "").is_ok() => value.clone(),
        _ => default_of(schema).clone(),
    }
}

fn ids<'a>(config: &'a Value, key: &str) -> HashSet<&'a str> {
    config[key]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| item["id"].as_str())
        .collect()
}

/// The filled slots of a shortcut grid.
fn slot_values(slots: &Value) -> impl Iterator<Item = &Value> {
    slots.as_object().into_iter().flat_map(|slots| slots.values())
}

const BUILTIN_LLM_PROVIDERS: [&str; 3] = ["google", "openrouter", "deepseek"];
const CUSTOM_LLM_PROVIDER_TYPE: &str = "openaiCompatible";

fn validate_references(config: &Value) -> Result<(), AppError> {
    for (collection, key) in [
        (&config["commands"], "commands"),
        (&config["launcherPages"], "launcherPages"),
        (&config["llm"]["providers"], "llm.providers"),
        (&config["llm"]["models"], "llm.models"),
    ] {
        let mut seen = HashSet::new();
        for item in collection.as_array().into_iter().flatten() {
            if !seen.insert(item["id"].as_str()) {
                return Err(invalid(key));
            }
        }
    }
    for (slots, key, field) in [
        (&config["aiTasks"], "aiTasks", Some("id")),
        (&config["translation"]["targetLanguages"], "translation.targetLanguages", None),
    ] {
        let mut seen = HashSet::new();
        for value in slot_values(slots) {
            let value = field.map_or(value, |field| &value[field]);
            if !seen.insert(value.as_str()) {
                return Err(invalid(key));
            }
        }
    }
    let providers = ids(&config["llm"], "providers");
    for provider in config["llm"]["providers"].as_array().into_iter().flatten() {
        let id = provider["id"].as_str().unwrap_or_default();
        let builtin = BUILTIN_LLM_PROVIDERS.contains(&id);
        if (builtin && provider["type"] != id)
            || (!builtin && provider["type"] != CUSTOM_LLM_PROVIDER_TYPE)
        {
            return Err(invalid("llm.providers.type"));
        }
    }
    let models = ids(&config["llm"], "models");
    let commands = ids(config, "commands");
    let tasks: HashSet<&str> = slot_values(&config["aiTasks"])
        .filter_map(|task| task["id"].as_str())
        .collect();
    let pages = ids(config, "launcherPages");
    for model in config["llm"]["models"].as_array().into_iter().flatten() {
        if !providers.contains(model["providerId"].as_str().unwrap_or_default()) {
            return Err(invalid("llm.models.providerId"));
        }
    }
    for chain in config["llm"]["taskModelChains"]
        .as_object()
        .into_iter()
        .flat_map(|fields| fields.values())
    {
        for id in chain
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            if !models.contains(id) {
                return Err(invalid("llm.taskModelChains"));
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
    if config["configVersion"] != json!(super::config_version::CONFIG_VERSION) {
        return Err(invalid("configVersion"));
    }
    for command in config["commands"].as_array().into_iter().flatten() {
        let schema = match command["toolId"].as_str() {
            Some("script") => Some(&SCHEMA["$defs"]["scriptToolConfig"]),
            Some("webhook") => Some(&SCHEMA["$defs"]["webhookToolConfig"]),
            _ => None,
        };
        if let Some(schema) = schema {
            validate(&command["toolConfig"], schema, "commands.toolConfig")?;
        }
        if command["toolId"] == "webhook" && command["toolConfig"]["isAuthEnabled"] == true {
            let id = command["toolConfig"]["authSecretId"]
                .as_str()
                .ok_or_else(|| invalid("commands.toolConfig.authSecretId"))?;
            if id.len() > 64
                || !id
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
            {
                return Err(invalid("commands.toolConfig.authSecretId"));
            }
        }
    }
    validate_references(config)
}

/// Repairs untrusted disk input; IPC saves reject invalid input instead.
pub fn normalize_user_config(config: &mut Value) -> bool {
    let original = config.clone();
    *config = repair(config, &SCHEMA);
    config["configVersion"] = json!(super::config_version::CONFIG_VERSION);
    // Apply platform defaults when a field is missing.
    let defaults = crate::models::default_user_config();
    for (key, value) in defaults.as_object().into_iter().flatten() {
        if original.get(key).is_none() {
            config[key] = value.clone();
        }
    }
    for command in config["commands"].as_array_mut().into_iter().flatten() {
        for key in ["id", "toolId"] {
            command[key] = json!(command[key].as_str().unwrap_or_default().trim());
        }
    }
    for model in config["llm"]["models"].as_array_mut().into_iter().flatten() {
        model["id"] = json!(model["id"].as_str().unwrap_or_default().trim());
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
    for default in DEFAULTS["llm"]["providers"]
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
        let is_custom = provider["type"] == CUSTOM_LLM_PROVIDER_TYPE;
        if let Some(fields) = provider.as_object_mut() {
            if is_custom {
                fields.entry("baseUrl").or_insert_with(|| json!(""));
            } else {
                fields.remove("baseUrl");
            }
        }
    }
    config["llm"]["providers"] = json!(ordered);
    if let Some(glossary) = config["translation"]["glossary"].as_array_mut() {
        for entry in glossary.iter_mut() {
            for key in ["term", "use"] {
                entry[key] = json!(entry[key].as_str().unwrap_or_default().trim());
            }
        }
        glossary.retain(|entry| entry["term"].as_str().is_some_and(|term| !term.is_empty()));
    }
    let mut languages = HashSet::new();
    retain_slots(&mut config["translation"]["targetLanguages"], |language| {
        languages.insert(language.as_str().unwrap_or_default().to_owned())
    });
    deduplicate_by_id(&mut config["commands"]);
    for command in config["commands"].as_array_mut().into_iter().flatten() {
        let schema = match command["toolId"].as_str() {
            Some("script") => Some(&SCHEMA["$defs"]["scriptToolConfig"]),
            Some("webhook") => Some(&SCHEMA["$defs"]["webhookToolConfig"]),
            _ => None,
        };
        if let Some(schema) = schema {
            command["toolConfig"] = repair(&command["toolConfig"], schema);
        }
    }
    let mut task_ids = HashSet::new();
    retain_slots(&mut config["aiTasks"], |task| {
        task_ids.insert(task["id"].as_str().unwrap_or_default().to_owned())
    });
    deduplicate_by_id(&mut config["llm"]["providers"]);
    deduplicate_by_id(&mut config["llm"]["models"]);
    let provider_ids: HashSet<String> = ids(&config["llm"], "providers")
        .into_iter()
        .map(str::to_owned)
        .collect();
    if let Some(models) = config["llm"]["models"].as_array_mut() {
        models.retain(|model| {
            provider_ids.contains(model["providerId"].as_str().unwrap_or_default())
        });
    }
    let model_ids: HashSet<String> = ids(&config["llm"], "models")
        .into_iter()
        .map(str::to_owned)
        .collect();
    if let Some(tasks) = config["llm"]["taskModelChains"].as_object_mut() {
        for chain in tasks.values_mut().filter_map(Value::as_array_mut) {
            chain.retain(|id| model_ids.contains(id.as_str().unwrap_or_default()));
        }
    }
    let command_ids: HashSet<String> = ids(config, "commands")
        .into_iter()
        .map(str::to_owned)
        .collect();
    deduplicate_by_id(&mut config["launcherPages"]);
    let page_ids: HashSet<String> = ids(config, "launcherPages")
        .into_iter()
        .map(str::to_owned)
        .collect();
    retain_slots(&mut config["mainActions"], |slot| match slot["type"].as_str() {
        Some("command") => command_ids.contains(slot["commandId"].as_str().unwrap_or_default()),
        Some("aiTask") => task_ids.contains(slot["taskId"].as_str().unwrap_or_default()),
        Some("launcherPage") => page_ids.contains(slot["pageId"].as_str().unwrap_or_default()),
        _ => true,
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
        slots.remove(key);
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
            "../../../packages/shared/fixtures/config-normalization.json"
        ))
        .unwrap();
        for case in cases {
            let mut config = case["input"].clone();
            normalize_user_config(&mut config);
            assert_eq!(config, case["expected"], "{}", case["name"]);
            validate_user_config(&config).unwrap();
            assert!(!normalize_user_config(&mut config));
        }
    }

    #[test]
    fn voice_permissions_are_opt_in_and_confirmation_is_safe_by_default() {
        let mut config = serde_json::json!({
            "commands": [{ "id": "note", "toolId": "script", "phrases": ["save note"] }]
        });
        normalize_user_config(&mut config);
        assert_eq!(config["commands"][0]["isVoiceEnabled"], false);
        assert_eq!(config["commands"][0]["voiceConfirmation"], "always");
        config["commands"][0]["isVoiceEnabled"] = serde_json::json!(true);
        config["commands"][0]["voiceConfirmation"] = serde_json::json!("auto");
        normalize_user_config(&mut config);
        assert_eq!(config["commands"][0]["isVoiceEnabled"], true);
        assert_eq!(config["commands"][0]["voiceConfirmation"], "auto");
        config["commands"][0]["voiceConfirmation"] = serde_json::json!("invalid");
        normalize_user_config(&mut config);
        assert_eq!(config["commands"][0]["voiceConfirmation"], "always");
    }

    #[test]
    fn defaults_satisfy_the_shared_schema() {
        validate_user_config(&crate::models::default_user_config()).unwrap();
    }

    #[test]
    fn rejects_bad_types_counts_duplicate_ids_and_dangling_references() {
        let defaults = crate::models::default_user_config();
        for (path, value) in [
            ("/editorHistory/maxItems", json!(1.5)),
            ("/chatHistory/retentionDays", json!(-1)),
            ("/stt/providers", json!("bad")),
            ("/stt/providerId", json!("missing")),
            ("/commands", json!([{"id":"a"}])),
            (
                "/mainActions",
                json!({"q": {"type":"command","commandId":"missing"}}),
            ),
            ("/mainActions", json!({"y": {"type":"standard","actionId":"askInChat"}})),
            ("/launcherPages/0/slots", json!([])),
            ("/launcherPages/0/slots", json!({"q": "missing"})),
            ("/launcherPages", json!([])),
            ("/translation/targetLanguages", json!({"q": "en_US", "w": "en_US"})),
        ] {
            let mut config = defaults.clone();
            *config.pointer_mut(path).unwrap() = value;
            assert!(validate_user_config(&config).is_err(), "{path}");
        }
        let mut config = defaults;
        let duplicate = config["llm"]["models"][0].clone();
        config["llm"]["models"]
            .as_array_mut()
            .unwrap()
            .push(duplicate);
        assert!(validate_user_config(&config).is_err());
    }

    #[test]
    fn startup_repair_is_idempotent_and_removes_dangling_references() {
        let mut config = crate::models::default_user_config();
        config["editorHistory"]["maxItems"] = json!(1.5);
        config["stt"]["isLlmFormattingEnabled"] = json!("yes");
        config["mainActions"] = json!({
            "q": {"type":"command","commandId":"missing"},
            "w": {"type":"standard","actionId":"askInChat"},
            "y": {"type":"standard","actionId":"askInChat"},
        });
        config["translation"]["targetLanguages"] = json!({"q": "en_US", "w": "en_US", "e": 1});
        assert!(normalize_user_config(&mut config));
        validate_user_config(&config).unwrap();
        assert!(!normalize_user_config(&mut config));
        assert_eq!(
            config["mainActions"],
            json!({"w": {"type":"standard","actionId":"askInChat"}})
        );
        assert_eq!(config["translation"]["targetLanguages"], json!({"q": "en_US"}));
        assert_eq!(config["stt"]["isLlmFormattingEnabled"], false);
    }
}
