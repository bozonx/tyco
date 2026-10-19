use crate::services::settings::defaults::default_user_config;
use serde_json::Value;

/// The translation languages fill shortcut slots; restore the defaults when
/// there are none.
pub(in crate::services::storage::config) fn normalize_language_config(
    user_config: &mut Value,
) -> bool {
    let Some(config) = user_config
        .get_mut("translation")
        .and_then(Value::as_object_mut)
    else {
        return false;
    };
    if config
        .get("targetLanguages")
        .and_then(Value::as_object)
        .is_some_and(|languages| !languages.is_empty())
    {
        return false;
    }
    let defaults = default_user_config();
    config.insert(
        String::from("targetLanguages"),
        defaults["translation"]["targetLanguages"].clone(),
    );
    true
}
