use std::collections::HashMap;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::RwLock;
#[cfg(target_os = "linux")]
use std::sync::{Arc, OnceLock};

#[cfg(target_os = "linux")]
use ashpd::desktop::global_shortcuts::{
    BindShortcutsOptions, ConfigureShortcutsOptions, GlobalShortcuts, ListShortcutsOptions,
    NewShortcut,
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
use serde_json::{Map, Value};
#[cfg(target_os = "linux")]
use tauri::Emitter;
use tauri::{App, AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::errors::AppError;
use crate::services::activation::{Activation, ActivationSource, StartMode};
use crate::services::platform::session::{self, Desktop, DisplayServer};
use crate::services::runtime;
use crate::services::selection_replace::{self, HotkeyPress, TriggerWait};
use crate::state::AppState;
use tyco_activation_protocol::is_selection_action;

/// Emitted when the desktop reports changed portal shortcuts.
pub const HOTKEYS_CHANGED_EVENT: &str = "app://hotkeys-changed";

const HOTKEYS_CONFIG_KEY: &str = "hotkeys";
const SELECTION_HOTKEYS_CONFIG_KEY: &str = "selectionHotkeys";
const SELECTION_TARGET_PREFIX: &str = "replace.";
const CORRECTION_ACTION: &str = "correction";
const DEFAULT_CORRECTION_KEY: &str = "F";
/// The modifiers of every default shortcut. Ctrl+Alt is AltGr on Windows,
/// which types characters on many layouts (Ctrl+Alt+E is € in German), so
/// Shift joins it there.
const DEFAULT_MODIFIERS: &str = if cfg!(target_os = "windows") {
    "Ctrl+Shift+Alt"
} else {
    "Ctrl+Alt"
};
const CORRECTION_DESCRIPTION: &str = "Correct selected text in place";

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

/// The portal and Tyco's session with it. Its signals are not tied to a
/// session, so binding again only replaces the session.
#[cfg(target_os = "linux")]
#[derive(Default)]
struct PortalState {
    portal: OnceLock<Arc<GlobalShortcuts>>,
    session: RwLock<Option<Arc<Session<GlobalShortcuts>>>>,
    /// Binding again closes the session that listing and binding use
    binding: tokio::sync::Mutex<()>,
}

#[cfg(target_os = "linux")]
impl PortalState {
    fn registration(&self) -> Option<(Arc<GlobalShortcuts>, Arc<Session<GlobalShortcuts>>)> {
        let portal = self.portal.get()?.clone();
        let session = self
            .session
            .read()
            .expect("portal session lock poisoned")
            .clone()?;
        Some((portal, session))
    }
}

/// The shortcuts the desktop actually bound through the portal, described in
/// its own words and keyed by hotkey id. The user may change them in the
/// desktop settings at any time, so Tyco's configuration does not know them.
#[derive(Default)]
struct SystemTriggers(RwLock<HashMap<String, String>>);

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

pub(crate) trait HotkeyProvider {
    fn register(self, app: &mut App, bindings: Vec<HotkeyBinding>) -> Result<(), AppError>;
}

struct PortalProvider;
struct GlobalShortcutProvider;
struct ExternalProvider;

pub fn setup(app: &mut App) -> Result<(), AppError> {
    let user_config = app.state::<AppState>().params().user_config;
    let bindings = bindings_from_config(&user_config);

    let kind = provider_kind(session::current());
    app.manage(ProviderState::new(kind));
    app.manage(HotkeyRegistry::default());
    app.manage(SystemTriggers::default());
    #[cfg(target_os = "linux")]
    app.manage(PortalState::default());

    match kind {
        ProviderKind::Portal => PortalProvider.register(app, bindings),
        ProviderKind::GlobalShortcut => GlobalShortcutProvider.register(app, bindings),
        ProviderKind::External => ExternalProvider.register(app, bindings),
    }
}

/// Lets the user change the portal shortcuts: in the portal's own dialog, or
/// in the desktop settings where the portal has no dialog (version 1).
pub async fn configure(app: &AppHandle) -> Result<(), AppError> {
    if app.state::<ProviderState>().get() != ProviderKind::Portal {
        return Err(AppError::Message(String::from(
            "System hotkey configuration is unavailable",
        )));
    }

    #[cfg(target_os = "linux")]
    if let Err(error) = configure_portal(app).await {
        log::info!("Portal shortcut dialog is unavailable: {error}; opening the desktop settings");
        return super::platform::open_shortcut_settings();
    }
    #[cfg(not(target_os = "linux"))]
    let _ = app;
    Ok(())
}

#[cfg(target_os = "linux")]
async fn configure_portal(app: &AppHandle) -> Result<(), AppError> {
    let (portal, session) = app
        .state::<PortalState>()
        .registration()
        .ok_or_else(|| AppError::Message(String::from("Hotkey portal is not ready")))?;
    portal
        .configure_shortcuts(&session, None, ConfigureShortcutsOptions::default())
        .await
        .map_err(|error| AppError::Message(error.to_string()))
}

/// Binds the hotkeys again in a new portal session. The desktop keeps the
/// shortcuts the user chose, and brings back with their defaults the ones
/// removed in its settings, which it does not do within a session.
pub async fn rebind(app: &AppHandle) -> Result<(), AppError> {
    if app.state::<ProviderState>().get() != ProviderKind::Portal {
        return Err(AppError::Message(String::from(
            "Only desktop portal hotkeys are bound again",
        )));
    }
    #[cfg(target_os = "linux")]
    return rebind_portal(app).await;
    #[cfg(not(target_os = "linux"))]
    Ok(())
}

#[cfg(target_os = "linux")]
async fn rebind_portal(app: &AppHandle) -> Result<(), AppError> {
    let state = app.state::<PortalState>();
    let _binding = state.binding.lock().await;
    let portal = state
        .portal
        .get()
        .cloned()
        .ok_or_else(|| AppError::Message(String::from("Hotkey portal is not ready")))?;
    let previous = state
        .session
        .write()
        .expect("portal session lock poisoned")
        .take();
    // the shortcuts belong to the app, not to the session: the old session
    // goes first, so that the new one binds the same ids
    if let Some(previous) = previous {
        if let Err(error) = previous.close().await {
            log::warn!("Could not close the hotkey portal session: {error}");
        }
    }
    let bindings = bindings_from_config(&app.state::<AppState>().params().user_config);
    let result = bind_session(app, &portal, &bindings).await;
    if result.is_err() {
        app.state::<SystemTriggers>()
            .0
            .write()
            .expect("system triggers lock poisoned")
            .clear();
    }
    notify_hotkeys_changed(app);
    result
}

/// Asks the desktop for the shortcuts it binds now: the user may have
/// removed them in its settings, which the portal does not report.
#[cfg(target_os = "linux")]
async fn refresh_system_triggers(app: &AppHandle) {
    let state = app.state::<PortalState>();
    let _binding = state.binding.lock().await;
    let Some((portal, session)) = state.registration() else {
        return;
    };
    let listed = match portal
        .list_shortcuts(&session, ListShortcutsOptions::default())
        .await
    {
        Ok(request) => request.response(),
        Err(error) => Err(error),
    };
    match listed {
        Ok(listed) => store_system_triggers(app, listed.shortcuts()),
        Err(error) => log::warn!("Could not list the portal hotkeys: {error}"),
    }
}

/// Takes the global shortcuts away while the settings record a new one, so
/// that pressing a bound shortcut reaches the settings instead of running it.
/// Only Tyco's own registrations can be suspended: the desktop keeps portal
/// shortcuts and compositor bindings.
pub fn set_suspended(app: &AppHandle, suspended: bool) -> Result<(), AppError> {
    if app.state::<ProviderState>().get() != ProviderKind::GlobalShortcut {
        return Ok(());
    }
    let shortcuts = app
        .state::<HotkeyRegistry>()
        .shortcuts
        .read()
        .expect("hotkey shortcuts lock poisoned")
        .values()
        .copied()
        .collect::<Vec<_>>();
    let global_shortcut = app.global_shortcut();
    for shortcut in shortcuts {
        let registered = global_shortcut.is_registered(shortcut);
        let result = if suspended && registered {
            global_shortcut.unregister(shortcut)
        } else if !suspended && !registered {
            global_shortcut.register(shortcut)
        } else {
            Ok(())
        };
        if let Err(error) = result {
            log::warn!(
                "Could not {} a hotkey: {error}",
                if suspended { "suspend" } else { "resume" }
            );
        }
    }
    Ok(())
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
                    external_command: Some(external_command(&binding.target, &binding.shortcut)),
                    message: None,
                };
                (binding.target.id(), result)
            })
            .collect(),
        ProviderKind::Portal | ProviderKind::GlobalShortcut => HashMap::new(),
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
            .map(|binding| (binding.target.id(), binding.shortcut))
            .collect(),
        platform: platform_name(),
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
        // the desktop keeps the shortcut the user chose and ignores a new
        // preferred one, so only its settings change it
        ProviderKind::Portal => Err(AppError::Message(String::from(
            "Hotkeys are managed by the desktop; change them in its settings",
        ))),
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
        // a shortcut suspended while the settings record is not registered
        if app.global_shortcut().is_registered(previous) {
            app.global_shortcut()
                .unregister(previous)
                .map_err(|error| AppError::Message(error.to_string()))?;
        }
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
    match session::current().desktop {
        Desktop::Hyprland => {
            let (modifiers, key) = hyprland_shortcut(shortcut);
            format!("bind = {modifiers}, {key}, exec, {}", target.cli_command())
        }
        Desktop::Sway => format!(
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

/// wlroots compositors are configured in their own files: Sway has no
/// GlobalShortcuts portal, and Hyprland's ignores the preferred triggers and
/// needs a binding in `hyprland.conf` anyway, so both get the binding to copy.
fn provider_kind(session: session::Session) -> ProviderKind {
    match (session.display, session.desktop) {
        (DisplayServer::Wayland, Desktop::Hyprland | Desktop::Sway) => ProviderKind::External,
        (DisplayServer::Wayland, _) => ProviderKind::Portal,
        (DisplayServer::X11 | DisplayServer::Native, _) => ProviderKind::GlobalShortcut,
        (DisplayServer::Unknown, _) => ProviderKind::External,
    }
}

fn platform_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

/// The portal shortcuts can be changed in the portal's own dialog (version
/// 2) or in the settings of a desktop Tyco knows.
#[cfg(target_os = "linux")]
fn can_configure_portal(app: &AppHandle) -> bool {
    let has_dialog = app
        .state::<PortalState>()
        .portal
        .get()
        .is_some_and(|portal| portal.version() >= 2);
    has_dialog || super::platform::has_shortcut_settings()
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

pub(crate) const GLOBAL_HOTKEY_MODES: [StartMode; 7] = [
    StartMode::Editor,
    StartMode::Write,
    StartMode::Chat,
    StartMode::VoiceChat,
    StartMode::Voice,
    StartMode::Select,
    StartMode::AiTasks,
];

fn bindings_from_config(config: &Value) -> Vec<HotkeyBinding> {
    let configured = config.get(HOTKEYS_CONFIG_KEY).and_then(Value::as_object);

    let modes = GLOBAL_HOTKEY_MODES.into_iter().filter_map(|mode| {
        let shortcut = configured
            .and_then(|values| values.get(mode.as_str()))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .or_else(|| default_shortcut(mode))?;
        Some(HotkeyBinding {
            target: HotkeyTarget::Mode(mode),
            shortcut,
            description: mode_description(mode).to_owned(),
        })
    });
    modes.chain(selection_bindings(config)).collect()
}

/// Only the correction replaces the selection from a hotkey; an empty
/// string unbinds it.
fn selection_bindings(config: &Value) -> Vec<HotkeyBinding> {
    let shortcut = config
        .get(SELECTION_HOTKEYS_CONFIG_KEY)
        .and_then(|values| values.get(CORRECTION_ACTION))
        .and_then(Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(default_correction_shortcut);
    let shortcut = shortcut.trim();
    (!shortcut.is_empty())
        .then(|| HotkeyBinding {
            target: HotkeyTarget::Selection(CORRECTION_ACTION.to_owned()),
            shortcut: shortcut.to_owned(),
            description: CORRECTION_DESCRIPTION.to_owned(),
        })
        .into_iter()
        .collect()
}

/// The target of a global hotkey id; other targets have no global hotkey.
fn global_target(id: &str) -> Option<HotkeyTarget> {
    let target = HotkeyTarget::parse(id).ok()?;
    let global = match &target {
        HotkeyTarget::Mode(mode) => GLOBAL_HOTKEY_MODES.contains(mode),
        HotkeyTarget::Selection(action) => action == CORRECTION_ACTION,
    };
    global.then_some(target)
}

fn default_key(mode: StartMode) -> Option<&'static str> {
    match mode {
        StartMode::Editor => Some("E"),
        StartMode::Write => Some("W"),
        StartMode::Chat => Some("C"),
        StartMode::VoiceChat => Some("Q"),
        StartMode::Voice => Some("V"),
        StartMode::Select => Some("S"),
        StartMode::AiTasks => Some("A"),
        StartMode::Correction | StartMode::History | StartMode::Config => None,
    }
}

fn default_shortcut(mode: StartMode) -> Option<String> {
    default_key(mode).map(|key| format!("{DEFAULT_MODIFIERS}+{key}"))
}

fn default_correction_shortcut() -> String {
    format!("{DEFAULT_MODIFIERS}+{DEFAULT_CORRECTION_KEY}")
}

fn default_bindings() -> Vec<HotkeyBinding> {
    bindings_from_config(&Value::Null)
}

/// The `hotkeys` of the default user config on this platform.
pub fn default_hotkeys_config() -> Value {
    let hotkeys = GLOBAL_HOTKEY_MODES
        .into_iter()
        .filter_map(|mode| {
            Some((
                mode.as_str().to_owned(),
                Value::String(default_shortcut(mode)?),
            ))
        })
        .collect::<Map<_, _>>();
    Value::Object(hotkeys)
}

/// The `selectionHotkeys` of the default user config on this platform.
pub fn default_selection_hotkeys_config() -> Value {
    let mut hotkeys = Map::new();
    hotkeys.insert(
        CORRECTION_ACTION.to_owned(),
        Value::String(default_correction_shortcut()),
    );
    Value::Object(hotkeys)
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
                notify_hotkeys_changed(&app);
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
    let mut activated = portal
        .receive_activated()
        .await
        .map_err(|error| AppError::Message(error.to_string()))?;
    let mut deactivated = portal
        .receive_deactivated()
        .await
        .map_err(|error| AppError::Message(error.to_string()))?;
    let mut changed = portal
        .receive_shortcuts_changed()
        .await
        .map_err(|error| AppError::Message(error.to_string()))?;
    let portal = Arc::new(portal);
    {
        let state = app.state::<PortalState>();
        let _binding = state.binding.lock().await;
        bind_session(&app, &portal, &bindings).await?;
        let _ = state.portal.set(portal);
    }
    // the settings may already show the shortcuts the desktop had not bound
    notify_hotkeys_changed(&app);

    // selection actions press keys of their own, and wait for the hotkey
    // to be released first
    tauri::async_runtime::spawn(async move {
        while let Some(event) = deactivated.next().await {
            selection_replace::hotkey_released(event.shortcut_id());
        }
    });
    let changed_app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = changed.next().await {
            store_system_triggers(&changed_app, event.shortcuts());
            notify_hotkeys_changed(&changed_app);
        }
    });
    while let Some(event) = activated.next().await {
        // the desktop may still keep hotkeys of older versions
        let Some(target) = global_target(event.shortcut_id()) else {
            log::warn!("Unknown portal hotkey: {}", event.shortcut_id());
            continue;
        };
        if let Err(error) = target.trigger(&app, event.shortcut_id()) {
            log::error!("Portal hotkey activation failed: {error}");
        }
    }
    Ok(())
}

/// Opens a session, binds the hotkeys in it and keeps it. The caller holds
/// `PortalState::binding`.
#[cfg(target_os = "linux")]
async fn bind_session(
    app: &AppHandle,
    portal: &GlobalShortcuts,
    bindings: &[HotkeyBinding],
) -> Result<(), AppError> {
    let session = portal
        .create_session(CreateSessionOptions::default())
        .await
        .map_err(|error| AppError::Message(error.to_string()))?;
    let shortcuts = bindings
        .iter()
        .map(|binding| {
            NewShortcut::new(binding.target.id(), binding.description.as_str())
                .preferred_trigger(Some(to_portal_trigger(&binding.shortcut).as_str()))
        })
        .collect::<Vec<_>>();
    let bound = portal
        .bind_shortcuts(&session, &shortcuts, None, BindShortcutsOptions::default())
        .await
        .and_then(|request| request.response())
        .map_err(|error| AppError::Message(error.to_string()))?;
    store_system_triggers(app, bound.shortcuts());
    app.state::<PortalState>()
        .session
        .write()
        .expect("portal session lock poisoned")
        .replace(Arc::new(session));
    Ok(())
}

#[cfg(target_os = "linux")]
fn notify_hotkeys_changed(app: &AppHandle) {
    if let Err(error) = app.emit(HOTKEYS_CHANGED_EVENT, ()) {
        log::warn!("Could not report changed hotkeys: {error}");
    }
}

#[cfg(target_os = "linux")]
fn store_system_triggers(
    app: &AppHandle,
    shortcuts: &[ashpd::desktop::global_shortcuts::Shortcut],
) {
    let state = app.state::<SystemTriggers>();
    let mut triggers = state.0.write().expect("system triggers lock poisoned");
    triggers.clear();
    triggers.extend(shortcuts.iter().map(|shortcut| {
        (
            shortcut.id().to_owned(),
            shortcut.trigger_description().to_owned(),
        )
    }));
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
        let kind = |display, desktop| provider_kind(session::Session { display, desktop });
        assert_eq!(
            kind(DisplayServer::Wayland, Desktop::Kde),
            ProviderKind::Portal
        );
        assert_eq!(
            kind(DisplayServer::Wayland, Desktop::Gnome),
            ProviderKind::Portal
        );
        assert_eq!(
            kind(DisplayServer::Wayland, Desktop::Other),
            ProviderKind::Portal
        );
        assert_eq!(
            kind(DisplayServer::Wayland, Desktop::Hyprland),
            ProviderKind::External
        );
        assert_eq!(
            kind(DisplayServer::Wayland, Desktop::Sway),
            ProviderKind::External
        );
        assert_eq!(
            kind(DisplayServer::X11, Desktop::Hyprland),
            ProviderKind::GlobalShortcut
        );
        assert_eq!(
            kind(DisplayServer::Native, Desktop::Other),
            ProviderKind::GlobalShortcut
        );
        assert_eq!(
            kind(DisplayServer::Unknown, Desktop::Other),
            ProviderKind::External
        );
    }

    #[test]
    fn default_shortcuts_avoid_altgr_on_windows() {
        let expected = if cfg!(target_os = "windows") {
            "Ctrl+Shift+Alt+E"
        } else {
            "Ctrl+Alt+E"
        };
        assert_eq!(
            default_shortcut(StartMode::Editor).as_deref(),
            Some(expected)
        );
        assert_eq!(default_shortcut(StartMode::History), None);
        assert_eq!(
            default_hotkeys_config().get("editor"),
            Some(&Value::String(expected.to_owned()))
        );
        assert_eq!(
            default_selection_hotkeys_config()
                .get(CORRECTION_ACTION)
                .and_then(Value::as_str),
            Some(default_correction_shortcut().as_str())
        );
    }

    #[test]
    fn reports_defaults_of_every_hotkey() {
        let defaults = default_bindings()
            .into_iter()
            .map(|binding| binding.target.id())
            .collect::<Vec<_>>();
        assert_eq!(defaults.len(), GLOBAL_HOTKEY_MODES.len() + 1);
        assert!(defaults.contains(&String::from("replace.correction")));
    }

    #[test]
    fn reads_overrides_and_ignores_empty_bindings() {
        let bindings = bindings_from_config(&json!({
            "hotkeys": { "editor": "Super+Space", "voice": "  " }
        }));
        assert_eq!(bindings.len(), GLOBAL_HOTKEY_MODES.len() + 1);
        assert_eq!(bindings[0].shortcut, "Super+Space");
        assert_eq!(
            Some(bindings[4].shortcut.clone()),
            default_shortcut(StartMode::Voice)
        );
    }

    #[test]
    fn binds_only_the_inline_correction() {
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
                default_correction_shortcut()
            )]
        );
        assert_eq!(
            selection(json!({ "selectionHotkeys": {
                "correction": "Ctrl+Alt+X",
                "translate.0": "Ctrl+Alt+1"
            } })),
            [(
                String::from("replace.correction"),
                String::from("Ctrl+Alt+X")
            )]
        );
        assert!(selection(json!({ "selectionHotkeys": { "correction": " " } })).is_empty());
    }

    #[test]
    fn does_not_bind_the_correction_mode() {
        let bindings = bindings_from_config(&json!({
            "hotkeys": { "correction": "Ctrl+Alt+R" }
        }));
        assert!(bindings
            .iter()
            .all(|binding| binding.target != HotkeyTarget::Mode(StartMode::Correction)));
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
    fn runs_only_current_global_hotkeys() {
        assert_eq!(
            global_target("editor"),
            Some(HotkeyTarget::Mode(StartMode::Editor))
        );
        assert_eq!(
            global_target("replace.correction"),
            Some(HotkeyTarget::Selection(String::from("correction")))
        );
        assert_eq!(global_target("history"), None);
        assert_eq!(global_target("correction"), None);
        assert_eq!(global_target("replace.translate.0"), None);
        assert_eq!(global_target("bogus"), None);
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
