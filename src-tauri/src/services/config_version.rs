//! The schema version of the user config. A config without `configVersion`
//! is version 0; a config newer than this build is left untouched and never
//! written over.

use serde_json::{json, Value};

/// Both runtimes read the same portable schema version.
pub const CONFIG_VERSION: u64 = shared_config_version();

const fn shared_config_version() -> u64 {
    let bytes = include_bytes!("../../../packages/shared/src/config-version.json");
    let mut version = 0;
    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        if byte >= b'0' && byte <= b'9' {
            version = version * 10 + (byte - b'0') as u64;
        } else {
            assert!(byte == b'\n' || byte == b'\r' || byte == b' ');
        }
        index += 1;
    }
    version
}

pub const CONFIG_VERSION_KEY: &str = "configVersion";

/// The schema version of `user_config`; 0 when it has none.
pub fn config_version(user_config: &Value) -> u64 {
    user_config
        .get(CONFIG_VERSION_KEY)
        .and_then(Value::as_u64)
        .unwrap_or(0)
}

/// A config written by a newer build: this one must not write over it.
pub fn is_newer_than_supported(user_config: &Value) -> bool {
    config_version(user_config) > CONFIG_VERSION
}

/// Sets `configVersion` to the current one, unless it is there already.
pub fn stamp_current_version(user_config: &mut Value) -> bool {
    let Some(config) = user_config.as_object_mut() else {
        return false;
    };
    if config.get(CONFIG_VERSION_KEY).and_then(Value::as_u64) == Some(CONFIG_VERSION) {
        return false;
    }
    config.insert(String::from(CONFIG_VERSION_KEY), json!(CONFIG_VERSION));
    true
}
