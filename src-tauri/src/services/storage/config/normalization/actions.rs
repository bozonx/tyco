use crate::models::default_user_config;
use serde_json::{json, Value};

pub(in crate::services::storage::config) fn normalize_main_actions_config(
    user_config: &mut Value,
) -> bool {
    let defaults = default_user_config();
    let Some(config) = user_config.as_object_mut() else {
        return false;
    };

    let mut changed = false;
    if config
        .get("mainActions")
        .and_then(Value::as_array)
        .is_none()
    {
        config.insert(String::from("mainActions"), defaults["mainActions"].clone());
        changed = true;
    }
    if config.get("commands").and_then(Value::as_array).is_none() {
        config.insert(String::from("commands"), json!([]));
        changed = true;
    }

    changed
}
