use crate::models::default_user_config;
use serde_json::Value;

/// The translation languages fill a fixed number of shortcut slots.
pub(in crate::services::storage::config) fn normalize_language_config(
    user_config: &mut Value,
) -> bool {
    let Some(config) = user_config
        .get_mut("translation")
        .and_then(Value::as_object_mut)
    else {
        return false;
    };
    let defaults = default_user_config();
    let slot_count = defaults["translation"]["targetLanguages"]
        .as_array()
        .map_or(0, Vec::len);
    if config
        .get("targetLanguages")
        .and_then(Value::as_array)
        .is_some_and(|languages| languages.len() == slot_count)
    {
        return false;
    }
    config.insert(
        String::from("targetLanguages"),
        defaults["translation"]["targetLanguages"].clone(),
    );
    true
}
