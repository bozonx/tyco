pub(crate) mod coordinator;
mod metric_mark;
/// Timings of activations for `examples/activation-bench.rs`: a socket that
/// starts activations and returns what was typed, so it is built only with
/// the `activation-bench` feature.
#[cfg(feature = "activation-bench")]
pub mod metrics;
#[cfg(not(feature = "activation-bench"))]
#[path = "activation/metrics_off.rs"]
pub mod metrics;
pub mod socket;

use serde_json::Value;

use crate::errors::AppError;
use crate::models::user_config::{self, ActionInputMode};
pub use crate::models::{AccessRequest, ActivationMode, WindowProfile};

/// Logical size of every activated window; keep it in sync with the windows in
/// `tauri.conf.json`. The quick input panel draws only its input field and
/// lets clicks through the rest of the window.
pub const WINDOW_SIZE: (f64, f64) = (930.0, 600.0);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ActivationSource {
    Hotkey,
    Dbus,
    Cli,
    Ui,
}

const SELECTION_ACTIONS_MODE_PREFIX: &str = "selectionActions:";

#[derive(Debug)]
pub struct Activation {
    pub mode: ActivationMode,
    pub source: ActivationSource,
    pub target_window_id: Option<String>,
    pub selected_text: Option<String>,
    /// The page of `actionPages` the action menu opens on; `None` or 0 for the first one.
    pub action_page_index: Option<usize>,
    /// The source the history opens filtered by; only for `History`.
    pub history_origin: Option<crate::models::EditorHistoryOrigin>,
    /// What the access prompt asks about, see `services::external::access`.
    pub access_request: Option<AccessRequest>,
}

impl Activation {
    pub fn new(mode: ActivationMode, source: ActivationSource) -> Self {
        Self {
            mode,
            source,
            target_window_id: None,
            selected_text: None,
            action_page_index: None,
            history_origin: None,
            access_request: None,
        }
    }

    pub fn selection_actions(page_index: usize, source: ActivationSource) -> Self {
        let mut activation = Self::new(ActivationMode::SelectionActions, source);
        activation.action_page_index = Some(page_index);
        activation
    }

    /// A mode, or `selectionActions:<page 1-based index>` for an action page.
    pub fn from_mode(value: &str, source: ActivationSource) -> Result<Self, AppError> {
        let rest = value
            .strip_prefix(SELECTION_ACTIONS_MODE_PREFIX)
            .or_else(|| value.strip_prefix("selection-actions:"));
        if let Some(rest) = rest {
            if let Ok(page_num) = rest.parse::<usize>() {
                let page_index = if page_num > 0 { page_num - 1 } else { 0 };
                return Ok(Self::selection_actions(page_index, source));
            }
            return Err(AppError::InvalidInput("Invalid action page".into()));
        }
        Ok(Self::new(ActivationMode::parse(value)?, source))
    }

    /// The mode string that opens the action menu on `page_index` (0-based).
    pub fn action_page_mode(page_index: usize) -> String {
        format!("{SELECTION_ACTIONS_MODE_PREFIX}{}", page_index + 1)
    }

    /// Whether the activation takes the selection of the window it was made
    /// from: not an action page the user set to run without text,
    /// see `actionPages[].inputMode` of the config. The first page always takes text.
    pub fn can_take_selection(&self, user_config: &Value) -> bool {
        if self.mode == ActivationMode::VoiceCommands || self.mode == ActivationMode::Snippets {
            return false;
        }
        if self.mode != ActivationMode::SelectionActions {
            return true;
        }
        let index = self.action_page_index.unwrap_or(0);
        if index == 0 {
            return true;
        }
        let pages = user_config::action_pages(user_config);
        pages
            .get(index)
            .is_none_or(|page| page.input_mode != ActionInputMode::None)
    }

    /// Whether this activation confirms the voice input it would open, instead
    /// of starting it anew: the hotkey, D-Bus call or `tyco-ctl` call that
    /// opened a voice input also finishes it, as Space or Enter does. A call
    /// that brings its own text asks for a new input.
    pub fn finishes_open_voice_input(
        &self,
        open_mode: Option<ActivationMode>,
        is_window_shown: bool,
    ) -> bool {
        matches!(
            self.mode,
            ActivationMode::Voice | ActivationMode::VoiceChat | ActivationMode::VoiceCommands
        ) && self.source != ActivationSource::Ui
            && self.selected_text.is_none()
            && is_window_shown
            && open_mode == Some(self.mode)
    }

    /// Accept a positional mode, --mode MODE, or --mode=MODE after argv[0].
    pub fn from_args(args: &[String]) -> Result<Option<Self>, AppError> {
        let values = &args[args.len().min(1)..];
        let mode = match values {
            [] => return Ok(None),
            [flag, mode] if flag == "--mode" => mode.as_str(),
            [value] => value.strip_prefix("--mode=").unwrap_or(value),
            _ => {
                return Err(AppError::InvalidInput(
                    "Expected a single activation mode".into(),
                ))
            }
        };
        Ok(Some(Self::from_mode(mode, ActivationSource::Cli)?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn an_action_page_set_without_text_takes_no_selection_unless_first_page() {
        let config = json!({ "actionPages": [{"inputMode":"selection"},{"inputMode":"none"},{"inputMode":"selection"}] });
        let page = |mode: &str| Activation::from_mode(mode, ActivationSource::Ui).unwrap();
        assert!(!page("voiceCommands").can_take_selection(&config));
        // First page always takes selection
        assert!(page("selectionActions").can_take_selection(&config));
        assert!(page("selectionActions:1").can_take_selection(&config));
        // Second page is none
        assert!(!page("selectionActions:2").can_take_selection(&config));
        // Third page is selection
        assert!(page("selectionActions:3").can_take_selection(&config));
        assert!(page("translation").can_take_selection(&config));
    }

    #[test]
    fn a_repeated_external_activation_finishes_the_open_voice_input() {
        use ActivationMode::{Chat, Voice, VoiceChat, VoiceCommands};
        for mode in [Voice, VoiceChat, VoiceCommands] {
            for source in [
                ActivationSource::Hotkey,
                ActivationSource::Dbus,
                ActivationSource::Cli,
            ] {
                let activation = Activation::new(mode, source);
                assert!(activation.finishes_open_voice_input(Some(mode), true));
                assert!(!activation.finishes_open_voice_input(Some(mode), false));
                assert!(!activation.finishes_open_voice_input(Some(Chat), true));
                assert!(!activation.finishes_open_voice_input(None, true));
            }
            let from_ui = Activation::new(mode, ActivationSource::Ui);
            assert!(!from_ui.finishes_open_voice_input(Some(mode), true));
            let mut with_text = Activation::new(mode, ActivationSource::Dbus);
            with_text.selected_text = Some("text".into());
            assert!(!with_text.finishes_open_voice_input(Some(mode), true));
        }
        let chat = Activation::new(Chat, ActivationSource::Hotkey);
        assert!(!chat.finishes_open_voice_input(Some(Chat), true));
        let voice = Activation::new(Voice, ActivationSource::Hotkey);
        assert!(!voice.finishes_open_voice_input(Some(VoiceChat), true));
    }

    #[test]
    fn action_pages_parse_with_action_page_index() {
        let activation = Activation::from_mode("selectionActions:2", ActivationSource::Ui).unwrap();
        assert_eq!(activation.mode, ActivationMode::SelectionActions);
        assert_eq!(activation.action_page_index, Some(1));
        assert_eq!(Activation::action_page_mode(1), "selectionActions:2");
        assert!(Activation::from_mode("selectionActions:abc", ActivationSource::Ui).is_err());
        assert_eq!(
            Activation::from_mode("selectionActions", ActivationSource::Ui)
                .unwrap()
                .action_page_index,
            None
        );
    }

    #[test]
    fn modes_round_trip() {
        for value in [
            "editor",
            "quickInput",
            "chat",
            "voiceChat",
            "voice",
            "selectionActions",
            "correction",
            "translation",
            "history",
            "config",
        ] {
            let mode = ActivationMode::parse(value).unwrap();
            assert_eq!(mode.as_str(), value);
        }
        assert!(ActivationMode::parse("unknown").is_err());
    }

    #[test]
    fn activation_protocol_has_the_same_modes() {
        assert_eq!(
            ActivationMode::PUBLIC_MODES
                .map(ActivationMode::as_str)
                .as_slice(),
            tyco_activation_protocol::START_MODES
        );
    }

    #[test]
    fn selects_geometry_profile() {
        assert_eq!(ActivationMode::QuickInput.profile(), WindowProfile::Panel);
        assert_eq!(ActivationMode::Voice.profile(), WindowProfile::Panel);
        for mode in [
            ActivationMode::Editor,
            ActivationMode::SelectionActions,
            ActivationMode::Correction,
            ActivationMode::Translation,
            ActivationMode::Styling,
            ActivationMode::Transformation,
            ActivationMode::QuickAiRequest,
            ActivationMode::VoiceQuickAiRequest,
            ActivationMode::ChatPrompts,
            ActivationMode::Chat,
            ActivationMode::VoiceChat,
            ActivationMode::History,
            ActivationMode::Config,
        ] {
            assert_eq!(mode.profile(), WindowProfile::Sheet);
        }
    }

    #[test]
    fn parses_cli_forms_and_rejects_invalid_arguments() {
        for args in [
            vec!["tyco", "chat"],
            vec!["tyco", "--mode", "chat"],
            vec!["tyco", "--mode=chat"],
        ] {
            let args = args.into_iter().map(String::from).collect::<Vec<_>>();
            let activation = Activation::from_args(&args).unwrap().unwrap();
            assert_eq!(activation.mode, ActivationMode::Chat);
            assert_eq!(activation.source, ActivationSource::Cli);
        }
        assert!(Activation::from_args(&["tyco".into()]).unwrap().is_none());
        for args in [
            vec!["tyco", "--mode"],
            vec!["tyco", "bad"],
            vec!["tyco", "chat", "extra"],
        ] {
            let args = args.into_iter().map(String::from).collect::<Vec<_>>();
            assert!(Activation::from_args(&args).is_err());
        }
    }
}
