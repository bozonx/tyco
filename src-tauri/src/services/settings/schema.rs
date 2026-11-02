//! Validation and repair use the portable schema shared with the webview.
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

/// The compiled `pattern`s of the schema, built once with it: a save
/// validates the whole config.
static PATTERNS: LazyLock<HashMap<String, regex::Regex>> = LazyLock::new(|| {
    let mut patterns = HashMap::new();
    collect_patterns(&SCHEMA, &mut patterns);
    patterns
});

fn collect_patterns(schema: &Value, patterns: &mut HashMap<String, regex::Regex>) {
    match schema {
        Value::Object(object) => {
            if let Some(pattern) = object.get("pattern").and_then(Value::as_str) {
                patterns
                    .entry(pattern.to_owned())
                    .or_insert_with(|| regex::Regex::new(pattern).expect("valid schema pattern"));
            }
            object
                .values()
                .for_each(|value| collect_patterns(value, patterns));
        }
        Value::Array(items) => items
            .iter()
            .for_each(|item| collect_patterns(item, patterns)),
        _ => {}
    }
}

fn matches_pattern(pattern: &str, text: &str) -> bool {
    PATTERNS
        .get(pattern)
        .is_some_and(|regex| regex.is_match(text))
}

fn default_of<'a>(schema: &'a Value, defaults: &'a Value) -> &'a Value {
    if let Some(path) = schema["defaultPath"].as_str() {
        &defaults[path]
    } else {
        &schema["default"]
    }
}

fn invalid_field(path: &str) -> AppError {
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
            Err(invalid_field(path))
        };
    }
    if let Some(choices) = schema["enum"].as_array() {
        if !choices.contains(value) {
            return Err(invalid_field(path));
        }
    }
    match schema["type"].as_str() {
        Some("object") => {
            let fields = value.as_object().ok_or_else(|| invalid_field(path))?;
            for key in schema["required"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
            {
                if !fields.contains_key(key) {
                    return Err(invalid_field(&format!("{path}.{key}")));
                }
            }
            for (key, value) in fields {
                let nested_path = format!("{path}.{key}");
                if schema["propertyNames"].is_object()
                    && validate(&json!(key), &schema["propertyNames"], &nested_path).is_err()
                {
                    return Err(invalid_field(&nested_path));
                }
                if let Some(child) = schema["properties"].get(key) {
                    validate(value, child, &nested_path)?;
                } else if schema["additionalProperties"] == false {
                    return Err(invalid_field(&nested_path));
                } else if schema["additionalProperties"].is_object() {
                    validate(value, &schema["additionalProperties"], &nested_path)?;
                }
            }
        }
        Some("array") => {
            let items = value.as_array().ok_or_else(|| invalid_field(path))?;
            if schema["minItems"]
                .as_u64()
                .is_some_and(|min| items.len() < min as usize)
                || schema["maxItems"]
                    .as_u64()
                    .is_some_and(|max| items.len() > max as usize)
            {
                return Err(invalid_field(path));
            }
            for (index, item) in items.iter().enumerate() {
                validate(item, &schema["items"], &format!("{path}[{index}]"))?;
                if schema["uniqueItems"] == true && items[..index].contains(item) {
                    return Err(invalid_field(path));
                }
            }
        }
        Some("string") => {
            let text = value.as_str().ok_or_else(|| invalid_field(path))?;
            if let Some(pattern) = schema["pattern"].as_str() {
                if !matches_pattern(pattern, text) {
                    return Err(invalid_field(path));
                }
            }
            if schema["maxLength"]
                .as_u64()
                .is_some_and(|maximum| text.chars().count() > maximum as usize)
            {
                return Err(invalid_field(path));
            }
            if schema["minLength"]
                .as_u64()
                .is_some_and(|minimum| text.trim().chars().count() < minimum as usize)
            {
                return Err(invalid_field(path));
            }
        }
        Some("boolean") if !value.is_boolean() => return Err(invalid_field(path)),
        Some("null") if !value.is_null() => return Err(invalid_field(path)),
        Some("integer" | "number") => {
            let number = value.as_f64().ok_or_else(|| invalid_field(path))?;
            if !number.is_finite()
                || (schema["type"] == "integer" && value.as_u64().is_none())
                || schema["minimum"]
                    .as_f64()
                    .is_some_and(|minimum| number < minimum)
                || schema["maximum"]
                    .as_f64()
                    .is_some_and(|maximum| number > maximum)
            {
                return Err(invalid_field(path));
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
const ENTITY_COLLECTIONS: [&str; 6] = [
    "/commands",
    "/variables",
    "/transformations/items",
    "/styling/items",
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
                return Err(invalid_field(pointer));
            }
        }
    }
    let mut names = HashSet::new();
    for variable in config["variables"].as_array().into_iter().flatten() {
        let name = variable["name"].as_str().unwrap_or_default();
        if !is_user_variable_name(name) || !names.insert(name.to_ascii_uppercase()) {
            return Err(invalid_field("variables.name"));
        }
    }
    let transformations = ids(config, "/transformations/items");
    let stylings = ids(config, "/styling/items");
    for (slots, key) in [
        (&config["transformations"]["slots"], "transformations.slots"),
        (&config["styling"]["slots"], "styling.slots"),
        (
            &config["translation"]["targetLanguages"],
            "translation.targetLanguages",
        ),
    ] {
        let mut seen = HashSet::new();
        for value in slot_values(slots) {
            if !seen.insert(value.as_str()) {
                return Err(invalid_field(key));
            }
        }
    }
    for id in slot_values(&config["transformations"]["slots"]).filter_map(Value::as_str) {
        if !transformations.contains(id) {
            return Err(invalid_field("transformations.slots"));
        }
    }
    for id in slot_values(&config["styling"]["slots"]).filter_map(Value::as_str) {
        if !stylings.contains(id) {
            return Err(invalid_field("styling.slots"));
        }
    }
    let providers = ids(config, "/llm/providers");
    for provider in config["llm"]["providers"].as_array().into_iter().flatten() {
        let id = provider["id"].as_str().unwrap_or_default();
        let builtin = BUILTIN_LLM_PROVIDERS.contains(&id);
        if (builtin && provider["type"] != id)
            || (!builtin && provider["type"] != CUSTOM_LLM_PROVIDER_TYPE)
        {
            return Err(invalid_field("llm.providers.type"));
        }
    }
    let models = ids(config, "/llm/models");
    let commands = ids(config, "/commands");
    for model in config["llm"]["models"].as_array().into_iter().flatten() {
        if !providers.contains(model["providerId"].as_str().unwrap_or_default()) {
            return Err(invalid_field("llm.models.providerId"));
        }
    }
    for id in config["llm"]["tasks"]
        .as_object()
        .into_iter()
        .flat_map(|tasks| tasks.values())
        .filter_map(|task| task["modelId"].as_str())
    {
        if !id.is_empty() && !models.contains(id) {
            return Err(invalid_field("llm.tasks.modelId"));
        }
    }
    let Some(action_pages) = config["actionPages"].as_array() else {
        return Err(invalid_field("actionPages"));
    };
    if action_pages.is_empty() {
        return Err(invalid_field("actionPages"));
    }
    if action_pages[0]["inputMode"] != "selection" {
        return Err(invalid_field("actionPages.0.inputMode"));
    }
    for page in action_pages {
        for slot in slot_values(&page["slots"]) {
            match slot["type"].as_str() {
                Some("command")
                    if !commands.contains(slot["commandId"].as_str().unwrap_or_default()) =>
                {
                    return Err(invalid_field("actionPages.commandId"))
                }
                Some("transformation")
                    if !transformations
                        .contains(slot["transformationId"].as_str().unwrap_or_default()) =>
                {
                    return Err(invalid_field("actionPages.transformationId"))
                }
                Some("styling")
                    if !stylings.contains(slot["stylingId"].as_str().unwrap_or_default()) =>
                {
                    return Err(invalid_field("actionPages.stylingId"))
                }
                Some("launcherPage") => {
                    return Err(invalid_field("actionPages.launcherPage"));
                }
                _ => {}
            }
        }
    }
    Ok(())
}

pub fn validate_user_config(config: &Value) -> Result<(), AppError> {
    validate(config, &SCHEMA, "userConfig")?;
    if config["configVersion"] != json!(crate::services::settings::version::CONFIG_VERSION) {
        return Err(invalid_field("configVersion"));
    }
    for command in config["commands"].as_array().into_iter().flatten() {
        if let Some(schema) = tool_config_schema(&command["toolId"]) {
            validate(&command["toolConfig"], schema, "commands.toolConfig")?;
        }
        if command["toolId"] == "webhook" && command["toolConfig"]["isAuthEnabled"] == true {
            let id = command["toolConfig"]["authSecretId"]
                .as_str()
                .ok_or_else(|| invalid_field("commands.toolConfig.authSecretId"))?;
            if !crate::services::secrets::is_valid_id(id) {
                return Err(invalid_field("commands.toolConfig.authSecretId"));
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
    repair_command_ids(config);
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
            let Some(fields) = entry.as_object_mut() else {
                continue;
            };
            if let Some(translations) = fields
                .get_mut("translations")
                .and_then(Value::as_object_mut)
            {
                for text in translations.values_mut() {
                    *text = json!(text.as_str().unwrap_or_default().trim());
                }
                translations.retain(|_, text| text.as_str().is_some_and(|text| !text.is_empty()));
            }
            if fields.get("translations").is_some_and(|translations| {
                translations.as_object().is_none_or(|map| map.is_empty())
            }) {
                fields.shift_remove("translations");
            }
        }
        // A term needs a translation for every language or for some of them.
        glossary.retain(|entry| {
            let has_text = |key: &str| entry[key].as_str().is_some_and(|text| !text.is_empty());
            has_text("term") && (has_text("translation") || entry.get("translations").is_some())
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
    retain_user_variables(config);
    for command in config["commands"].as_array_mut().into_iter().flatten() {
        if let Some(schema) = tool_config_schema(&command["toolId"]) {
            command["toolConfig"] = repair(&command["toolConfig"], schema, defaults);
        }
    }
    let transformation_ids: HashSet<String> = ids(config, "/transformations/items")
        .into_iter()
        .map(str::to_owned)
        .collect();
    let mut slotted_transformations = HashSet::new();
    retain_slots(&mut config["transformations"]["slots"], |id| {
        let id = id.as_str().unwrap_or_default();
        transformation_ids.contains(id) && slotted_transformations.insert(id.to_owned())
    });
    let styling_ids: HashSet<String> = ids(config, "/styling/items")
        .into_iter()
        .map(str::to_owned)
        .collect();
    let mut slotted_stylings = HashSet::new();
    retain_slots(&mut config["styling"]["slots"], |id| {
        let id = id.as_str().unwrap_or_default();
        styling_ids.contains(id) && slotted_stylings.insert(id.to_owned())
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
        for model_id in tasks
            .values_mut()
            .filter_map(|task| task.get_mut("modelId"))
        {
            if !model_ids.contains(model_id.as_str().unwrap_or_default()) {
                *model_id = Value::String(String::new());
            }
        }
    }
    if let Some(common_id) = config["llm"].get_mut("commonModelId") {
        if !model_ids.contains(common_id.as_str().unwrap_or_default()) {
            *common_id = Value::String(String::new());
        }
    }
    if let Some(custom_tasks) = config["llm"]
        .get_mut("customTaskModels")
        .and_then(Value::as_object_mut)
    {
        for model_id in custom_tasks.values_mut() {
            if !model_ids.contains(model_id.as_str().unwrap_or_default()) {
                *model_id = Value::String(String::new());
            }
        }
    }
    let command_ids: HashSet<String> = ids(config, "/commands")
        .into_iter()
        .map(str::to_owned)
        .collect();
    if let Some(pages) = config.get_mut("actionPages").and_then(Value::as_array_mut) {
        if pages.is_empty() {
            pages.push(json!({"inputMode": "selection", "slots": {}}));
        }
    } else {
        let legacy_slots = config
            .get("mainActions")
            .cloned()
            .unwrap_or_else(|| json!({}));
        config["actionPages"] = json!([{"inputMode": "selection", "slots": legacy_slots}]);
    }
    if let Some(obj) = config.as_object_mut() {
        obj.remove("mainActions");
        obj.remove("launcherPages");
    }
    if let Some(hotkeys) = config.get_mut("hotkeys").and_then(Value::as_object_mut) {
        hotkeys.remove("launcherPages");
        if !hotkeys.contains_key("selectionActionsPage2") {
            hotkeys.insert("selectionActionsPage2".into(), json!(""));
        }
        if !hotkeys.contains_key("selectionActionsPage3") {
            hotkeys.insert("selectionActionsPage3".into(), json!(""));
        }
    }
    if let Some(pages) = config["actionPages"].as_array_mut() {
        pages[0]["inputMode"] = json!("selection");
        for page in pages {
            retain_slots(&mut page["slots"], |slot| match slot["type"].as_str() {
                Some("command") => {
                    command_ids.contains(slot["commandId"].as_str().unwrap_or_default())
                }
                Some("transformation") => transformation_ids
                    .contains(slot["transformationId"].as_str().unwrap_or_default()),
                Some("styling") => {
                    styling_ids.contains(slot["stylingId"].as_str().unwrap_or_default())
                }
                Some("launcherPage") => false,
                _ => true,
            });
        }
    }
    prune_device_references(config);
    *config != original
}

/// Drops what a device field refers to and the user data no longer has.
/// Returns whether something was dropped.
pub fn prune_device_references(config: &mut Value) -> bool {
    let mut is_pruned = false;
    let variable_ids: HashSet<String> = ids(config, "/variables")
        .into_iter()
        .map(str::to_owned)
        .collect();
    if let Some(values) = config
        .get_mut("variableValues")
        .and_then(Value::as_object_mut)
    {
        let before = values.len();
        values.retain(|id, _| variable_ids.contains(id));
        is_pruned |= values.len() != before;
    }
    is_pruned
}

/// Whether `name` may name a variable of the user: the schema pattern holds
/// it, and the prefix of the built-in ones does not start it.
fn is_user_variable_name(name: &str) -> bool {
    !name.starts_with(crate::services::variables::BUILTIN_PREFIX)
}

/// Drops the variables a user may not declare, and the repeats of a name, the
/// first one kept: a template refers to a variable by its name.
fn retain_user_variables(config: &mut Value) {
    let Some(variables) = config["variables"].as_array_mut() else {
        return;
    };
    let mut names = HashSet::new();
    variables.retain(|variable| {
        let name = variable["name"].as_str().unwrap_or_default();
        is_user_variable_name(name) && names.insert(name.to_ascii_uppercase())
    });
}

fn is_device_schema(schema: &Value) -> bool {
    schema["x-scope"] == "device"
}

/// Whether the field at `path`, e.g. `["appearance", "uiScalePercent"]`,
/// belongs to this device rather than to the user data.
#[cfg(test)]
pub fn is_device_scoped(path: &[&str]) -> bool {
    let mut schema = &*SCHEMA;
    for key in path {
        schema = &schema["properties"][*key];
        if schema.is_null() {
            return false;
        }
        if is_device_schema(schema) {
            return true;
        }
    }
    false
}

/// The path of a config field, its keys in order.
pub type ConfigPath = Vec<String>;

/// The config split into the part of the user data, which may be synced, and
/// the part of this device, see `x-scope` of the schema. An unknown field goes
/// back to the file it came from: `device_unknown` names those of the device.
pub fn split_by_scope(config: &Value, device_unknown: &HashSet<ConfigPath>) -> (Value, Value) {
    fn split(
        value: &serde_json::Map<String, Value>,
        schema: &Value,
        path: &mut ConfigPath,
        device_unknown: &HashSet<ConfigPath>,
    ) -> (
        serde_json::Map<String, Value>,
        serde_json::Map<String, Value>,
    ) {
        let mut user = serde_json::Map::new();
        let mut device = serde_json::Map::new();
        for (key, item) in value {
            let child = &schema["properties"][key];
            path.push(key.clone());
            if is_device_schema(child) {
                device.insert(key.clone(), item.clone());
            } else if let (Some(_), Some(fields)) =
                (child["properties"].as_object(), item.as_object())
            {
                let (nested_user, nested_device) = split(fields, child, path, device_unknown);
                user.insert(key.clone(), Value::Object(nested_user));
                if !nested_device.is_empty() {
                    device.insert(key.clone(), Value::Object(nested_device));
                }
            } else if child.is_null() && device_unknown.contains(path) {
                device.insert(key.clone(), item.clone());
            } else {
                user.insert(key.clone(), item.clone());
            }
            path.pop();
        }
        (user, device)
    }
    let empty = serde_json::Map::new();
    let (user, device) = split(
        config.as_object().unwrap_or(&empty),
        &SCHEMA,
        &mut Vec::new(),
        device_unknown,
    );
    (Value::Object(user), Value::Object(device))
}

/// The parts of the user data and of the device joined into one config, and
/// the paths of the unknown fields the device part brought, for
/// `split_by_scope`.
pub fn join_scopes(user: &Value, device: &Value) -> (Value, HashSet<ConfigPath>) {
    fn join(
        target: &mut serde_json::Map<String, Value>,
        source: &serde_json::Map<String, Value>,
        schema: Option<&Value>,
        path: &mut ConfigPath,
        unknown: &mut HashSet<ConfigPath>,
    ) {
        for (key, item) in source {
            let child = schema.map(|schema| &schema["properties"][key]);
            path.push(key.clone());
            if let Some(schema) = schema {
                if child.is_some_and(Value::is_null) && !is_device_schema(schema) {
                    unknown.insert(path.clone());
                }
            }
            let container =
                child.filter(|child| child["properties"].is_object() && !is_device_schema(child));
            match (container, item.as_object(), target.get_mut(key)) {
                (Some(child), Some(fields), Some(Value::Object(existing))) => {
                    join(existing, fields, Some(child), path, unknown);
                }
                _ => {
                    target.insert(key.clone(), item.clone());
                }
            }
            path.pop();
        }
    }
    let mut config = user.as_object().cloned().unwrap_or_default();
    let mut unknown = HashSet::new();
    if let Some(device) = device.as_object() {
        join(
            &mut config,
            device,
            Some(&SCHEMA),
            &mut Vec::new(),
            &mut unknown,
        );
    }
    (Value::Object(config), unknown)
}

const MAX_COMMAND_ID_LENGTH: usize = 64;

fn is_valid_command_id(id: &str) -> bool {
    SCHEMA["properties"]["commands"]["items"]["properties"]["id"]["pattern"]
        .as_str()
        .is_some_and(|pattern| matches_pattern(pattern, id))
}

/// A valid command id made of an invalid one: ASCII letters in lower case,
/// each run of other characters as one `-`, without leading or trailing
/// punctuation. Keep in sync with `commandIdFrom` in `@tyco/shared`.
fn command_id_from(id: &str) -> String {
    let mut result = String::with_capacity(id.len());
    let mut in_run = false;
    for c in id.chars().map(|c| c.to_ascii_lowercase()) {
        if c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-') {
            result.push(c);
            in_run = false;
        } else if !in_run {
            result.push('-');
            in_run = true;
        }
    }
    result
        .trim_matches(|c: char| !c.is_ascii_alphanumeric())
        .chars()
        .take(MAX_COMMAND_ID_LENGTH)
        .collect()
}

/// Keep in sync with `isBlankId` in `@tyco/shared`.
fn is_blank_id(id: &str) -> bool {
    id.chars().all(|c| matches!(c, ' ' | '\t' | '\n' | '\r'))
}

/// New ids for the commands whose id breaks the schema, which would drop
/// them; see `commandIdRepairs` in `@tyco/shared`.
fn command_id_repairs(commands: &Value) -> HashMap<String, String> {
    let mut repairs = HashMap::new();
    let ids: Vec<&str> = commands
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|command| command.get("id").and_then(Value::as_str))
        .collect();
    let mut taken: HashSet<String> = ids
        .iter()
        .filter(|id| is_valid_command_id(id))
        .map(|id| (*id).to_owned())
        .collect();
    for id in ids {
        // a blank id is no id: such a command stays dropped
        if is_valid_command_id(id) || repairs.contains_key(id) || is_blank_id(id) {
            continue;
        }
        let mut base = command_id_from(id);
        if base.is_empty() {
            base = String::from("command");
        }
        let mut candidate = base.clone();
        let mut index = 2;
        while taken.contains(&candidate) {
            let suffix = format!("-{index}");
            let kept: String = base
                .chars()
                .take(MAX_COMMAND_ID_LENGTH - suffix.len())
                .collect();
            candidate = format!("{kept}{suffix}");
            index += 1;
        }
        taken.insert(candidate.clone());
        repairs.insert(id.to_owned(), candidate);
    }
    repairs
}

/// Gives the commands valid ids, the menu items and launcher keys of those
/// commands following them; see `repairCommandIds` in `@tyco/shared`.
fn repair_command_ids(config: &mut Value) {
    let repairs = command_id_repairs(&config["commands"]);
    if repairs.is_empty() {
        return;
    }
    let renamed = |value: &mut Value| {
        if let Some(new_id) = value.as_str().and_then(|id| repairs.get(id)) {
            *value = Value::String(new_id.clone());
        }
    };
    for command in config["commands"].as_array_mut().into_iter().flatten() {
        if let Some(id) = command.get_mut("id") {
            renamed(id);
        }
    }
    if let Some(pages) = config.get_mut("actionPages").and_then(Value::as_array_mut) {
        for page in pages {
            if let Some(slots) = page.get_mut("slots").and_then(Value::as_object_mut) {
                for slot in slots.values_mut() {
                    if slot["type"] == "command" {
                        if let Some(id) = slot.get_mut("commandId") {
                            renamed(id);
                        }
                    }
                }
            }
        }
    }
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
    fn shared_scope_fixtures_match_the_webview() {
        let cases: Vec<Value> = serde_json::from_str(include_str!(
            "../../../../packages/shared/fixtures/config-scope.json"
        ))
        .unwrap();
        for case in cases {
            let name = &case["name"];
            let (joined, unknown) = join_scopes(&case["user"], &case["device"]);
            assert_eq!(joined, case["joined"], "{name}");
            let expected: HashSet<ConfigPath> =
                serde_json::from_value(case["deviceUnknownPaths"].clone()).unwrap();
            assert_eq!(unknown, expected, "{name}");
            let (user, device) = split_by_scope(&joined, &unknown);
            assert_eq!(user, case["user"], "{name}");
            assert_eq!(device, case["device"], "{name}");
        }
    }

    #[test]
    fn device_scope_marks_sections_and_fields_never_entities() {
        assert!(is_device_scoped(&["hotkeys", "quickInput"]));
        assert!(is_device_scoped(&["appearance", "uiScalePercent"]));
        assert!(is_device_scoped(&["editor", "history", "isLocalOnly"]));
        assert!(!is_device_scoped(&["appearance", "theme"]));
        assert!(!is_device_scoped(&["editor", "shortcuts", "bold"]));
        fn visit(node: &Value, in_entity: bool, path: &str, found: &mut Vec<String>) {
            match node {
                Value::Object(fields) => {
                    if in_entity && fields.contains_key("x-scope") {
                        found.push(path.to_owned());
                    }
                    for (key, child) in fields {
                        let entity = in_entity
                            || matches!(key.as_str(), "items" | "additionalProperties" | "$defs");
                        visit(child, entity, &format!("{path}/{key}"), found);
                    }
                }
                Value::Array(items) => {
                    for (index, item) in items.iter().enumerate() {
                        visit(item, in_entity, &format!("{path}/{index}"), found);
                    }
                }
                _ => {}
            }
        }
        let mut found = Vec::new();
        visit(&SCHEMA, false, "", &mut found);
        assert!(found.is_empty(), "x-scope inside an entity: {found:?}");
    }

    #[test]
    fn a_variable_value_of_a_removed_variable_is_dropped() {
        let mut config = crate::services::settings::defaults::default_user_config();
        config["variableValues"]["gone"] = json!("secret");
        assert!(prune_device_references(&mut config));
        assert!(config["variableValues"].get("gone").is_none());
        assert!(!prune_device_references(&mut config));
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
            defaults["hotkeys"]["selectionActions"],
            json!(format!(
                "{}+S",
                crate::services::platform::hotkeys::DEFAULT_MODIFIERS
            ))
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
            ("/transformations/items/0/id", json!("Deep edit")),
            ("/actionPages/0/inputMode", json!("none")),
            ("/llm/models/0/id", json!(" ollama-qwen")),
            ("/stt/providers", json!("bad")),
            ("/stt/provider", json!("missing")),
            ("/commands", json!([{"id":"a"}])),
            (
                "/actionPages/0/slots",
                json!({"q": {"type":"command","commandId":"missing"}}),
            ),
            (
                "/actionPages/0/slots",
                json!({"y": {"type":"standard","actionId":"askInChat"}}),
            ),
            ("/actionPages", json!([])),
            (
                "/translation/targetLanguages",
                json!({"q": "en-US", "w": "en-US"}),
            ),
            ("/transformations/slots", json!({"q": "missing"})),
            (
                "/transformations/slots",
                json!({"q": "deep-edit", "w": "deep-edit"}),
            ),
        ] {
            let mut config = defaults.clone();
            *config.pointer_mut(path).unwrap() = value;
            assert!(validate_user_config(&config).is_err(), "{path}");
        }
        for pointer in ["/llm/models", "/transformations/items"] {
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
        config["actionPages"] = json!([{
            "inputMode": "selection",
            "slots": {
                "q": {"type":"command","commandId":"missing"},
                "w": {"type":"standard","actionId":"askInChat"},
                "y": {"type":"standard","actionId":"askInChat"},
            }
        }]);
        config["translation"]["targetLanguages"] = json!({"q": "en-US", "w": "en-US", "e": 1});
        config["transformations"]["slots"] =
            json!({"q": "gone", "w": "deep-edit", "e": "deep-edit"});
        assert!(normalize_user_config(&mut config));
        validate_user_config(&config).unwrap();
        assert!(!normalize_user_config(&mut config));
        assert_eq!(
            config["actionPages"][0]["slots"],
            json!({"w": {"type":"standard","actionId":"askInChat"}})
        );
        assert_eq!(
            config["translation"]["targetLanguages"],
            json!({"q": "en-US"})
        );
        assert_eq!(
            config["transformations"]["slots"],
            json!({"w": "deep-edit"})
        );
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
