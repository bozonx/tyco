use crate::models::default_user_config;
use serde_json::Value;

pub(in crate::services::storage::config) fn normalize_appearance_config(
    user_config: &mut Value,
) -> bool {
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
