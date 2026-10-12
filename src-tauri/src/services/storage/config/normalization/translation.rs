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
