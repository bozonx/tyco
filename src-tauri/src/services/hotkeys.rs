use std::collections::HashMap;
use std::env;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::RwLock;

use ashpd::desktop::global_shortcuts::{BindShortcutsOptions, GlobalShortcuts, NewShortcut};
use ashpd::desktop::CreateSessionOptions;
use ashpd::{register_host_app, AppID};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{App, AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::errors::AppError;
use crate::services::activation::{Activation, ActivationSource, StartMode};
use crate::services::runtime;
use crate::state::AppState;

const HOTKEYS_CONFIG_KEY: &str = "hotkeys";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProviderKind {
    Portal,
    GlobalShortcut,
    External,
}

impl ProviderKind {
    fn as_u8(self) -> u8 {
        match self {
            Self::Portal => 0,
            Self::GlobalShortcut => 1,
            Self::External => 2,
        }
    }

    fn from_u8(value: u8) -> Self {
        match value {
            0 => Self::Portal,
            1 => Self::GlobalShortcut,
            _ => Self::External,
        }
    }
}

struct ProviderState(AtomicU8);

impl ProviderState {
    fn new(kind: ProviderKind) -> Self {
        Self(AtomicU8::new(kind.as_u8()))
    }

    fn get(&self) -> ProviderKind {
        ProviderKind::from_u8(self.0.load(Ordering::SeqCst))
    }

    fn set(&self, kind: ProviderKind) {
        self.0.store(kind.as_u8(), Ordering::SeqCst);
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct HotkeyBinding {
    mode: StartMode,
    shortcut: String,
}

#[derive(Default)]
pub struct HotkeyRegistry {
    modes: RwLock<HashMap<u32, StartMode>>,
    shortcuts: RwLock<HashMap<StartMode, Shortcut>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyHotkeyRequest {
    pub mode: String,
    pub shortcut: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyHotkeyResult {
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    external_command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

trait HotkeyProvider {
    fn register(self, app: &mut App, bindings: Vec<HotkeyBinding>) -> Result<(), AppError>;
}

struct PortalProvider;
struct GlobalShortcutProvider;
struct ExternalProvider;

pub fn setup(app: &mut App) -> Result<(), AppError> {
    let user_config = app.state::<AppState>().params().user_config;
    let bindings = bindings_from_config(&user_config);

    let kind = provider_kind(env::var("XDG_SESSION_TYPE").ok().as_deref());
    app.manage(ProviderState::new(kind));
    app.manage(HotkeyRegistry::default());

    match kind {
        ProviderKind::Portal => PortalProvider.register(app, bindings),
        ProviderKind::GlobalShortcut => GlobalShortcutProvider.register(app, bindings),
        ProviderKind::External => ExternalProvider.register(app, bindings),
    }
}

pub fn apply(app: &AppHandle, request: ApplyHotkeyRequest) -> Result<ApplyHotkeyResult, AppError> {
    let mode = StartMode::parse(&request.mode)?;
    let shortcut = request
        .shortcut
        .parse::<Shortcut>()
        .map_err(|error| AppError::Message(format!("Invalid hotkey: {error}")))?;

    match app.state::<ProviderState>().get() {
        ProviderKind::GlobalShortcut => apply_global_shortcut(app, mode, shortcut),
        ProviderKind::Portal => Ok(ApplyHotkeyResult {
            status: "confirmation-required",
            external_command: None,
            message: Some(String::from(
                "The desktop portal applies changed shortcuts after Tyco restarts",
            )),
        }),
        ProviderKind::External => Ok(ApplyHotkeyResult {
            status: "external",
            external_command: Some(external_command(mode, &request.shortcut)),
            message: None,
        }),
    }
}

fn apply_global_shortcut(
    app: &AppHandle,
    mode: StartMode,
    shortcut: Shortcut,
) -> Result<ApplyHotkeyResult, AppError> {
    let registry = app.state::<HotkeyRegistry>();
    let previous = registry
        .shortcuts
        .read()
        .expect("hotkey shortcuts lock poisoned")
        .get(&mode)
        .copied();

    if previous == Some(shortcut) {
        return Ok(ApplyHotkeyResult {
            status: "ready",
            external_command: None,
            message: None,
        });
    }
    if let Some(previous) = previous {
        app.global_shortcut()
            .unregister(previous)
            .map_err(|error| AppError::Message(error.to_string()))?;
        registry
            .modes
            .write()
            .expect("hotkey bindings lock poisoned")
            .remove(&previous.id());
    }
    if let Err(error) = app.global_shortcut().register(shortcut) {
        if let Some(previous) = previous {
            let _ = app.global_shortcut().register(previous);
            registry
                .modes
                .write()
                .expect("hotkey bindings lock poisoned")
                .insert(previous.id(), mode);
        }
        return Ok(ApplyHotkeyResult {
            status: "conflict",
            external_command: None,
            message: Some(error.to_string()),
        });
    }

    registry
        .modes
        .write()
        .expect("hotkey bindings lock poisoned")
        .insert(shortcut.id(), mode);
    registry
        .shortcuts
        .write()
        .expect("hotkey shortcuts lock poisoned")
        .insert(mode, shortcut);
    Ok(ApplyHotkeyResult {
        status: "ready",
        external_command: None,
        message: None,
    })
}

fn external_command(mode: StartMode, shortcut: &str) -> String {
    match env::var("XDG_CURRENT_DESKTOP")
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        desktop if desktop.contains("hyprland") => {
            let (modifiers, key) = hyprland_shortcut(shortcut);
            format!(
                "bind = {modifiers}, {key}, exec, tyco-ctl activate {}",
                mode.as_str()
            )
        }
        _ => format!(
            "bindsym {shortcut} exec tyco-ctl activate {}",
            mode.as_str()
        ),
    }
}

fn hyprland_shortcut(shortcut: &str) -> (String, String) {
    let mut parts = shortcut.split('+').collect::<Vec<_>>();
    let key = parts.pop().unwrap_or_default();
    let modifiers = parts
        .into_iter()
        .map(|modifier| match modifier.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => "CTRL",
            "alt" => "ALT",
            "shift" => "SHIFT",
            "super" | "meta" | "cmd" | "command" => "SUPER",
            _ => modifier,
        })
        .collect::<Vec<_>>()
        .join(" ");
    let key = match key.to_ascii_lowercase().as_str() {
        "comma" => "comma".to_owned(),
        _ => key.to_owned(),
    };
    (modifiers, key)
}

fn provider_kind(session_type: Option<&str>) -> ProviderKind {
    match session_type.map(str::to_ascii_lowercase).as_deref() {
        Some("wayland") => ProviderKind::Portal,
        Some("x11") => ProviderKind::GlobalShortcut,
        _ => ProviderKind::External,
    }
}

fn bindings_from_config(config: &Value) -> Vec<HotkeyBinding> {
    let configured = config.get(HOTKEYS_CONFIG_KEY).and_then(Value::as_object);

    StartMode::ALL
        .into_iter()
        .filter_map(|mode| {
            let shortcut = configured
                .and_then(|values| values.get(mode.as_str()))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| default_shortcut(mode));
            (!shortcut.is_empty()).then(|| HotkeyBinding {
                mode,
                shortcut: shortcut.to_owned(),
            })
        })
        .collect()
}

fn default_shortcut(mode: StartMode) -> &'static str {
    match mode {
        StartMode::Editor => "Ctrl+Alt+E",
        StartMode::Write => "Ctrl+Alt+W",
        StartMode::Chat => "Ctrl+Alt+C",
        StartMode::Voice => "Ctrl+Alt+V",
        StartMode::Select => "Ctrl+Alt+S",
        StartMode::AiTasks => "Ctrl+Alt+A",
        StartMode::Correction => "Ctrl+Alt+R",
        StartMode::History => "Ctrl+Alt+H",
        StartMode::Config => "Ctrl+Alt+Comma",
    }
}

impl HotkeyProvider for ExternalProvider {
    fn register(self, _app: &mut App, _bindings: Vec<HotkeyBinding>) -> Result<(), AppError> {
        log::info!("No in-process hotkey provider is available; use tyco-ctl or D-Bus");
        Ok(())
    }
}

impl HotkeyProvider for GlobalShortcutProvider {
    fn register(self, app: &mut App, bindings: Vec<HotkeyBinding>) -> Result<(), AppError> {
        app.handle().plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    let mode = app
                        .state::<HotkeyRegistry>()
                        .modes
                        .read()
                        .expect("hotkey bindings lock poisoned")
                        .get(&shortcut.id())
                        .copied();
                    if let Some(mode) = mode {
                        if let Err(error) =
                            runtime::activate(app, Activation::new(mode, ActivationSource::Hotkey))
                        {
                            log::error!("Hotkey activation failed: {error}");
                        }
                    }
                })
                .build(),
        )?;

        for binding in bindings {
            let shortcut = match binding.shortcut.parse::<Shortcut>() {
                Ok(shortcut) => shortcut,
                Err(error) => {
                    log::warn!("Invalid hotkey for {}: {error}", binding.mode.as_str());
                    continue;
                }
            };
            match app.global_shortcut().register(shortcut) {
                Ok(()) => {
                    let registry = app.state::<HotkeyRegistry>();
                    registry
                        .modes
                        .write()
                        .expect("hotkey bindings lock poisoned")
                        .insert(shortcut.id(), binding.mode);
                    registry
                        .shortcuts
                        .write()
                        .expect("hotkey shortcuts lock poisoned")
                        .insert(binding.mode, shortcut);
                }
                Err(error) => log::warn!(
                    "Could not register hotkey for {}: {error}",
                    binding.mode.as_str()
                ),
            }
        }
        Ok(())
    }
}

impl HotkeyProvider for PortalProvider {
    fn register(self, app: &mut App, bindings: Vec<HotkeyBinding>) -> Result<(), AppError> {
        let app = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = run_portal(app.clone(), bindings).await {
                log::warn!("GlobalShortcuts portal is unavailable: {error}; use tyco-ctl or D-Bus");
                // Wayland compositors without GlobalShortcuts must expose the
                // external binding workflow in settings instead of claiming
                // that a system confirmation is pending.
                app.state::<ProviderState>().set(ProviderKind::External);
            }
        });
        Ok(())
    }
}

async fn run_portal(app: AppHandle, bindings: Vec<HotkeyBinding>) -> Result<(), AppError> {
    let app_id = AppID::try_from(app.config().identifier.as_str())
        .map_err(|error| AppError::Message(error.to_string()))?;
    if let Err(error) = register_host_app(app_id.clone()).await {
        log::warn!("Could not register host app ID {app_id} with the desktop portal: {error}");
    }

    let portal = GlobalShortcuts::new()
        .await
        .map_err(|error| AppError::Message(error.to_string()))?;
    let session = portal
        .create_session(CreateSessionOptions::default())
        .await
        .map_err(|error| AppError::Message(error.to_string()))?;
    let mut activated = portal
        .receive_activated()
        .await
        .map_err(|error| AppError::Message(error.to_string()))?;
    let modes = bindings
        .iter()
        .map(|binding| (binding.mode.as_str().to_owned(), binding.mode))
        .collect::<HashMap<_, _>>();
    let shortcuts = bindings
        .iter()
        .map(|binding| {
            NewShortcut::new(binding.mode.as_str(), description(binding.mode))
                .preferred_trigger(Some(to_portal_trigger(&binding.shortcut).as_str()))
        })
        .collect::<Vec<_>>();
    let request = portal
        .bind_shortcuts(&session, &shortcuts, None, BindShortcutsOptions::default())
        .await
        .map_err(|error| AppError::Message(error.to_string()))?;
    request
        .response()
        .map_err(|error| AppError::Message(error.to_string()))?;

    while let Some(event) = activated.next().await {
        if let Some(mode) = modes.get(event.shortcut_id()).copied() {
            if let Err(error) =
                runtime::activate(&app, Activation::new(mode, ActivationSource::Hotkey))
            {
                log::error!("Portal hotkey activation failed: {error}");
            }
        }
    }
    Ok(())
}

fn description(mode: StartMode) -> &'static str {
    match mode {
        StartMode::Editor => "Open quick editor",
        StartMode::Write => "Open writing mode",
        StartMode::Chat => "Open chat",
        StartMode::Voice => "Start voice input",
        StartMode::Select => "Open selection actions",
        StartMode::AiTasks => "Open AI tasks",
        StartMode::Correction => "Correct selected text",
        StartMode::History => "Open history",
        StartMode::Config => "Open settings",
    }
}

fn to_portal_trigger(shortcut: &str) -> String {
    let mut parts = shortcut.split('+').collect::<Vec<_>>();
    let key = parts.pop().unwrap_or_default();
    let modifiers = parts
        .into_iter()
        .map(|modifier| match modifier.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => "<Ctrl>",
            "alt" => "<Alt>",
            "shift" => "<Shift>",
            "super" | "meta" | "cmd" | "command" => "<Super>",
            _ => "",
        })
        .collect::<String>();
    let key = match key.to_ascii_lowercase().as_str() {
        "comma" => ",".to_owned(),
        value => value.to_owned(),
    };
    format!("{modifiers}{key}")
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn selects_provider_from_runtime_session() {
        assert_eq!(provider_kind(Some("wayland")), ProviderKind::Portal);
        assert_eq!(provider_kind(Some("WAYLAND")), ProviderKind::Portal);
        assert_eq!(provider_kind(Some("x11")), ProviderKind::GlobalShortcut);
        assert_eq!(provider_kind(None), ProviderKind::External);
        assert_eq!(provider_kind(Some("tty")), ProviderKind::External);
    }

    #[test]
    fn reads_overrides_and_ignores_empty_bindings() {
        let bindings = bindings_from_config(&json!({
            "hotkeys": { "editor": "Super+Space", "voice": "  " }
        }));
        assert_eq!(bindings.len(), StartMode::ALL.len());
        assert_eq!(bindings[0].shortcut, "Super+Space");
        assert_eq!(bindings[3].shortcut, default_shortcut(StartMode::Voice));
    }

    #[test]
    fn converts_shortcuts_to_xdg_trigger_syntax() {
        assert_eq!(to_portal_trigger("Ctrl+Alt+E"), "<Ctrl><Alt>e");
        assert_eq!(to_portal_trigger("Super+Shift+Comma"), "<Super><Shift>,");
    }

    #[test]
    fn converts_shortcuts_to_hyprland_syntax() {
        assert_eq!(
            hyprland_shortcut("Ctrl+Alt+E"),
            (String::from("CTRL ALT"), String::from("E"))
        );
        assert_eq!(
            hyprland_shortcut("Super+Shift+Comma"),
            (String::from("SUPER SHIFT"), String::from("comma"))
        );
    }
}
