use crate::services::platform::session::{self, Session};
use crate::services::settings::defaults::default_user_config_for_session;
use serde_json::{json, Value};

const METHODS: [&str; 2] = ["xdotool", "ydotool"];

pub(in crate::services::storage::config) fn normalize_window_insertion_config(
    user_config: &mut Value,
) -> bool {
    normalize_window_insertion_for_session(user_config, session::current())
}

/// A missing or unknown Linux insertion method becomes the one of the current
/// session: ydotool on Wayland, xdotool elsewhere. The schema repairs the rest.
pub(super) fn normalize_window_insertion_for_session(
    user_config: &mut Value,
    session: Session,
) -> bool {
    let Some(config) = user_config.as_object_mut() else {
        return false;
    };
    let method = config
        .get("windowInsertion")
        .and_then(|insertion| insertion.get("linux"))
        .and_then(|linux| linux.get("method"))
        .and_then(Value::as_str);
    if method.is_some_and(|method| METHODS.contains(&method)) {
        return false;
    }
    let default_method =
        default_user_config_for_session(session)["windowInsertion"]["linux"]["method"].clone();
    let insertion = config.entry("windowInsertion").or_insert_with(|| json!({}));
    if !insertion.is_object() {
        *insertion = json!({});
    }
    let linux = insertion
        .as_object_mut()
        .expect("insertion settings object")
        .entry("linux")
        .or_insert_with(|| json!({}));
    if !linux.is_object() {
        *linux = json!({});
    }
    linux["method"] = default_method;
    true
}
