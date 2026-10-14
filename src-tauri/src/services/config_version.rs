//! The supported config schema version. Future schemas are rejected without
//! changing the saved file.

use serde_json::Value;

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
