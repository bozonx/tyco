//! The configuration and state a fresh start begins with.
use crate::models::{
    ActivationMode, ActivationSnapshot, DesktopSnapshot, SessionState, SettingsSnapshot,
    WindowProfile, WindowSnapshot,
};
use crate::services::hotkeys;
use serde_json::{json, Map, Value};

/// The defaults both runtimes share, `configVersion` first.
pub fn portable_user_config() -> Value {
    let shared: Map<String, Value> = serde_json::from_str(include_str!(
        "../../../../packages/shared/src/user-config-defaults.json"
    ))
    .expect("valid shared user config defaults");
    let mut config = Map::new();
    config.insert(
        String::from(crate::services::settings::version::CONFIG_VERSION_KEY),
        json!(crate::services::settings::version::CONFIG_VERSION),
    );
    config.extend(shared);
    Value::Object(config)
}

/// The portable defaults with the hotkeys of this platform.
pub fn default_user_config() -> Value {
    let mut config = portable_user_config();
    config["hotkeys"] = hotkeys::default_hotkeys_config();
    config
}

pub fn default_desktop_snapshot(
    user_config: Value,
    session_state: SessionState,
) -> DesktopSnapshot {
    DesktopSnapshot {
        revision: 0,
        activation: ActivationSnapshot {
            activation_id: 0,
            target_window_id: None,
            selected_text: None,
            mode: session_state.last_mode.or(Some(ActivationMode::Editor)),
            launcher_page_id: None,
            launcher_request: None,
            access_request: None,
        },
        window: WindowSnapshot {
            is_window_shown: false,
            window_profile: WindowProfile::Sheet,
        },
        settings: SettingsSnapshot {
            user_config: std::sync::Arc::new(user_config),
            session_state,
        },
    }
}
