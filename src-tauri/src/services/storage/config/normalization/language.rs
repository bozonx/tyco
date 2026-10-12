use crate::models::default_user_config;
use serde_json::Value;

pub(in crate::services::storage::config) fn normalize_language_config(
    user_config: &mut Value,
) -> bool {
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
