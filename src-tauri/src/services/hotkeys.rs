use std::collections::HashMap;
use std::env;
use std::sync::atomic::{AtomicU8, Ordering};
#[cfg(target_os = "linux")]
use std::sync::Arc;
use std::sync::RwLock;

#[cfg(target_os = "linux")]
use ashpd::desktop::global_shortcuts::{
    BindShortcutsOptions, ConfigureShortcutsOptions, GlobalShortcuts, NewShortcut,
};
#[cfg(target_os = "linux")]
use ashpd::desktop::CreateSessionOptions;
#[cfg(target_os = "linux")]
use ashpd::desktop::Session;
#[cfg(target_os = "linux")]
use ashpd::{register_host_app, AppID};
#[cfg(target_os = "linux")]
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{App, AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::errors::AppError;
use crate::services::activation::{Activation, ActivationSource, StartMode};
use crate::services::runtime;
use crate::services::selection_replace::{self, HotkeyPress, TriggerWait};
use crate::state::AppState;
use tyco_activation_protocol::is_selection_action;

const HOTKEYS_CONFIG_KEY: &str = "hotkeys";
const SELECTION_HOTKEYS_CONFIG_KEY: &str = "selectionHotkeys";
const SELECTION_TARGET_PREFIX: &str = "replace.";
const CORRECTION_ACTION: &str = "correction";
const DEFAULT_CORRECTION_SHORTCUT: &str = "Ctrl+Alt+F";

/// What a hotkey does: open a mode, or replace the selection in the focused
/// window with the result of an action, see `selection_replace`.
#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub(crate) enum HotkeyTarget {
    Mode(StartMode),
    Selection(String),
}

impl HotkeyTarget {
    /// The id shared with the UI and the portal: the mode name, or the
    /// action prefixed with `replace.`.
    pub(crate) fn parse(id: &str) -> Result<Self, AppError> {
        match id.strip_prefix(SELECTION_TARGET_PREFIX) {
            Some(action) if is_selection_action(action) => Ok(Self::Selection(action.to_owned())),
            Some(action) => Err(AppError::Message(format!(
                "Unknown selection action: {action}"
            ))),
            None => StartMode::parse(id).map(Self::Mode),
        }
    }

    pub(crate) fn id(&self) -> String {
        match self {
            Self::Mode(mode) => mode.as_str().to_owned(),
            Self::Selection(action) => format!("{SELECTION_TARGET_PREFIX}{action}"),
        }
    }

    fn cli_command(&self) -> String {
        match self {
            Self::Mode(mode) => format!("tyco-ctl activate {}", mode.as_str()),
            Self::Selection(action) => format!("tyco-ctl replace {action}"),
        }
    }

    /// Runs the target for a press of the hotkey with the given provider id.
    fn trigger(&self, app: &AppHandle, hotkey_id: &str) -> Result<(), AppError> {
        match self {
            Self::Mode(mode) => {
                runtime::activate(app, Activation::new(*mode, ActivationSource::Hotkey))
            }
            Self::Selection(action) => selection_replace::trigger(
                app,
                action,
                TriggerWait::HotkeyRelease(HotkeyPress::new(hotkey_id)),
            ),
        }
    }
}

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
pub(crate) struct HotkeyBinding {
    target: HotkeyTarget,
    shortcut: String,
    description: String,
}

#[derive(Default)]
pub struct HotkeyRegistry {
    targets: RwLock<HashMap<u32, HotkeyTarget>>,
    shortcuts: RwLock<HashMap<HotkeyTarget, Shortcut>>,
}

#[cfg(target_os = "linux")]
struct PortalRegistration {
    portal: GlobalShortcuts,
    session: Session<GlobalShortcuts>,
}

#[cfg(target_os = "linux")]
#[derive(Default)]
struct PortalState(RwLock<Option<Arc<PortalRegistration>>>);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyHotkeyRequest {
    pub mode: String,
    pub shortcut: String,
}

/// Mirrors `HotkeyApplyStatus` in `@tyco/shared`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum HotkeyApplyStatus {
    Ready,
    Conflict,
    ConfirmationRequired,
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
}

pub(crate) trait HotkeyProvider {
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
    #[cfg(target_os = "linux")]
    app.manage(PortalState::default());

    match kind {
        ProviderKind::Portal => PortalProvider.register(app, bindings),
        ProviderKind::GlobalShortcut => GlobalShortcutProvider.register(app, bindings),
        ProviderKind::External => ExternalProvider.register(app, bindings),
    }
}

pub async fn configure(app: &AppHandle) -> Result<(), AppError> {
    if app.state::<ProviderState>().get() != ProviderKind::Portal {
        return Err(AppError::Message(String::from(
            "System hotkey configuration is unavailable",
        )));
    }

    #[cfg(not(target_os = "linux"))]
    return Err(AppError::Message(String::from(
        "System hotkey configuration is unavailable",
    )));

    #[cfg(target_os = "linux")]
    let registration = app
        .state::<PortalState>()
        .0
        .read()
        .expect("portal registration lock poisoned")
        .clone()
        .ok_or_else(|| AppError::Message(String::from("Hotkey portal is not ready")))?;

    #[cfg(target_os = "linux")]
    return registration
        .portal
        .configure_shortcuts(
            &registration.session,
            None,
            ConfigureShortcutsOptions::default(),
        )
        .await
        .map_err(|error| AppError::Message(error.to_string()));
}

pub fn provider_info(app: &AppHandle) -> HotkeyProviderInfo {
    let kind = app.state::<ProviderState>().get();
    let config = app.state::<AppState>().params().user_config;
    let actions = bindings_from_config(&config)
        .into_iter()
        .map(|binding| {
            let result = match kind {
                ProviderKind::Portal => ApplyHotkeyResult {
                    status: HotkeyApplyStatus::ConfirmationRequired,
                    external_command: None,
                    message: None,
                },
                ProviderKind::GlobalShortcut => ApplyHotkeyResult {
                    status: HotkeyApplyStatus::Ready,
                    external_command: None,
                    message: None,
                },
                ProviderKind::External => ApplyHotkeyResult {
                    status: HotkeyApplyStatus::External,
                    external_command: Some(external_command(&binding.target, &binding.shortcut)),
                    message: None,
                },
            };
            (binding.target.id(), result)
        })
        .collect();
    HotkeyProviderInfo {
        provider: match kind {
            ProviderKind::Portal => "portal",
            ProviderKind::GlobalShortcut => "global-shortcut",
            ProviderKind::External => "external",
        },
        can_configure: kind == ProviderKind::Portal,
        actions,
    }
}

pub fn apply(app: &AppHandle, request: ApplyHotkeyRequest) -> Result<ApplyHotkeyResult, AppError> {
    let target = HotkeyTarget::parse(&request.mode)?;
    let shortcut = request
        .shortcut
        .parse::<Shortcut>()
        .map_err(|error| AppError::Message(format!("Invalid hotkey: {error}")))?;

    match app.state::<ProviderState>().get() {
        ProviderKind::GlobalShortcut => apply_global_shortcut(app, target, shortcut),
        ProviderKind::Portal => Ok(ApplyHotkeyResult {
            status: HotkeyApplyStatus::ConfirmationRequired,
            external_command: None,
            message: Some(String::from(
                "The desktop portal applies changed shortcuts after Tyco restarts",
            )),
        }),
        ProviderKind::External => Ok(ApplyHotkeyResult {
            status: HotkeyApplyStatus::External,
            external_command: Some(external_command(&target, &request.shortcut)),
            message: None,
        }),
    }
}

fn apply_global_shortcut(
    app: &AppHandle,
    target: HotkeyTarget,
    shortcut: Shortcut,
) -> Result<ApplyHotkeyResult, AppError> {
    let registry = app.state::<HotkeyRegistry>();
    let previous = registry
        .shortcuts
        .read()
        .expect("hotkey shortcuts lock poisoned")
        .get(&target)
        .copied();

    if previous == Some(shortcut) {
        return Ok(ApplyHotkeyResult {
            status: HotkeyApplyStatus::Ready,
            external_command: None,
            message: None,
        });
    }
    if let Some(previous) = previous {
        app.global_shortcut()
            .unregister(previous)
            .map_err(|error| AppError::Message(error.to_string()))?;
        registry
            .targets
            .write()
            .expect("hotkey bindings lock poisoned")
            .remove(&previous.id());
    }
    if let Err(error) = app.global_shortcut().register(shortcut) {
        if let Some(previous) = previous {
            match app.global_shortcut().register(previous) {
                Ok(()) => {
                    registry
                        .targets
                        .write()
                        .expect("hotkey bindings lock poisoned")
                        .insert(previous.id(), target.clone());
                }
                Err(restore_error) => {
                    // the target has no shortcut at all now; the registry
                    // must not claim the old one is still bound
                    log::error!("Could not restore the previous shortcut: {restore_error}");
                    registry
                        .shortcuts
                        .write()
                        .expect("hotkey shortcuts lock poisoned")
                        .remove(&target);
                }
            }
        }
        return Ok(ApplyHotkeyResult {
            status: HotkeyApplyStatus::Conflict,
            external_command: None,
            message: Some(error.to_string()),
        });
    }

    registry
        .targets
        .write()
        .expect("hotkey bindings lock poisoned")
        .insert(shortcut.id(), target.clone());
    registry
        .shortcuts
        .write()
        .expect("hotkey shortcuts lock poisoned")
        .insert(target, shortcut);
    Ok(ApplyHotkeyResult {
        status: HotkeyApplyStatus::Ready,
        external_command: None,
        message: None,
    })
}

fn external_command(target: &HotkeyTarget, shortcut: &str) -> String {
    match env::var("XDG_CURRENT_DESKTOP")
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        desktop if desktop.contains("hyprland") => {
            let (modifiers, key) = hyprland_shortcut(shortcut);
            format!("bind = {modifiers}, {key}, exec, {}", target.cli_command())
        }
        desktop if desktop.contains("sway") || desktop.contains("i3") => format!(
            "bindsym {} exec {}",
            sway_shortcut(shortcut),
            target.cli_command()
        ),
        _ => target.cli_command(),
    }
}

fn sway_shortcut(shortcut: &str) -> String {
    shortcut
        .split('+')
        .map(|part| match part.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => String::from("Control"),
            "alt" => String::from("Mod1"),
            "super" | "meta" | "cmd" | "command" => String::from("Mod4"),
            "shift" => String::from("Shift"),
            "comma" => String::from("comma"),
            _ => part.to_ascii_lowercase(),
        })
        .collect::<Vec<_>>()
        .join("+")
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
    if !cfg!(target_os = "linux") {
        return ProviderKind::GlobalShortcut;
    }
    match session_type.map(str::to_ascii_lowercase).as_deref() {
        Some("wayland") => ProviderKind::Portal,
        Some("x11") => ProviderKind::GlobalShortcut,
        _ => ProviderKind::External,
    }
}

pub(crate) const GLOBAL_HOTKEY_MODES: [StartMode; 8] = [
    StartMode::Editor,
    StartMode::Write,
    StartMode::Chat,
    StartMode::VoiceChat,
    StartMode::Voice,
    StartMode::Select,
    StartMode::AiTasks,
    StartMode::Correction,
];

fn bindings_from_config(config: &Value) -> Vec<HotkeyBinding> {
    let configured = config.get(HOTKEYS_CONFIG_KEY).and_then(Value::as_object);

    let modes = GLOBAL_HOTKEY_MODES.into_iter().filter_map(|mode| {
        let shortcut = configured
            .and_then(|values| values.get(mode.as_str()))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| default_shortcut(mode));
        (!shortcut.is_empty()).then(|| HotkeyBinding {
            target: HotkeyTarget::Mode(mode),
            shortcut: shortcut.to_owned(),
            description: mode_description(mode).to_owned(),
        })
    });
    modes.chain(selection_bindings(config)).collect()
}

/// Selection actions are bound only when they have a shortcut: correction by
/// default, the rest once the user assigns one. An empty string unbinds.
fn selection_bindings(config: &Value) -> Vec<HotkeyBinding> {
    let configured = config
        .get(SELECTION_HOTKEYS_CONFIG_KEY)
        .and_then(Value::as_object);
    let mut actions = configured
        .into_iter()
        .flatten()
        .filter(|(action, _)| action.as_str() != CORRECTION_ACTION && is_selection_action(action))
        .filter_map(|(action, shortcut)| {
            Some((action.clone(), shortcut.as_str()?.trim().to_owned()))
        })
        .collect::<Vec<_>>();
    actions.sort();
    let correction = configured
        .and_then(|values| values.get(CORRECTION_ACTION))
        .and_then(Value::as_str)
        .unwrap_or(DEFAULT_CORRECTION_SHORTCUT)
        .trim()
        .to_owned();
    std::iter::once((CORRECTION_ACTION.to_owned(), correction))
        .chain(actions)
        .filter(|(_, shortcut)| !shortcut.is_empty())
        .map(|(action, shortcut)| HotkeyBinding {
            description: selection_description(config, &action),
            target: HotkeyTarget::Selection(action),
            shortcut,
        })
        .collect()
}

/// Names the language or the AI task in the slot the action points to, so
/// that system settings show something recognizable.
fn selection_description(config: &Value, action: &str) -> String {
    let slot = |key: &str| {
        action
            .split_once('.')
            .and_then(|(_, slot)| slot.parse::<usize>().ok())
            .and_then(|slot| config.get(key)?.get(slot).cloned())
    };
    match action.split_once('.').map(|(kind, _)| kind) {
        None => String::from("Correct selected text in place"),
        Some("translate") => match slot("toTranslateLanguages")
            .as_ref()
            .and_then(Value::as_str)
        {
            Some(language) => format!("Translate selected text to {language}"),
            None => String::from("Translate selected text"),
        },
        _ => match slot("aiTasks")
            .as_ref()
            .and_then(|task| task.get("name"))
            .and_then(Value::as_str)
        {
            Some(name) => format!("Apply AI task \"{name}\" to selected text"),
            None => String::from("Apply an AI task to selected text"),
        },
    }
}

fn default_shortcut(mode: StartMode) -> &'static str {
    match mode {
        StartMode::Editor => "Ctrl+Alt+E",
        StartMode::Write => "Ctrl+Alt+W",
        StartMode::Chat => "Ctrl+Alt+C",
        StartMode::VoiceChat => "Ctrl+Alt+Q",
        StartMode::Voice => "Ctrl+Alt+V",
        StartMode::Select => "Ctrl+Alt+S",
        StartMode::AiTasks => "Ctrl+Alt+A",
        StartMode::Correction => "Ctrl+Alt+R",
        StartMode::History | StartMode::Config => "",
    }
}

impl HotkeyProvider for ExternalProvider {
    fn register(self, _app: &mut App, _bindings: Vec<HotkeyBinding>) -> Result<(), AppError> {
        log::info!("No in-process hotkey provider is available; use tyco-ctl or D-Bus");
        Ok(())
    }
}

#[cfg(not(target_os = "linux"))]
impl HotkeyProvider for PortalProvider {
    fn register(self, _app: &mut App, _bindings: Vec<HotkeyBinding>) -> Result<(), AppError> {
        Err(AppError::Message(String::from(
            "The global shortcuts portal is only available on Linux",
        )))
    }
}

impl HotkeyProvider for GlobalShortcutProvider {
    fn register(self, app: &mut App, bindings: Vec<HotkeyBinding>) -> Result<(), AppError> {
        app.handle().plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    let hotkey_id = shortcut.id().to_string();
                    if event.state == ShortcutState::Released {
                        selection_replace::hotkey_released(&hotkey_id);
                        return;
                    }
                    let target = app
                        .state::<HotkeyRegistry>()
                        .targets
                        .read()
                        .expect("hotkey bindings lock poisoned")
                        .get(&shortcut.id())
                        .cloned();
                    if let Some(target) = target {
                        if let Err(error) = target.trigger(app, &hotkey_id) {
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
                    log::warn!("Invalid hotkey for {}: {error}", binding.target.id());
                    continue;
                }
            };
            match app.global_shortcut().register(shortcut) {
                Ok(()) => {
                    let registry = app.state::<HotkeyRegistry>();
                    registry
                        .targets
                        .write()
                        .expect("hotkey bindings lock poisoned")
                        .insert(shortcut.id(), binding.target.clone());
                    registry
                        .shortcuts
                        .write()
                        .expect("hotkey shortcuts lock poisoned")
                        .insert(binding.target, shortcut);
                }
                Err(error) => log::warn!(
                    "Could not register hotkey for {}: {error}",
                    binding.target.id()
                ),
            }
        }
        Ok(())
    }
}

#[cfg(target_os = "linux")]
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

#[cfg(target_os = "linux")]
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
    let mut deactivated = portal
        .receive_deactivated()
        .await
        .map_err(|error| AppError::Message(error.to_string()))?;
    let targets = bindings
        .iter()
        .map(|binding| (binding.target.id(), binding.target.clone()))
        .collect::<HashMap<_, _>>();
    let shortcuts = bindings
        .iter()
        .map(|binding| {
            NewShortcut::new(binding.target.id(), binding.description.as_str())
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

    app.state::<PortalState>()
        .0
        .write()
        .expect("portal registration lock poisoned")
        .replace(Arc::new(PortalRegistration { portal, session }));

    // selection actions press keys of their own, and wait for the hotkey
    // to be released first
    tauri::async_runtime::spawn(async move {
        while let Some(event) = deactivated.next().await {
            selection_replace::hotkey_released(event.shortcut_id());
        }
    });
    while let Some(event) = activated.next().await {
        if let Some(target) = targets.get(event.shortcut_id()) {
            if let Err(error) = target.trigger(&app, event.shortcut_id()) {
                log::error!("Portal hotkey activation failed: {error}");
            }
        }
    }
    Ok(())
}

fn mode_description(mode: StartMode) -> &'static str {
    match mode {
        StartMode::Editor => "Open quick editor",
        StartMode::Write => "Open writing mode",
        StartMode::Chat => "Open chat",
        StartMode::VoiceChat => "Ask the chat by voice",
        StartMode::Voice => "Start voice input",
        StartMode::Select => "Open selection actions",
        StartMode::AiTasks => "Open AI tasks",
        StartMode::Correction => "Correct selected text with review",
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
            "ctrl" | "control" => "CTRL+",
            "alt" => "ALT+",
            "shift" => "SHIFT+",
            "super" | "meta" | "cmd" | "command" => "LOGO+",
            _ => "",
        })
        .collect::<String>();
    let key = match key.to_ascii_lowercase().as_str() {
        "comma" => "comma".to_owned(),
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
        assert_eq!(bindings.len(), GLOBAL_HOTKEY_MODES.len() + 1);
        assert_eq!(bindings[0].shortcut, "Super+Space");
        assert_eq!(bindings[4].shortcut, default_shortcut(StartMode::Voice));
    }

    #[test]
    fn binds_selection_actions_that_have_a_shortcut() {
        let selection = |config: Value| {
            selection_bindings(&config)
                .into_iter()
                .map(|binding| (binding.target.id(), binding.shortcut))
                .collect::<Vec<_>>()
        };
        assert_eq!(
            selection(json!({})),
            [(
                String::from("replace.correction"),
                String::from("Ctrl+Alt+F")
            )]
        );
        assert_eq!(
            selection(json!({ "selectionHotkeys": {
                "correction": "",
                "translate.0": "Ctrl+Alt+1",
                "aiTask.0": " ",
                "bogus": "Ctrl+Alt+2"
            } })),
            [(
                String::from("replace.translate.0"),
                String::from("Ctrl+Alt+1")
            )]
        );
    }

    #[test]
    fn describes_selection_actions_by_their_slot() {
        let config = json!({
            "toTranslateLanguages": ["en_US", null],
            "aiTasks": [{ "name": "deepEdit", "rule": "" }]
        });
        assert_eq!(
            selection_description(&config, "translate.0"),
            "Translate selected text to en_US"
        );
        assert_eq!(
            selection_description(&config, "translate.1"),
            "Translate selected text"
        );
        assert_eq!(
            selection_description(&config, "aiTask.0"),
            "Apply AI task \"deepEdit\" to selected text"
        );
        assert_eq!(
            selection_description(&config, "correction"),
            "Correct selected text in place"
        );
    }

    #[test]
    fn parses_hotkey_targets() {
        assert_eq!(
            HotkeyTarget::parse("editor").unwrap(),
            HotkeyTarget::Mode(StartMode::Editor)
        );
        let target = HotkeyTarget::parse("replace.aiTask.2").unwrap();
        assert_eq!(target, HotkeyTarget::Selection(String::from("aiTask.2")));
        assert_eq!(target.id(), "replace.aiTask.2");
        assert_eq!(target.cli_command(), "tyco-ctl replace aiTask.2");
        assert!(HotkeyTarget::parse("replace.bogus").is_err());
        assert!(HotkeyTarget::parse("bogus").is_err());
    }

    #[test]
    fn converts_shortcuts_to_xdg_trigger_syntax() {
        assert_eq!(to_portal_trigger("Ctrl+Alt+E"), "CTRL+ALT+e");
        assert_eq!(to_portal_trigger("Super+Shift+Comma"), "LOGO+SHIFT+comma");
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

    #[test]
    fn converts_shortcuts_to_sway_syntax() {
        assert_eq!(sway_shortcut("Ctrl+Alt+E"), "Control+Mod1+e");
        assert_eq!(sway_shortcut("Super+Shift+Comma"), "Mod4+Shift+comma");
    }
}
