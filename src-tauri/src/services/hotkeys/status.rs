//! Serialized hotkey status and the provider snapshot shown by the UI.
use super::bindings::{bindings_from_config, default_bindings};
use super::{HotkeyRegistry, PortalShortcutBindings, ProviderKind, ProviderState};
use crate::locks::RwLockExt;
use crate::services::platform::hotkeys::portal;
use crate::services::platform::hotkeys::{external_command, platform_name};
use crate::state::AppState;
use serde::Serialize;
use std::collections::HashMap;
use tauri::{AppHandle, Manager};

/// Mirrors `HotkeyApplyStatus` in `@tyco/shared`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum HotkeyApplyStatus {
    Ready,
    Conflict,
    External,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyHotkeyResult {
    pub status: HotkeyApplyStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyProviderInfo {
    #[serde(rename = "provider")]
    pub provider_id: &'static str,
    pub can_configure: bool,
    pub actions: HashMap<String, ApplyHotkeyResult>,
    pub system_triggers: HashMap<String, String>,
    /// The portal session is bound, so `system_triggers` is what the desktop
    /// has, not what it has not reported yet
    #[serde(rename = "registered")]
    pub is_registered: bool,
    /// The default shortcut of every hotkey id on this platform
    #[serde(rename = "defaults")]
    pub default_shortcuts: HashMap<String, String>,
    #[serde(rename = "platform")]
    pub platform_name: &'static str,
}

pub async fn provider_info(app: &AppHandle) -> HotkeyProviderInfo {
    let kind = app.state::<ProviderState>().kind();
    if kind == ProviderKind::Portal {
        portal::refresh_system_triggers(app).await;
    }
    let config = app.state::<AppState>().user_config();
    // only an external binding needs something per action: its command
    let actions = match kind {
        ProviderKind::External => bindings_from_config(&config)
            .into_iter()
            .map(|binding| {
                let result = ApplyHotkeyResult {
                    status: HotkeyApplyStatus::External,
                    external_command: Some(external_command(
                        &binding.target,
                        binding.shortcut.as_deref(),
                    )),
                    message: None,
                };
                (binding.target.id(), result)
            })
            .collect(),
        // a shortcut another application holds is worth showing at once
        ProviderKind::GlobalShortcut => app
            .state::<HotkeyRegistry>()
            .failures
            .read_locked()
            .iter()
            .map(|(id, message)| {
                let result = ApplyHotkeyResult {
                    status: HotkeyApplyStatus::Conflict,
                    external_command: None,
                    message: Some(message.clone()),
                };
                (id.clone(), result)
            })
            .collect(),
        ProviderKind::Portal => HashMap::new(),
    };
    let system_triggers = match kind {
        ProviderKind::Portal => app
            .state::<PortalShortcutBindings>()
            .0
            .read_locked()
            .clone(),
        ProviderKind::GlobalShortcut | ProviderKind::External => HashMap::new(),
    };
    HotkeyProviderInfo {
        provider_id: match kind {
            ProviderKind::Portal => "portal",
            ProviderKind::GlobalShortcut => "global-shortcut",
            ProviderKind::External => "external",
        },
        can_configure: kind == ProviderKind::Portal && portal::can_configure(app),
        is_registered: kind == ProviderKind::Portal && portal::is_registered(app),
        actions,
        system_triggers,
        default_shortcuts: default_bindings()
            .into_iter()
            .map(|binding| (binding.target.id(), binding.shortcut.unwrap_or_default()))
            .collect(),
        platform_name: platform_name(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn hotkey_provider_info_preserves_wire_names() {
        let mut actions = HashMap::new();
        actions.insert(
            "write".to_string(),
            ApplyHotkeyResult {
                status: HotkeyApplyStatus::Ready,
                external_command: None,
                message: None,
            },
        );
        actions.insert(
            "editor".to_string(),
            ApplyHotkeyResult {
                status: HotkeyApplyStatus::External,
                external_command: Some("tyco --mode=editor".to_string()),
                message: Some("configured externally".to_string()),
            },
        );

        let mut defaults = HashMap::new();
        defaults.insert("write".to_string(), "Ctrl+Space".to_string());

        let info = HotkeyProviderInfo {
            provider_id: "global-shortcut",
            can_configure: false,
            actions,
            system_triggers: HashMap::new(),
            is_registered: true,
            default_shortcuts: defaults,
            platform_name: "linux",
        };

        let serialized = serde_json::to_value(&info).unwrap();
        assert_eq!(serialized["provider"], "global-shortcut");
        assert_eq!(serialized["canConfigure"], false);
        assert_eq!(serialized["registered"], true);
        assert_eq!(serialized["platform"], "linux");
        assert_eq!(serialized["defaults"]["write"], "Ctrl+Space");
        assert_eq!(serialized["actions"]["write"]["status"], "ready");
        assert!(serialized["actions"]["write"]
            .get("externalCommand")
            .is_none());
        assert_eq!(serialized["actions"]["editor"]["status"], "external");
        assert_eq!(
            serialized["actions"]["editor"]["externalCommand"],
            "tyco --mode=editor"
        );
        assert_eq!(
            serialized["actions"]["editor"]["message"],
            "configured externally"
        );
    }

    #[test]
    fn apply_status_serializes_to_kebab_case() {
        assert_eq!(
            serde_json::to_value(HotkeyApplyStatus::Ready).unwrap(),
            json!("ready")
        );
        assert_eq!(
            serde_json::to_value(HotkeyApplyStatus::Conflict).unwrap(),
            json!("conflict")
        );
        assert_eq!(
            serde_json::to_value(HotkeyApplyStatus::External).unwrap(),
            json!("external")
        );
    }
}
