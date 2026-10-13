//! Binding targets, configuration overrides, and default assignments.
use crate::errors::AppError;
use crate::services::activation::{Activation, ActivationMode, ActivationSource};
use crate::services::platform::hotkeys::DEFAULT_MODIFIERS;
use crate::services::selection_replace::{HotkeyPress, TriggerWait};
use crate::services::{runtime, selection_replace};
use serde_json::{Map, Value};
use tauri::AppHandle;

const HOTKEYS_CONFIG_KEY: &str = "hotkeys";
const SELECTION_HOTKEYS_CONFIG_KEY: &str = "selectionHotkeys";
const SELECTION_TARGET_PREFIX: &str = "replace.";
pub(super) const CORRECTION_ACTION: &str = "correction";
/// The default command the inline correction runs
const CORRECTION_COMMAND_ID: &str = "default:core.correct:fix";
const DEFAULT_CORRECTION_KEY: &str = "F";
const CORRECTION_DESCRIPTION: &str = "Correct selected text in place";

/// What a hotkey does: open a mode, or correct the selection in the focused
/// window in place, see `selection_replace`. Commands have no hotkeys: they
/// run from the overlay, by voice, or through tyco-ctl.
#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub(crate) enum HotkeyTarget {
    Mode(ActivationMode),
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
            None => ActivationMode::parse(id).map(Self::Mode),
        }
    }

    pub(crate) fn id(&self) -> String {
        match self {
            Self::LauncherPage(page) => format!("commandLauncher{page}"),
            Self::Mode(mode) => mode.as_str().to_owned(),
            Self::InlineCorrection => format!("{SELECTION_TARGET_PREFIX}{CORRECTION_ACTION}"),
        }
    }

    pub(crate) fn cli_command(&self) -> String {
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
    pub(crate) fn trigger(&self, app: &AppHandle, hotkey_id: &str) -> Result<(), AppError> {
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

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct HotkeyBinding {
    pub(crate) target: HotkeyTarget,
    /// `None` leaves the target unassigned: the portal still lists it, so
    /// that the user can bind it in the desktop settings
    pub(crate) shortcut: Option<String>,
    pub(crate) description: String,
}

pub(crate) const GLOBAL_HOTKEY_MODES: [ActivationMode; 10] = [
    ActivationMode::Editor,
    ActivationMode::Write,
    ActivationMode::Chat,
    ActivationMode::VoiceChat,
    ActivationMode::Voice,
    ActivationMode::Select,
    ActivationMode::AiTasks,
    ActivationMode::CommandLauncher,
    ActivationMode::Correction,
    ActivationMode::Translate,
];

/// Every global hotkey, assigned or not: a configured shortcut wins, an
/// empty string unassigns it, and a missing one falls back to the default.
pub(crate) fn bindings_from_config(config: &Value) -> Vec<HotkeyBinding> {
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
pub(crate) fn global_target(id: &str) -> Option<HotkeyTarget> {
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
fn default_key(mode: ActivationMode) -> Option<&'static str> {
    match mode {
        ActivationMode::Voice => Some("V"),
        ActivationMode::Select => Some("S"),
        ActivationMode::Editor
        | ActivationMode::Write
        | ActivationMode::Chat
        | ActivationMode::VoiceChat
        | ActivationMode::AiTasks
        | ActivationMode::CommandLauncher
        | ActivationMode::Correction
        | ActivationMode::Translate
        | ActivationMode::History
        | ActivationMode::Config
        | ActivationMode::ExternalAccess => None,
    }
}

fn default_shortcut(mode: ActivationMode) -> Option<String> {
    default_key(mode).map(|key| format!("{DEFAULT_MODIFIERS}+{key}"))
}

fn default_correction_shortcut() -> String {
    format!("{DEFAULT_MODIFIERS}+{DEFAULT_CORRECTION_KEY}")
}

pub(super) fn default_bindings() -> Vec<HotkeyBinding> {
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

fn mode_description(mode: ActivationMode) -> &'static str {
    match mode {
        ActivationMode::Editor => "Open quick editor",
        ActivationMode::Write => "Open writing mode",
        ActivationMode::Chat => "Open chat",
        ActivationMode::VoiceChat => "Ask the chat by voice",
        ActivationMode::Voice => "Start voice input",
        ActivationMode::Select => "Open selection actions",
        ActivationMode::AiTasks => "Open AI tasks",
        ActivationMode::CommandLauncher => "Run a command",
        ActivationMode::Correction => "Correct selected text with review",
        ActivationMode::Translate => "Translate selected text",
        ActivationMode::History => "Open history",
        ActivationMode::Config => "Open settings",
        ActivationMode::ExternalAccess => "Answer a request for the selection",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn default_shortcuts_avoid_altgr_on_windows() {
        let expected = if cfg!(target_os = "windows") {
            "Ctrl+Shift+Alt+V"
        } else {
            "Ctrl+Alt+V"
        };
        assert_eq!(
            default_shortcut(ActivationMode::Voice).as_deref(),
            Some(expected)
        );
        assert_eq!(default_shortcut(ActivationMode::History), None);
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
        assert_eq!(shortcut("select"), default_shortcut(ActivationMode::Select));
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
            != HotkeyTarget::Mode(ActivationMode::History)
            && binding.target != HotkeyTarget::Mode(ActivationMode::Config)));
    }

    #[test]
    fn modes_open_with_their_cli_spelling() {
        assert_eq!(
            HotkeyTarget::Mode(ActivationMode::VoiceChat).cli_command(),
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
            HotkeyTarget::Mode(ActivationMode::Editor)
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
            Some(HotkeyTarget::Mode(ActivationMode::Editor))
        );
        assert_eq!(
            global_target("correction"),
            Some(HotkeyTarget::Mode(ActivationMode::Correction))
        );
        assert_eq!(
            global_target("translate"),
            Some(HotkeyTarget::Mode(ActivationMode::Translate))
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
}
