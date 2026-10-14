use crate::models::default_user_config;
use serde_json::{Map, Value};

/// Keeps one hotkey per known mode: the user's shortcut, or the platform
/// default when there is none. Modes of older versions are dropped. A missing
/// selection hotkey gets its default too.
pub(in crate::services::storage::config) fn normalize_hotkeys_config(
    user_config: &mut Value,
) -> bool {
    let defaults = default_user_config();
    let Some(config) = user_config.as_object_mut() else {
        return false;
    };
    let mut changed = false;

    let hotkeys = with_defaults(config.get("hotkeys"), &defaults["hotkeys"], true);
    if config.get("hotkeys") != Some(&hotkeys) {
        config.insert(String::from("hotkeys"), hotkeys);
        changed = true;
    }

    let selection_hotkeys = with_defaults(
        config.get("selectionHotkeys"),
        &defaults["selectionHotkeys"],
        false,
    );
    if config.get("selectionHotkeys") != Some(&selection_hotkeys) {
        config.insert(String::from("selectionHotkeys"), selection_hotkeys);
        changed = true;
    }

    changed
}

fn with_defaults(current: Option<&Value>, defaults: &Value, drop_unknown: bool) -> Value {
    let mut result = current
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let defaults = defaults.as_object().cloned().unwrap_or_else(Map::new);
    if drop_unknown {
        result.retain(|key, _| defaults.contains_key(key));
    }
    for (key, shortcut) in defaults {
        result.entry(key).or_insert(shortcut);
    }
    Value::Object(result)
}
