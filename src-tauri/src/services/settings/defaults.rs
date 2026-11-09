//! The configuration and state a fresh start begins with.
use crate::models::{
    ActivationMode, ActivationSnapshot, DesktopSnapshot, SessionState, SettingsSnapshot,
    UserDataState, UserDataStatus, WindowProfile, WindowSnapshot,
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
            screenshots: Vec::new(),
            screenshot: None,
            mode: session_state.last_mode.or(Some(ActivationMode::Editor)),
            action_page_index: None,
            custom_action_index: None,
            history_origin: None,
            settings_tab: None,
            access_request: None,
        },
        window: WindowSnapshot {
            is_window_shown: false,
            window_profile: WindowProfile::Sheet,
            can_move_overlay: false,
            can_listen: false,
            can_listen_to_apps: false,
        },
        settings: SettingsSnapshot {
            user_config: std::sync::Arc::new(user_config),
            session_state,
            user_data: UserDataState {
                path: String::new(),
                default_path: String::new(),
                is_default: true,
                status: UserDataStatus::Connected,
                is_writable_by_others: false,
                device_id: String::new(),
                platform: String::from("linux"),
            },
        },
    }
}
