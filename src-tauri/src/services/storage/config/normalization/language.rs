use super::ensure_field;
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

    changed |= ensure_field(
        config,
        "appLanguage",
        &defaults["appLanguage"],
        Value::is_string,
    );

    changed |= ensure_field(
        config,
        "userLanguage",
        &defaults["userLanguage"],
        Value::is_string,
    );

    changed |= ensure_field(
        config,
        "toTranslateLanguages",
        &defaults["toTranslateLanguages"],
        |value| {
            value
                .as_array()
                .is_some_and(|languages| languages.len() == 4)
        },
    );

    changed
}
