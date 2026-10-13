use crate::models::default_user_config_for_session;
use crate::services::platform::session::{self, Session};
use serde_json::{json, Value};

pub(in crate::services::storage::config) fn normalize_window_insertion_config(
    user_config: &mut Value,
) -> bool {
    normalize_window_insertion_for_session(user_config, session::current())
}

pub(super) fn normalize_window_insertion_for_session(
    user_config: &mut Value,
    session: Session,
) -> bool {
    let defaults = default_user_config_for_session(session);
    let default_window_insertion = defaults
        .get("windowInsertion")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let default_method = default_window_insertion
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("xdotool");
    let default_xdotool_bin = default_window_insertion
        .get("xdotoolBin")
        .and_then(Value::as_str)
        .unwrap_or("/usr/bin/xdotool");
    let default_ydotool_bin = default_window_insertion
        .get("ydotoolBin")
        .and_then(Value::as_str)
        .unwrap_or("/usr/bin/ydotool");
    let default_paste_shortcut = default_window_insertion
        .get("pasteShortcut")
        .and_then(Value::as_str)
        .unwrap_or("ctrl+v");

    let Some(config) = user_config.as_object_mut() else {
        return false;
    };

    let legacy_xdotool_bin = config
        .get("xdotoolBin")
        .and_then(Value::as_str)
        .unwrap_or(default_xdotool_bin);
    let window_insertion = config.get("windowInsertion");
    let method = window_insertion
        .and_then(|value| value.get("method"))
        .and_then(Value::as_str)
        .filter(|value| *value == "xdotool" || *value == "ydotool")
        .unwrap_or(default_method);
    let xdotool_bin = window_insertion
        .and_then(|value| value.get("xdotoolBin"))
        .and_then(Value::as_str)
        .unwrap_or(legacy_xdotool_bin);
    let ydotool_bin = window_insertion
        .and_then(|value| value.get("ydotoolBin"))
        .and_then(Value::as_str)
        .unwrap_or(default_ydotool_bin);
    let paste_shortcut = window_insertion
        .and_then(|value| value.get("pasteShortcut"))
        .and_then(Value::as_str)
        .filter(|value| *value == "ctrl+v" || *value == "ctrl+shift+v" || *value == "shift+insert")
        .unwrap_or(default_paste_shortcut);
    let normalized = json!({
        "method": method,
        "xdotoolBin": xdotool_bin,
        "ydotoolBin": ydotool_bin,
        "pasteShortcut": paste_shortcut,
    });
    let needs_update =
        config.get("windowInsertion") != Some(&normalized) || config.contains_key("xdotoolBin");
    config.remove("xdotoolBin");
    if needs_update {
        config.insert(String::from("windowInsertion"), normalized);
    }
    needs_update
}
