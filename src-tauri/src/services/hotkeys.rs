#[cfg(target_os = "linux")]
#[path = "platform/linux/hotkeys_portal.rs"]
mod portal;
mod providers;
#[cfg(target_os = "linux")]
use portal::{
    can_configure_portal, configure_portal, rebind_portal, refresh_system_triggers, PortalState,
};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::RwLock;
use tauri::{App, AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::errors::AppError;
use crate::services::activation::{Activation, ActivationSource, StartMode};
use crate::services::platform::session::{self, Desktop, DisplayServer};
use crate::services::runtime;
use crate::services::selection_replace::{self, HotkeyPress, TriggerWait};
use crate::state::AppState;

/// Emitted when the desktop reports changed portal shortcuts.
pub const HOTKEYS_CHANGED_EVENT: &str = "app://hotkeys-changed";

const HOTKEYS_CONFIG_KEY: &str = "hotkeys";
const SELECTION_HOTKEYS_CONFIG_KEY: &str = "selectionHotkeys";
const SELECTION_TARGET_PREFIX: &str = "replace.";
const CORRECTION_ACTION: &str = "correction";
/// The default command the inline correction runs
const CORRECTION_COMMAND_ID: &str = "default:core.correct:fix";
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

/// What a hotkey does: open a mode, or correct the selection in the focused
/// window in place, see `selection_replace`. Commands have no hotkeys: they
/// run from the overlay, by voice, or through tyco-ctl.
#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub(crate) enum HotkeyTarget {
    Mode(StartMode),
    InlineCorrection,
    LauncherPage(usize),
}

impl HotkeyTarget {
    /// The id shared with the UI and the portal: the mode name, or
    /// `replace.correction`.
    pub(crate) fn parse(id: &str) -> Result<Self, AppError> {
        if let Some(page) = id
            .strip_prefix("commandLauncher")
            .and_then(|page| page.parse::<usize>().ok())
            .filter(|page| (2..=5).contains(page))
        {
            return Ok(Self::LauncherPage(page));
        }
        match id.strip_prefix(SELECTION_TARGET_PREFIX) {
            Some(CORRECTION_ACTION) => Ok(Self::InlineCorrection),
            Some(action) => Err(AppError::Message(format!(
                "Unknown selection action: {action}"
            ))),
            None => StartMode::parse(id).map(Self::Mode),
        }
    }

    pub(crate) fn id(&self) -> String {
        match self {
            Self::LauncherPage(page) => format!("commandLauncher{page}"),
            Self::Mode(mode) => mode.as_str().to_owned(),
            Self::InlineCorrection => format!("{SELECTION_TARGET_PREFIX}{CORRECTION_ACTION}"),
        }
    }

    fn cli_command(&self) -> String {
        match self {
            Self::LauncherPage(page) => format!("tyco --mode=commandLauncher{page}"),
            Self::Mode(mode) => format!(
                "tyco-ctl open {}",
                tyco_activation_protocol::cli_mode(mode.as_str())
            ),
            Self::InlineCorrection => {
                format!("tyco-ctl run {CORRECTION_COMMAND_ID} --selection --replace --interactive")
            }
        }
    }

    /// Runs the target for a press of the hotkey with the given provider id.
    fn trigger(&self, app: &AppHandle, hotkey_id: &str) -> Result<(), AppError> {
        match self {
            Self::LauncherPage(page) => runtime::activate(
                app,
                Activation::from_mode(&format!("commandLauncher{page}"), ActivationSource::Hotkey)?,
            ),
            Self::Mode(mode) => {
                runtime::activate(app, Activation::new(*mode, ActivationSource::Hotkey))
            }
            Self::InlineCorrection => selection_replace::trigger(
                app,
                CORRECTION_ACTION,
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
    /// `None` leaves the target unassigned: the portal still lists it, so
    /// that the user can bind it in the desktop settings
    shortcut: Option<String>,
    description: String,
}

#[derive(Default)]
pub struct HotkeyRegistry {
    targets: RwLock<HashMap<u32, HotkeyTarget>>,
    shortcuts: RwLock<HashMap<HotkeyTarget, Shortcut>>,
    /// Why the configured shortcut of a hotkey id could not be registered
    /// at startup, usually because another application holds it
    failures: RwLock<HashMap<String, String>>,
}

impl HotkeyRegistry {
    fn set_failure(&self, id: String, message: Option<String>) {
        let mut failures = self
            .failures
            .write()
            .expect("hotkey failures lock poisoned");
        match message {
            Some(message) => failures.insert(id, message),
            None => failures.remove(&id),
        };
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

/// Registration effects, supplied to policy instead of an application handle.
trait HotkeyProvider {
    fn is_registered(&self, shortcut: Shortcut) -> bool;
    fn register(&self, shortcut: Shortcut) -> Result<(), AppError>;
    fn unregister(&self, shortcut: Shortcut) -> Result<(), AppError>;
}

struct SystemHotkeyProvider<'a>(&'a AppHandle);

impl HotkeyProvider for SystemHotkeyProvider<'_> {
    fn is_registered(&self, shortcut: Shortcut) -> bool {
        self.0.global_shortcut().is_registered(shortcut)
    }
    fn register(&self, shortcut: Shortcut) -> Result<(), AppError> {
        self.0
            .global_shortcut()
            .register(shortcut)
            .map_err(|error| AppError::Message(error.to_string()))
    }
    fn unregister(&self, shortcut: Shortcut) -> Result<(), AppError> {
        self.0
            .global_shortcut()
            .unregister(shortcut)
            .map_err(|error| AppError::Message(error.to_string()))
    }
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

/// Takes the global shortcuts away while the settings record a new one, so
/// that pressing a bound shortcut reaches the settings instead of running it.
/// Only Tyco's own registrations can be suspended: the desktop keeps portal
/// shortcuts and compositor bindings.
pub fn set_suspended(app: &AppHandle, suspended: bool) -> Result<(), AppError> {
    suspend_with(
        app.state::<ProviderState>().get(),
        &app.state::<HotkeyRegistry>(),
        &SystemHotkeyProvider(app),
        suspended,
    );
    Ok(())
}

fn suspend_with(
    kind: ProviderKind,
    registry: &HotkeyRegistry,
    provider: &impl HotkeyProvider,
    suspended: bool,
) {
    if kind != ProviderKind::GlobalShortcut {
        return;
    }
    let shortcuts = registry
        .shortcuts
        .read()
        .expect("hotkey shortcuts lock poisoned")
        .values()
        .copied()
        .collect::<Vec<_>>();
    for shortcut in shortcuts {
        let registered = provider.is_registered(shortcut);
        let result = if suspended && registered {
            provider.unregister(shortcut)
        } else if !suspended && !registered {
            provider.register(shortcut)
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

pub fn apply(app: &AppHandle, request: ApplyHotkeyRequest) -> Result<ApplyHotkeyResult, AppError> {
    let target = HotkeyTarget::parse(&request.mode)?;
    // an empty shortcut unassigns the hotkey
    let requested = request.shortcut.trim();
    let shortcut = (!requested.is_empty())
        .then(|| requested.parse::<Shortcut>())
        .transpose()
        .map_err(|error| AppError::Message(format!("Invalid hotkey: {error}")))?;

    match app.state::<ProviderState>().get() {
        ProviderKind::GlobalShortcut => {
            let result = apply_global_shortcut(app, &target, shortcut)?;
            if result.status != HotkeyApplyStatus::Conflict {
                app.state::<HotkeyRegistry>().set_failure(target.id(), None);
            }
            Ok(result)
        }
        // the desktop keeps the shortcut the user chose and ignores a new
        // preferred one, so only its settings change it
        ProviderKind::Portal => Err(AppError::Message(String::from(
            "Hotkeys are managed by the desktop; change them in its settings",
        ))),
        ProviderKind::External => Ok(ApplyHotkeyResult {
            status: HotkeyApplyStatus::External,
            external_command: Some(external_command(&target, shortcut.map(|_| requested))),
            message: None,
        }),
    }
}

fn apply_global_shortcut(
    app: &AppHandle,
    target: &HotkeyTarget,
    shortcut: Option<Shortcut>,
) -> Result<ApplyHotkeyResult, AppError> {
    apply_global_shortcut_with(
        &app.state::<HotkeyRegistry>(),
        &SystemHotkeyProvider(app),
        target,
        shortcut,
    )
}

fn apply_global_shortcut_with(
    registry: &HotkeyRegistry,
    provider: &impl HotkeyProvider,
    target: &HotkeyTarget,
    shortcut: Option<Shortcut>,
) -> Result<ApplyHotkeyResult, AppError> {
    let ready = ApplyHotkeyResult {
        status: HotkeyApplyStatus::Ready,
        external_command: None,
        message: None,
    };
    let previous = registry
        .shortcuts
        .read()
        .expect("hotkey shortcuts lock poisoned")
        .get(target)
        .copied();

    if previous == shortcut {
        return Ok(ready);
    }
    if let Some(previous) = previous {
        // a shortcut suspended while the settings record is not registered
        if provider.is_registered(previous) {
            provider
                .unregister(previous)
                .map_err(|error| AppError::Message(error.to_string()))?;
        }
        registry
            .targets
            .write()
            .expect("hotkey bindings lock poisoned")
            .remove(&previous.id());
    }
    let Some(shortcut) = shortcut else {
        registry
            .shortcuts
            .write()
            .expect("hotkey shortcuts lock poisoned")
            .remove(target);
        return Ok(ready);
    };
    if let Err(error) = provider.register(shortcut) {
        if let Some(previous) = previous {
            match provider.register(previous) {
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
                        .remove(target);
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
        .insert(target.clone(), shortcut);
    Ok(ready)
}

/// The line that binds `target` in the desktop's own configuration; without
/// a shortcut only the command to bind.
fn external_command(target: &HotkeyTarget, shortcut: Option<&str>) -> String {
    let Some(shortcut) = shortcut else {
        return target.cli_command();
    };
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

pub(crate) const GLOBAL_HOTKEY_MODES: [StartMode; 10] = [
    StartMode::Editor,
    StartMode::Write,
    StartMode::Chat,
    StartMode::VoiceChat,
    StartMode::Voice,
    StartMode::Select,
    StartMode::AiTasks,
    StartMode::CommandLauncher,
    StartMode::Correction,
    StartMode::Translate,
];

/// Every global hotkey, assigned or not: a configured shortcut wins, an
/// empty string unassigns it, and a missing one falls back to the default.
fn bindings_from_config(config: &Value) -> Vec<HotkeyBinding> {
    let configured = config.get(HOTKEYS_CONFIG_KEY).and_then(Value::as_object);

    let modes = GLOBAL_HOTKEY_MODES.into_iter().map(|mode| HotkeyBinding {
        target: HotkeyTarget::Mode(mode),
        shortcut: configured_shortcut(
            configured.and_then(|values| values.get(mode.as_str())),
            || default_shortcut(mode),
        ),
        description: mode_description(mode).to_owned(),
    });
    let pages = (2..=5).map(|page| HotkeyBinding {
        target: HotkeyTarget::LauncherPage(page),
        shortcut: configured_shortcut(
            configured.and_then(|values| values.get(&format!("commandLauncher{page}"))),
            || None,
        ),
        description: format!("Quick commands: page {page}"),
    });
    modes
        .chain(pages)
        .chain([selection_binding(config)])
        .collect()
}

/// Only the correction replaces the selection from a hotkey.
fn selection_binding(config: &Value) -> HotkeyBinding {
    HotkeyBinding {
        target: HotkeyTarget::InlineCorrection,
        shortcut: configured_shortcut(
            config
                .get(SELECTION_HOTKEYS_CONFIG_KEY)
                .and_then(|values| values.get(CORRECTION_ACTION)),
            || Some(default_correction_shortcut()),
        ),
        description: CORRECTION_DESCRIPTION.to_owned(),
    }
}

fn configured_shortcut(
    value: Option<&Value>,
    default: impl FnOnce() -> Option<String>,
) -> Option<String> {
    match value.and_then(Value::as_str) {
        Some(shortcut) => Some(shortcut.trim())
            .filter(|shortcut| !shortcut.is_empty())
            .map(str::to_owned),
        None => default(),
    }
}

/// The target of a global hotkey id; other targets have no global hotkey.
fn global_target(id: &str) -> Option<HotkeyTarget> {
    let target = HotkeyTarget::parse(id).ok()?;
    let global = match &target {
        HotkeyTarget::Mode(mode) => GLOBAL_HOTKEY_MODES.contains(mode),
        HotkeyTarget::InlineCorrection | HotkeyTarget::LauncherPage(_) => true,
    };
    global.then_some(target)
}

/// Only the hotkeys that act on what the user is doing in another window
/// are assigned by default: every default may collide with a shortcut of the
/// desktop or another application, and the rest open Tyco windows that the
/// tray reaches as well.
fn default_key(mode: StartMode) -> Option<&'static str> {
    match mode {
        StartMode::Voice => Some("V"),
        StartMode::Select => Some("S"),
        StartMode::Editor
        | StartMode::Write
        | StartMode::Chat
        | StartMode::VoiceChat
        | StartMode::AiTasks
        | StartMode::CommandLauncher
        | StartMode::Correction
        | StartMode::Translate
        | StartMode::History
        | StartMode::Config
        | StartMode::ExternalAccess => None,
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

/// The `hotkeys` of the default user config on this platform; an unassigned
/// hotkey is an empty string.
pub fn default_hotkeys_config() -> Value {
    let mut hotkeys = GLOBAL_HOTKEY_MODES
        .into_iter()
        .map(|mode| {
            (
                mode.as_str().to_owned(),
                Value::String(default_shortcut(mode).unwrap_or_default()),
            )
        })
        .collect::<Map<_, _>>();
    for page in 2..=5 {
        hotkeys.insert(
            format!("commandLauncher{page}"),
            Value::String(String::new()),
        );
    }
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

fn mode_description(mode: StartMode) -> &'static str {
    match mode {
        StartMode::Editor => "Open quick editor",
        StartMode::Write => "Open writing mode",
        StartMode::Chat => "Open chat",
        StartMode::VoiceChat => "Ask the chat by voice",
        StartMode::Voice => "Start voice input",
        StartMode::Select => "Open selection actions",
        StartMode::AiTasks => "Open AI tasks",
        StartMode::CommandLauncher => "Run a command",
        StartMode::Correction => "Correct selected text with review",
        StartMode::Translate => "Translate selected text",
        StartMode::History => "Open history",
        StartMode::Config => "Open settings",
        StartMode::ExternalAccess => "Answer a request for the selection",
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
    #[derive(Default)]
    struct FakeProvider {
        registered: std::cell::RefCell<std::collections::HashSet<u32>>,
        rejected: std::cell::RefCell<std::collections::HashSet<u32>>,
        unregister_fails: std::cell::Cell<bool>,
        calls: std::cell::RefCell<Vec<(bool, u32)>>,
    }

    impl HotkeyProvider for FakeProvider {
        fn is_registered(&self, shortcut: Shortcut) -> bool {
            self.registered.borrow().contains(&shortcut.id())
        }
        fn register(&self, shortcut: Shortcut) -> Result<(), AppError> {
            self.calls.borrow_mut().push((true, shortcut.id()));
            if self.rejected.borrow().contains(&shortcut.id()) {
                return Err(AppError::Message("shortcut conflict".into()));
            }
            self.registered.borrow_mut().insert(shortcut.id());
            Ok(())
        }
        fn unregister(&self, shortcut: Shortcut) -> Result<(), AppError> {
            self.calls.borrow_mut().push((false, shortcut.id()));
            if self.unregister_fails.get() {
                return Err(AppError::Message("unregister failed".into()));
            }
            self.registered.borrow_mut().remove(&shortcut.id());
            Ok(())
        }
    }

    fn shortcut_fixture() -> (
        HotkeyRegistry,
        FakeProvider,
        HotkeyTarget,
        Shortcut,
        Shortcut,
    ) {
        let registry = HotkeyRegistry::default();
        let provider = FakeProvider::default();
        let target = HotkeyTarget::Mode(StartMode::Write);
        let old: Shortcut = "Ctrl+Shift+W".parse().unwrap();
        let new: Shortcut = "Ctrl+Shift+E".parse().unwrap();
        registry
            .shortcuts
            .write()
            .unwrap()
            .insert(target.clone(), old);
        registry
            .targets
            .write()
            .unwrap()
            .insert(old.id(), target.clone());
        provider.registered.borrow_mut().insert(old.id());
        (registry, provider, target, old, new)
    }

    #[test]
    fn shortcut_replacement_and_unassignment_keep_registry_and_provider_in_sync() {
        let (registry, provider, target, old, new) = shortcut_fixture();
        assert_eq!(
            apply_global_shortcut_with(&registry, &provider, &target, Some(old))
                .unwrap()
                .status,
            HotkeyApplyStatus::Ready
        );
        assert!(provider.calls.borrow().is_empty());
        assert_eq!(
            apply_global_shortcut_with(&registry, &provider, &target, Some(new))
                .unwrap()
                .status,
            HotkeyApplyStatus::Ready
        );
        assert!(!provider.is_registered(old));
        assert!(provider.is_registered(new));
        assert_eq!(registry.shortcuts.read().unwrap().get(&target), Some(&new));
        assert!(!registry.targets.read().unwrap().contains_key(&old.id()));
        apply_global_shortcut_with(&registry, &provider, &target, None).unwrap();
        assert!(registry.shortcuts.read().unwrap().is_empty());
        assert!(registry.targets.read().unwrap().is_empty());
        assert!(provider.registered.borrow().is_empty());
    }

    #[test]
    fn shortcut_conflict_restores_the_previous_registration() {
        let (registry, provider, target, old, new) = shortcut_fixture();
        provider.rejected.borrow_mut().insert(new.id());
        let result = apply_global_shortcut_with(&registry, &provider, &target, Some(new)).unwrap();
        assert_eq!(result.status, HotkeyApplyStatus::Conflict);
        assert_eq!(result.message.as_deref(), Some("shortcut conflict"));
        assert_eq!(registry.shortcuts.read().unwrap().get(&target), Some(&old));
        assert_eq!(
            registry.targets.read().unwrap().get(&old.id()),
            Some(&target)
        );
        assert!(provider.is_registered(old));
        assert_eq!(
            *provider.calls.borrow(),
            [(false, old.id()), (true, new.id()), (true, old.id())]
        );
    }

    #[test]
    fn failed_rollback_removes_the_stale_registry_entry() {
        let (registry, provider, target, old, new) = shortcut_fixture();
        provider.rejected.borrow_mut().extend([old.id(), new.id()]);
        assert_eq!(
            apply_global_shortcut_with(&registry, &provider, &target, Some(new))
                .unwrap()
                .status,
            HotkeyApplyStatus::Conflict
        );
        assert!(registry.shortcuts.read().unwrap().is_empty());
        assert!(registry.targets.read().unwrap().is_empty());
        assert!(provider.registered.borrow().is_empty());
    }

    #[test]
    fn unregister_failure_keeps_the_previous_binding_and_does_not_register_a_new_one() {
        let (registry, provider, target, old, new) = shortcut_fixture();
        provider.unregister_fails.set(true);
        assert!(apply_global_shortcut_with(&registry, &provider, &target, Some(new)).is_err());
        assert_eq!(registry.shortcuts.read().unwrap().get(&target), Some(&old));
        assert_eq!(
            registry.targets.read().unwrap().get(&old.id()),
            Some(&target)
        );
        assert_eq!(*provider.calls.borrow(), [(false, old.id())]);
    }

    #[test]
    fn suspension_is_idempotent_and_does_not_touch_desktop_managed_bindings() {
        let (registry, provider, target, old, _) = shortcut_fixture();
        suspend_with(ProviderKind::Portal, &registry, &provider, true);
        suspend_with(ProviderKind::External, &registry, &provider, true);
        assert!(provider.calls.borrow().is_empty());
        suspend_with(ProviderKind::GlobalShortcut, &registry, &provider, true);
        suspend_with(ProviderKind::GlobalShortcut, &registry, &provider, true);
        assert!(!provider.is_registered(old));
        assert_eq!(registry.shortcuts.read().unwrap().get(&target), Some(&old));
        suspend_with(ProviderKind::GlobalShortcut, &registry, &provider, false);
        suspend_with(ProviderKind::GlobalShortcut, &registry, &provider, false);
        assert_eq!(
            *provider.calls.borrow(),
            [(false, old.id()), (true, old.id())]
        );
    }

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
            "Ctrl+Shift+Alt+V"
        } else {
            "Ctrl+Alt+V"
        };
        assert_eq!(
            default_shortcut(StartMode::Voice).as_deref(),
            Some(expected)
        );
        assert_eq!(default_shortcut(StartMode::History), None);
        assert_eq!(
            default_hotkeys_config().get("voice"),
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
    fn assigns_only_selection_and_voice_hotkeys_by_default() {
        let assigned = default_bindings()
            .into_iter()
            .filter(|binding| binding.shortcut.is_some())
            .map(|binding| binding.target.id())
            .collect::<Vec<_>>();
        assert_eq!(assigned, ["voice", "select", "replace.correction"]);
        assert_eq!(
            default_hotkeys_config().get("editor"),
            Some(&Value::String(String::new()))
        );
    }

    #[test]
    fn reports_every_hotkey_with_its_default() {
        let defaults = default_bindings()
            .into_iter()
            .map(|binding| binding.target.id())
            .collect::<Vec<_>>();
        assert_eq!(defaults.len(), GLOBAL_HOTKEY_MODES.len() + 5);
        assert!(defaults.contains(&String::from("replace.correction")));
    }

    #[test]
    fn reads_overrides_and_unassigns_empty_bindings() {
        let bindings = bindings_from_config(&json!({
            "hotkeys": { "editor": "Super+Space", "voice": "  " }
        }));
        let shortcut = |id: &str| {
            bindings
                .iter()
                .find(|binding| binding.target.id() == id)
                .and_then(|binding| binding.shortcut.clone())
        };
        assert_eq!(bindings.len(), GLOBAL_HOTKEY_MODES.len() + 5);
        assert_eq!(shortcut("editor").as_deref(), Some("Super+Space"));
        assert_eq!(shortcut("voice"), None);
        assert_eq!(shortcut("select"), default_shortcut(StartMode::Select));
        assert_eq!(shortcut("chat"), None);
    }

    #[test]
    fn binds_only_the_inline_correction() {
        let selection = |config: Value| {
            let binding = selection_binding(&config);
            (binding.target.id(), binding.shortcut)
        };
        assert_eq!(
            selection(json!({})),
            (
                String::from("replace.correction"),
                Some(default_correction_shortcut())
            )
        );
        assert_eq!(
            selection(json!({ "selectionHotkeys": {
                "correction": "Ctrl+Alt+X",
                "translate.0": "Ctrl+Alt+1"
            } })),
            (
                String::from("replace.correction"),
                Some(String::from("Ctrl+Alt+X"))
            )
        );
        assert_eq!(
            selection(json!({ "selectionHotkeys": { "correction": " " } })).1,
            None
        );
    }

    #[test]
    fn does_not_bind_history_or_config_modes() {
        let bindings = bindings_from_config(&json!({
            "hotkeys": { "history": "Ctrl+Alt+H", "config": "Ctrl+Alt+Comma" }
        }));
        assert!(bindings.iter().all(|binding| binding.target
            != HotkeyTarget::Mode(StartMode::History)
            && binding.target != HotkeyTarget::Mode(StartMode::Config)));
    }

    #[test]
    fn modes_open_with_their_cli_spelling() {
        assert_eq!(
            HotkeyTarget::Mode(StartMode::VoiceChat).cli_command(),
            "tyco-ctl open voice-chat"
        );
    }

    #[test]
    fn the_inline_correction_runs_the_default_command() {
        assert_eq!(
            HotkeyTarget::InlineCorrection.cli_command(),
            "tyco-ctl run default:core.correct:fix --selection --replace --interactive"
        );
    }

    #[test]
    fn parses_hotkey_targets() {
        assert_eq!(
            HotkeyTarget::parse("editor").unwrap(),
            HotkeyTarget::Mode(StartMode::Editor)
        );
        let target = HotkeyTarget::parse("replace.correction").unwrap();
        assert_eq!(target, HotkeyTarget::InlineCorrection);
        assert_eq!(target.id(), "replace.correction");
        // commands have no hotkeys
        assert!(HotkeyTarget::parse("replace.command:task-fix").is_err());
        assert!(HotkeyTarget::parse("replace.aiTask.2").is_err());
        assert!(HotkeyTarget::parse("replace.translate.0").is_err());
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
            global_target("correction"),
            Some(HotkeyTarget::Mode(StartMode::Correction))
        );
        assert_eq!(
            global_target("translate"),
            Some(HotkeyTarget::Mode(StartMode::Translate))
        );
        assert_eq!(
            global_target("replace.correction"),
            Some(HotkeyTarget::InlineCorrection)
        );
        assert_eq!(global_target("history"), None);
        assert_eq!(global_target("config"), None);
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
