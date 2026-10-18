use crate::models::default_user_config;
use serde_json::Value;

/// Keeps one hotkey per known target: the user's shortcut, or the platform
/// default when there is none. Unknown targets are dropped.
pub(in crate::services::storage::config) fn normalize_hotkeys_config(
    user_config: &mut Value,
) -> bool {
    let defaults = default_user_config();
    let Some(config) = user_config.as_object_mut() else {
        return false;
    };
    let defaults = defaults["hotkeys"].as_object().cloned().unwrap_or_default();
    let mut hotkeys = config
        .get("hotkeys")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    hotkeys.retain(|key, _| defaults.contains_key(key));
    for (key, shortcut) in defaults {
        hotkeys.entry(key).or_insert(shortcut);
    }
    let hotkeys = Value::Object(hotkeys);
    if config.get("hotkeys") == Some(&hotkeys) {
        return false;
    }
    config.insert(String::from("hotkeys"), hotkeys);
    true
}
