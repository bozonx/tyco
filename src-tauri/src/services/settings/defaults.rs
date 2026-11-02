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
    let mut launcher_hotkeys = Map::new();
    if let Some(pages) = config["launcherPages"].as_array() {
        for (index, page) in pages.iter().enumerate() {
            if let Some(page_id) = page["id"].as_str() {
                let shortcut = if index == 0 {
                    hotkeys::default_launcher_page_shortcut()
                } else {
                    String::new()
                };
                launcher_hotkeys.insert(page_id.to_owned(), json!(shortcut));
            }
        }
    }
    config["hotkeys"]["launcherPages"] = Value::Object(launcher_hotkeys);
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
