//! Serialized hotkey status and the provider snapshot shown by the UI.
use super::bindings::{bindings_from_config, default_bindings};
use super::{HotkeyRegistry, ProviderKind, ProviderState, SystemTriggers};
use crate::services::platform::hotkeys::{external_command, platform_name};
#[cfg(target_os = "linux")]
use crate::services::platform::linux::hotkeys_portal::{
    can_configure_portal, refresh_system_triggers, PortalState,
};
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
    provider: &'static str,
    can_configure: bool,
    actions: HashMap<String, ApplyHotkeyResult>,
    system_triggers: HashMap<String, String>,
    /// The portal session is bound, so `system_triggers` is what the desktop
    /// has, not what it has not reported yet
    registered: bool,
    /// The default shortcut of every hotkey id on this platform
    defaults: HashMap<String, String>,
    platform: &'static str,
}

pub async fn provider_info(app: &AppHandle) -> HotkeyProviderInfo {
    let kind = app.state::<ProviderState>().get();
    #[cfg(target_os = "linux")]
    if kind == ProviderKind::Portal {
        refresh_system_triggers(app).await;
    }
    let config = app.state::<AppState>().params().user_config;
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
            .read()
            .expect("hotkey failures lock poisoned")
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
            .state::<SystemTriggers>()
            .0
            .read()
            .expect("system triggers lock poisoned")
            .clone(),
        ProviderKind::GlobalShortcut | ProviderKind::External => HashMap::new(),
    };
    HotkeyProviderInfo {
        provider: match kind {
            ProviderKind::Portal => "portal",
            ProviderKind::GlobalShortcut => "global-shortcut",
            ProviderKind::External => "external",
        },
        can_configure: kind == ProviderKind::Portal && can_configure_portal(app),
        registered: kind == ProviderKind::Portal && portal_registered(app),
        actions,
        system_triggers,
        defaults: default_bindings()
            .into_iter()
            .map(|binding| (binding.target.id(), binding.shortcut.unwrap_or_default()))
            .collect(),
        platform: platform_name(),
    }
}

#[cfg(not(target_os = "linux"))]
fn can_configure_portal(_app: &AppHandle) -> bool {
    false
}

#[cfg(target_os = "linux")]
fn portal_registered(app: &AppHandle) -> bool {
    app.state::<PortalState>().registration().is_some()
}

#[cfg(not(target_os = "linux"))]
fn portal_registered(_app: &AppHandle) -> bool {
    false
}
