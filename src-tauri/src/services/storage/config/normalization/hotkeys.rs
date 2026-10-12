use crate::models::default_user_config;
use serde_json::Value;

pub(in crate::services::storage::config) fn normalize_hotkeys_config(
    user_config: &mut Value,
) -> bool {
    let defaults = default_user_config();
    let default_hotkeys = defaults
        .get("hotkeys")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let default_selection_hotkeys = defaults
        .get("selectionHotkeys")
        .cloned()
        .unwrap_or_default();

    let Some(config) = user_config.as_object_mut() else {
        return false;
    };
    let mut changed = false;

    // Hotkeys mapping
    let mut hotkeys = config
        .get("hotkeys")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let previous_hotkeys = hotkeys.clone();
    hotkeys.remove("history");
    hotkeys.remove("config");
    for (mode, shortcut) in default_hotkeys {
        hotkeys.entry(mode).or_insert(shortcut);
    }
    if hotkeys != previous_hotkeys || config.get("hotkeys").and_then(Value::as_object).is_none() {
        config.insert(String::from("hotkeys"), Value::Object(hotkeys));
        changed = true;
    }

    // Quick input hotkeys
    if config.remove("quickInputSubmit").is_some() {
        changed = true;
    }
    if config.remove("quickCorrection").is_some() {
        changed = true;
    }

    // The per-action quick input bindings gave way to a single submit key:
    // whoever sent with Ctrl+Enter keeps doing so
    let legacy_submit = config
        .remove("quickInputHotkeys")
        .map(|quick| quick.get("correctAndInsert").and_then(Value::as_str) == Some("Ctrl+Enter"));
    if legacy_submit.is_some() {
        changed = true;
    }
    let submit_key = config.get("submitKey").and_then(Value::as_str);
    if !matches!(submit_key, Some("enter" | "ctrlEnter")) {
        let migrated = if legacy_submit == Some(true) {
            "ctrlEnter"
        } else {
            "enter"
        };
        config.insert(String::from("submitKey"), Value::String(migrated.into()));
        changed = true;
    }

    // Quick toggles
    let prefetch = config
        .get("quickCorrectionPrefetch")
        .and_then(Value::as_bool);
    if prefetch.is_none() {
        config.insert(String::from("quickCorrectionPrefetch"), Value::Bool(false));
        changed = true;
    }

    let hide_on_blur = config.get("quickHideOnBlur").and_then(Value::as_bool);
    if hide_on_blur.is_none() {
        config.insert(String::from("quickHideOnBlur"), Value::Bool(true));
        changed = true;
    }

    // Selection hotkeys: only the correction replaces the selection from a
    // hotkey, translations and AI tasks no longer do
    if let Some(sel_hotkeys) = config
        .get_mut("selectionHotkeys")
        .and_then(Value::as_object_mut)
    {
        let before = sel_hotkeys.len();
        sel_hotkeys.retain(|action, _| default_selection_hotkeys.get(action).is_some());
        changed |= sel_hotkeys.len() != before;
        if let Some(def_sel) = default_selection_hotkeys.as_object() {
            for (action, default_key) in def_sel {
                if !sel_hotkeys.contains_key(action) {
                    sel_hotkeys.insert(action.clone(), default_key.clone());
                    changed = true;
                }
            }
        }
    } else {
        config.insert(String::from("selectionHotkeys"), default_selection_hotkeys);
        changed = true;
    }

    // Replacing the selection always takes the selection, never the whole field
    if config.remove("selectionReplace").is_some() {
        changed = true;
    }

    changed
}
