//! Binding targets, configuration overrides, and default assignments.
use crate::errors::AppError;
use crate::services::activation::{Activation, ActivationMode, ActivationSource};
use crate::services::platform::hotkeys::DEFAULT_MODIFIERS;
use crate::services::selection_replace::{HotkeyPress, TriggerWait};
use crate::services::{runtime, selection_replace};
use serde_json::{Map, Value};
use tauri::AppHandle;

const HOTKEYS_CONFIG_KEY: &str = "hotkeys";
/// The key of the inline correction in `hotkeys`, and its hotkey id.
const SELECTION_CORRECTION_CONFIG_KEY: &str = "selectionCorrection";
const SELECTION_ACTIONS_KEY: &str = "selectionActions";
const SELECTION_ACTIONS_PAGE_2_KEY: &str = "selectionActionsPage2";
const SELECTION_ACTIONS_PAGE_3_KEY: &str = "selectionActionsPage3";
const SELECTION_ACTIONS_PAGE_4_KEY: &str = "selectionActionsPage4";
const SELECTION_ACTIONS_PAGE_5_KEY: &str = "selectionActionsPage5";
const CUSTOM_ACTION_KEYS: [&str; 5] = [
    "customAction1",
    "customAction2",
    "customAction3",
    "customAction4",
    "customAction5",
];

pub(super) use crate::services::selection_replace::CORRECTION_ACTION;
const DEFAULT_CORRECTION_KEY: &str = "F";
const CORRECTION_DESCRIPTION: &str = "Correct selected text in place";

/// What a hotkey does: open a mode or an action page, or
/// correct the selection in the focused window in place, see
/// `selection_replace`. Commands have no hotkeys: they run from the overlay,
/// by voice, or through tyco-ctl.
#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub(crate) enum HotkeyTarget {
    Mode(ActivationMode),
    InlineCorrection,
    /// An action page by 0-based index
    ActionPage(usize),
    /// A custom action slot by 0-based index
    CustomAction(usize),
}

impl HotkeyTarget {
    /// The id shared with the UI and the portal: the mode name,
    /// `selectionCorrection`, or action page keys.
    pub(crate) fn parse(id: &str) -> Result<Self, AppError> {
        if id == SELECTION_CORRECTION_CONFIG_KEY {
            return Ok(Self::InlineCorrection);
        }
        if id == SELECTION_ACTIONS_KEY {
            return Ok(Self::ActionPage(0));
        }
        if id == SELECTION_ACTIONS_PAGE_2_KEY {
            return Ok(Self::ActionPage(1));
        }
        if id == SELECTION_ACTIONS_PAGE_3_KEY {
            return Ok(Self::ActionPage(2));
        }
        if id == SELECTION_ACTIONS_PAGE_4_KEY {
            return Ok(Self::ActionPage(3));
        }
        if id == SELECTION_ACTIONS_PAGE_5_KEY {
            return Ok(Self::ActionPage(4));
        }
        if let Some(index) = CUSTOM_ACTION_KEYS.iter().position(|key| *key == id) {
            return Ok(Self::CustomAction(index));
        }
        ActivationMode::parse(id).map(Self::Mode)
    }

    pub(crate) fn id(&self) -> String {
        match self {
            Self::ActionPage(0) => SELECTION_ACTIONS_KEY.to_owned(),
            Self::ActionPage(1) => SELECTION_ACTIONS_PAGE_2_KEY.to_owned(),
            Self::ActionPage(2) => SELECTION_ACTIONS_PAGE_3_KEY.to_owned(),
            Self::ActionPage(3) => SELECTION_ACTIONS_PAGE_4_KEY.to_owned(),
            Self::ActionPage(4) => SELECTION_ACTIONS_PAGE_5_KEY.to_owned(),
            Self::ActionPage(index) => format!("selectionActionsPage{}", index + 1),
            Self::CustomAction(index) => CUSTOM_ACTION_KEYS.get(*index).map_or_else(
                || format!("customAction{}", index + 1),
                |key| (*key).to_owned(),
            ),
            Self::Mode(mode) => mode.as_str().to_owned(),
            Self::InlineCorrection => SELECTION_CORRECTION_CONFIG_KEY.to_owned(),
        }
    }

    pub(crate) fn cli_command(&self) -> String {
        match self {
            Self::ActionPage(0) => "tyco-ctl open selection-actions".to_owned(),
            Self::ActionPage(index) => {
                format!("tyco --mode={}", Activation::action_page_mode(*index))
            }
            Self::CustomAction(index) => {
                format!("tyco --mode={}", Activation::custom_action_mode(*index))
            }
            Self::Mode(mode) => format!(
                "tyco-ctl open {}",
                tyco_activation_protocol::cli_mode(mode.as_str())
            ),
            Self::InlineCorrection => {
                format!("tyco-ctl replace {CORRECTION_ACTION}")
            }
        }
    }

    /// Runs the target for a press of the hotkey with the given provider id.
    pub(crate) fn trigger(&self, app: &AppHandle, hotkey_id: &str) -> Result<(), AppError> {
        match self {
            Self::ActionPage(index) => runtime::activate(
                app,
                Activation::selection_actions(*index, ActivationSource::Hotkey),
            ),
            Self::CustomAction(index) => runtime::activate(
                app,
                Activation::custom_action(*index, ActivationSource::Hotkey),
            ),
            Self::Mode(mode) => {
                runtime::activate(app, Activation::new(*mode, ActivationSource::Hotkey))
            }
            Self::InlineCorrection => selection_replace::trigger(
                app,
                CORRECTION_ACTION,
                TriggerWait::HotkeyRelease(HotkeyPress::new(hotkey_id)),
                selection_replace::TriggerKind::Toggle,
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

pub(crate) const GLOBAL_HOTKEY_MODES: [ActivationMode; 18] = [
    ActivationMode::Editor,
    ActivationMode::QuickInput,
    ActivationMode::Chat,
    ActivationMode::VoiceChat,
    ActivationMode::VoiceCommands,
    ActivationMode::Voice,
    ActivationMode::Listen,
    ActivationMode::Correction,
    ActivationMode::Translation,
    ActivationMode::Styling,
    ActivationMode::Transformation,
    ActivationMode::QuickAiRequest,
    ActivationMode::VoiceQuickAiRequest,
    ActivationMode::ScreenshotQuickAiRequest,
    ActivationMode::VoiceScreenshotQuickAiRequest,
    ActivationMode::ChatPrompts,
    ActivationMode::Favorites,
    ActivationMode::History,
];

/// Six primary entry points and five custom slots. Previously configured
/// shortcuts remain available, but unassigned secondary targets are not
/// advertised to the desktop portal.
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

    let action_pages = [
        (
            HotkeyTarget::ActionPage(0),
            SELECTION_ACTIONS_KEY,
            Some(format!("{DEFAULT_MODIFIERS}+S")),
            "Show action menu: page 1",
        ),
        (
            HotkeyTarget::ActionPage(1),
            SELECTION_ACTIONS_PAGE_2_KEY,
            None,
            "Show action menu: page 2",
        ),
        (
            HotkeyTarget::ActionPage(2),
            SELECTION_ACTIONS_PAGE_3_KEY,
            None,
            "Show action menu: page 3",
        ),
        (
            HotkeyTarget::ActionPage(3),
            SELECTION_ACTIONS_PAGE_4_KEY,
            None,
            "Show action menu: page 4",
        ),
        (
            HotkeyTarget::ActionPage(4),
            SELECTION_ACTIONS_PAGE_5_KEY,
            None,
            "Show action menu: page 5",
        ),
    ]
    .into_iter()
    .map(|(target, key, default, desc)| HotkeyBinding {
        target,
        shortcut: configured_shortcut(configured.and_then(|values| values.get(key)), || default),
        description: desc.to_owned(),
    });

    let custom_actions = CUSTOM_ACTION_KEYS
        .iter()
        .enumerate()
        .map(|(index, key)| HotkeyBinding {
            target: HotkeyTarget::CustomAction(index),
            shortcut: configured_shortcut(configured.and_then(|values| values.get(*key)), || None),
            description: format!("Run custom action: slot {}", index + 1),
        });

    modes
        .chain(action_pages)
        .chain(custom_actions)
        .chain([selection_binding(config)])
        .filter(|binding| is_primary_target(&binding.target) || binding.shortcut.is_some())
        .collect()
}

fn is_primary_target(target: &HotkeyTarget) -> bool {
    matches!(
        target,
        HotkeyTarget::Mode(
            ActivationMode::Voice
                | ActivationMode::QuickInput
                | ActivationMode::History
                | ActivationMode::VoiceCommands
        ) | HotkeyTarget::ActionPage(0)
            | HotkeyTarget::InlineCorrection
            | HotkeyTarget::CustomAction(_)
    )
}

/// Only the correction replaces the selection from a hotkey.
fn selection_binding(config: &Value) -> HotkeyBinding {
    HotkeyBinding {
        target: HotkeyTarget::InlineCorrection,
        shortcut: configured_shortcut(
            config
                .get(HOTKEYS_CONFIG_KEY)
                .and_then(|values| values.get(SELECTION_CORRECTION_CONFIG_KEY)),
            default_correction_shortcut,
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

/// Puts back the shortcut `target` has in `source` into `config`: a
/// shortcut the system refused must not be saved as if it were bound.
pub(crate) fn restore_config_shortcut(config: &mut Value, source: &Value, target: &HotkeyTarget) {
    let id = target.id();
    let previous = source
        .get(HOTKEYS_CONFIG_KEY)
        .and_then(|hotkeys| hotkeys.get(&id))
        .cloned();
    let Some(Value::Object(hotkeys)) = config.get_mut(HOTKEYS_CONFIG_KEY) else {
        return;
    };
    match previous {
        Some(previous) => hotkeys.insert(id, previous),
        None => hotkeys.remove(&id),
    };
}

/// The target of a global hotkey id; other targets have no global hotkey.
pub(crate) fn global_target(id: &str) -> Option<HotkeyTarget> {
    let target = HotkeyTarget::parse(id).ok()?;
    let global = match &target {
        HotkeyTarget::Mode(mode) => GLOBAL_HOTKEY_MODES.contains(mode),
        HotkeyTarget::InlineCorrection
        | HotkeyTarget::ActionPage(_)
        | HotkeyTarget::CustomAction(_) => true,
    };
    global.then_some(target)
}

/// Defaults for the primary entry points; specialized workflows use the
/// action menu or the five custom slots to avoid reserving unused shortcuts.
fn default_key(mode: ActivationMode) -> Option<&'static str> {
    match mode {
        ActivationMode::Voice => Some("V"),
        ActivationMode::VoiceCommands => Some("X"),
        ActivationMode::QuickInput => Some("W"),
        ActivationMode::History => Some("H"),
        ActivationMode::Editor
        | ActivationMode::Listen
        | ActivationMode::Chat
        | ActivationMode::VoiceChat
        | ActivationMode::SelectionActions
        | ActivationMode::Correction
        | ActivationMode::Translation
        | ActivationMode::Styling
        | ActivationMode::Transformation
        | ActivationMode::QuickAiRequest
        | ActivationMode::VoiceQuickAiRequest
        | ActivationMode::ScreenshotQuickAiRequest
        | ActivationMode::VoiceScreenshotQuickAiRequest
        | ActivationMode::ChatPrompts
        | ActivationMode::Favorites
        | ActivationMode::Config
        | ActivationMode::CustomAction
        | ActivationMode::ExternalAccess => None,
    }
}

fn default_shortcut(mode: ActivationMode) -> Option<String> {
    default_key(mode).map(|key| format!("{DEFAULT_MODIFIERS}+{key}"))
}

/// None on macOS, where the selection cannot be replaced in place yet.
fn default_correction_shortcut() -> Option<String> {
    (!cfg!(target_os = "macos")).then(|| format!("{DEFAULT_MODIFIERS}+{DEFAULT_CORRECTION_KEY}"))
}

pub(super) fn default_bindings() -> Vec<HotkeyBinding> {
    bindings_from_config(&serde_json::json!({}))
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
    hotkeys.insert(
        SELECTION_ACTIONS_KEY.to_owned(),
        Value::String(format!("{DEFAULT_MODIFIERS}+S")),
    );
    hotkeys.insert(
        SELECTION_ACTIONS_PAGE_2_KEY.to_owned(),
        Value::String(String::new()),
    );
    hotkeys.insert(
        SELECTION_ACTIONS_PAGE_3_KEY.to_owned(),
        Value::String(String::new()),
    );
    hotkeys.insert(
        SELECTION_ACTIONS_PAGE_4_KEY.to_owned(),
        Value::String(String::new()),
    );
    hotkeys.insert(
        SELECTION_ACTIONS_PAGE_5_KEY.to_owned(),
        Value::String(String::new()),
    );
    for key in CUSTOM_ACTION_KEYS {
        hotkeys.insert(key.to_owned(), Value::String(String::new()));
    }
    hotkeys.insert(
        SELECTION_CORRECTION_CONFIG_KEY.to_owned(),
        Value::String(default_correction_shortcut().unwrap_or_default()),
    );
    Value::Object(hotkeys)
}

fn mode_description(mode: ActivationMode) -> &'static str {
    match mode {
        ActivationMode::Editor => "Open quick editor",
        ActivationMode::QuickInput => "Open writing mode",
        ActivationMode::Chat => "Open chat",
        ActivationMode::VoiceCommands => "Run a command by voice",
        ActivationMode::VoiceChat => "Ask the chat by voice",
        ActivationMode::Voice => "Start voice input",
        ActivationMode::Listen => "System audio",
        ActivationMode::SelectionActions => "Open selection actions",
        ActivationMode::Correction => "Correct selected text with review",
        ActivationMode::Translation => "Translate selected text",
        ActivationMode::Styling => "Open text styling",
        ActivationMode::Transformation => "Open text transformation",
        ActivationMode::QuickAiRequest => "Quick AI request",
        ActivationMode::VoiceQuickAiRequest => "Voice quick AI request",
        ActivationMode::ScreenshotQuickAiRequest => "Screenshot quick AI request",
        ActivationMode::VoiceScreenshotQuickAiRequest => "Voice screenshot quick AI request",
        ActivationMode::ChatPrompts => "Show prompts",
        ActivationMode::Favorites => "Open favorites",
        ActivationMode::History => "Open history",
        ActivationMode::Config => "Open settings",
        ActivationMode::CustomAction => "Run custom action",
        ActivationMode::ExternalAccess => "Answer a request for the selection",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn default_shortcuts_avoid_altgr() {
        let expected = "Ctrl+Alt+Shift+V";
        assert_eq!(
            default_shortcut(ActivationMode::Voice).as_deref(),
            Some(expected)
        );
        assert_eq!(
            default_shortcut(ActivationMode::History).as_deref(),
            Some("Ctrl+Alt+Shift+H")
        );
        assert_eq!(
            default_hotkeys_config().get("voice"),
            Some(&Value::String(expected.to_owned()))
        );
        assert_eq!(
            default_hotkeys_config()
                .get(SELECTION_CORRECTION_CONFIG_KEY)
                .and_then(Value::as_str),
            Some(default_correction_shortcut().unwrap_or_default().as_str())
        );
    }

    #[test]
    fn assigns_only_six_primary_hotkeys_by_default() {
        let assigned = default_bindings()
            .into_iter()
            .filter(|binding| binding.shortcut.is_some())
            .map(|binding| binding.target.id())
            .collect::<Vec<_>>();
        let mut expected = vec![
            "quickInput",
            "voiceCommands",
            "voice",
            "history",
            "selectionActions",
        ];
        if !cfg!(target_os = "macos") {
            expected.push("selectionCorrection");
        }
        assert_eq!(assigned, expected);
        assert_eq!(
            default_hotkeys_config().get("editor"),
            Some(&Value::String(String::new()))
        );
        assert_eq!(
            default_hotkeys_config().get("history"),
            Some(&Value::String("Ctrl+Alt+Shift+H".to_owned()))
        );
    }

    #[test]
    fn advertises_only_primary_hotkeys_and_custom_slots() {
        let defaults = default_bindings()
            .into_iter()
            .map(|binding| binding.target.id())
            .collect::<Vec<_>>();
        assert_eq!(defaults.len(), 11);
        for id in [
            "voice",
            "quickInput",
            "history",
            "voiceCommands",
            "selectionCorrection",
            "selectionActions",
            "customAction1",
            "customAction5",
        ] {
            assert!(defaults.contains(&id.to_owned()), "Missing {id}");
        }
        for id in [
            "editor",
            "chat",
            "voiceChat",
            "translation",
            "selectionActionsPage2",
        ] {
            assert!(!defaults.contains(&id.to_owned()), "Unexpected {id}");
        }
    }

    #[test]
    fn portable_defaults_match_native_defaults_on_supported_platforms() {
        if cfg!(target_os = "macos") {
            return;
        }
        let portable = crate::services::settings::defaults::portable_user_config();
        assert_eq!(portable["hotkeys"], default_hotkeys_config());
    }

    #[test]
    fn reads_overrides_and_unassigns_empty_bindings() {
        let bindings = bindings_from_config(&json!({
            "hotkeys": {
                "editor": "Super+Space",
                "voice": "  ",
                "selectionActions": "",
                "selectionActionsPage2": "Ctrl+Alt+2",
                "chatPrompts": "Ctrl+Alt+P",
                "customAction1": "Ctrl+Alt+C"
            }
        }));
        let shortcut = |id: &str| {
            bindings
                .iter()
                .find(|binding| binding.target.id() == id)
                .and_then(|binding| binding.shortcut.clone())
        };
        assert_eq!(bindings.len(), 14);
        assert_eq!(shortcut("editor").as_deref(), Some("Super+Space"));
        assert_eq!(shortcut("chatPrompts").as_deref(), Some("Ctrl+Alt+P"));
        assert_eq!(shortcut("customAction1").as_deref(), Some("Ctrl+Alt+C"));
        assert_eq!(
            HotkeyTarget::parse("chatPrompts").ok(),
            Some(HotkeyTarget::Mode(ActivationMode::ChatPrompts))
        );
        assert_eq!(
            HotkeyTarget::parse("customAction1").ok(),
            Some(HotkeyTarget::CustomAction(0))
        );
        assert_eq!(shortcut("selectionActions"), None);
        assert_eq!(
            shortcut("selectionActionsPage2").as_deref(),
            Some("Ctrl+Alt+2")
        );
        assert_eq!(shortcut("selectionActionsPage3"), None);
        assert_eq!(shortcut("voice"), None);
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
                String::from("selectionCorrection"),
                default_correction_shortcut()
            )
        );
        assert_eq!(
            selection(json!({ "hotkeys": {
                "selectionCorrection": "Ctrl+Alt+K",
                "translate.0": "Ctrl+Alt+1"
            } })),
            (
                String::from("selectionCorrection"),
                Some(String::from("Ctrl+Alt+K"))
            )
        );
        assert_eq!(
            selection(json!({ "hotkeys": { "selectionCorrection": " " } })).1,
            None
        );
    }

    #[test]
    fn does_not_bind_config_mode() {
        let bindings = bindings_from_config(&json!({
            "hotkeys": { "config": "Ctrl+Alt+Comma" }
        }));
        assert!(bindings
            .iter()
            .all(|binding| binding.target != HotkeyTarget::Mode(ActivationMode::Config)));
    }

    #[test]
    fn binds_history_mode_when_configured() {
        let bindings = bindings_from_config(&json!({
            "hotkeys": { "history": "Ctrl+Alt+H" }
        }));
        let history_binding = bindings
            .iter()
            .find(|binding| binding.target == HotkeyTarget::Mode(ActivationMode::History))
            .expect("history binding present");
        assert_eq!(history_binding.shortcut.as_deref(), Some("Ctrl+Alt+H"));
    }

    #[test]
    fn restores_refused_shortcuts_from_the_previous_config() {
        let previous = json!({
            "hotkeys": { "voice": "Ctrl+Alt+V", "selectionActions": "Ctrl+Alt+Q" }
        });
        let mut next = json!({
            "hotkeys": {
                "voice": "Ctrl+Alt+X",
                "chat": "Ctrl+Alt+C",
                "selectionActions": "Ctrl+Alt+W"
            }
        });
        for target in [
            HotkeyTarget::Mode(ActivationMode::Voice),
            HotkeyTarget::Mode(ActivationMode::Chat),
            HotkeyTarget::ActionPage(0),
        ] {
            restore_config_shortcut(&mut next, &previous, &target);
        }
        assert_eq!(
            next["hotkeys"],
            json!({ "voice": "Ctrl+Alt+V", "selectionActions": "Ctrl+Alt+Q" })
        );
    }

    #[test]
    fn modes_open_with_their_cli_spelling() {
        assert_eq!(
            HotkeyTarget::Mode(ActivationMode::VoiceChat).cli_command(),
            "tyco-ctl open voice-chat"
        );
    }

    #[test]
    fn targets_open_with_their_cli_spelling() {
        assert_eq!(
            HotkeyTarget::InlineCorrection.cli_command(),
            "tyco-ctl replace correction"
        );
        assert_eq!(
            HotkeyTarget::ActionPage(0).cli_command(),
            "tyco-ctl open selection-actions"
        );
        assert_eq!(
            HotkeyTarget::ActionPage(1).cli_command(),
            "tyco --mode=selectionActions:2"
        );
    }

    #[test]
    fn parses_hotkey_targets() {
        assert_eq!(
            HotkeyTarget::parse("editor").unwrap(),
            HotkeyTarget::Mode(ActivationMode::Editor)
        );
        let target = HotkeyTarget::parse("selectionCorrection").unwrap();
        assert_eq!(target, HotkeyTarget::InlineCorrection);
        assert_eq!(target.id(), "selectionCorrection");
        // commands have no hotkeys
        assert!(HotkeyTarget::parse("replace.command:task-fix").is_err());
        assert!(HotkeyTarget::parse("replace.aiTask.2").is_err());
        assert!(HotkeyTarget::parse("replace.translate.0").is_err());
        assert!(HotkeyTarget::parse("replace.bogus").is_err());
        assert!(HotkeyTarget::parse("bogus").is_err());
        let page1 = HotkeyTarget::parse("selectionActions").unwrap();
        assert_eq!(page1, HotkeyTarget::ActionPage(0));
        assert_eq!(page1.id(), "selectionActions");
        let page2 = HotkeyTarget::parse("selectionActionsPage2").unwrap();
        assert_eq!(page2, HotkeyTarget::ActionPage(1));
        assert_eq!(page2.id(), "selectionActionsPage2");
        let page3 = HotkeyTarget::parse("selectionActionsPage3").unwrap();
        assert_eq!(page3, HotkeyTarget::ActionPage(2));
        assert_eq!(page3.id(), "selectionActionsPage3");
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
            global_target("translation"),
            Some(HotkeyTarget::Mode(ActivationMode::Translation))
        );
        assert_eq!(
            global_target("styling"),
            Some(HotkeyTarget::Mode(ActivationMode::Styling))
        );
        assert_eq!(
            global_target("transformation"),
            Some(HotkeyTarget::Mode(ActivationMode::Transformation))
        );
        assert_eq!(
            global_target("selectionCorrection"),
            Some(HotkeyTarget::InlineCorrection)
        );
        assert_eq!(
            global_target("history"),
            Some(HotkeyTarget::Mode(ActivationMode::History))
        );
        assert_eq!(global_target("config"), None);
        assert_eq!(global_target("replace.translate.0"), None);
        assert_eq!(global_target("bogus"), None);
    }
}
