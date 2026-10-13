use super::{ensure_enum_field, ensure_field};
use crate::models::default_user_config;
use serde_json::{json, Value};

pub(in crate::services::storage::config) fn normalize_translation_config(
    user_config: &mut Value,
) -> bool {
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

    changed |= ensure_enum_field(
        translation,
        "provider",
        &default_translation["provider"],
        &["deepl", "google", "llm"],
    );

    changed |= ensure_enum_field(
        translation,
        "qualityGate",
        &default_translation["qualityGate"],
        &["off", "on_problems", "always"],
    );

    changed |= ensure_enum_field(
        translation,
        "deeplEndpoint",
        &default_translation["deeplEndpoint"],
        &["free", "pro"],
    );

    changed |= ensure_field(translation, "glossary", &json!([]), Value::is_array);

    changed |= ensure_field(
        translation,
        "correctionPrompt",
        &json!(""),
        Value::is_string,
    );

    changed
}
