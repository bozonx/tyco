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
use crate::models::user_config::{self, LauncherInputMode};
pub use crate::models::{AccessRequest, ActivationMode, LauncherRequest, WindowProfile};

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

const LAUNCHER_PAGE_MODE_PREFIX: &str = "commandLauncher:";

#[derive(Debug)]
pub struct Activation {
    pub mode: ActivationMode,
    pub source: ActivationSource,
    pub target_window_id: Option<String>,
    pub selected_text: Option<String>,
    /// The page of `launcherPages` the command overlay opens on; `None` for
    /// the first one.
    pub launcher_page_id: Option<String>,
    pub launcher_request: Option<LauncherRequest>,
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
            launcher_page_id: None,
            launcher_request: None,
            access_request: None,
        }
    }

    /// A mode, or `commandLauncher:<page id>` for a page of the command
    /// overlay.
    pub fn from_mode(value: &str, source: ActivationSource) -> Result<Self, AppError> {
        if let Some(page_id) = value.strip_prefix(LAUNCHER_PAGE_MODE_PREFIX) {
            if page_id.trim().is_empty() {
                return Err(AppError::InvalidInput("Invalid command page".into()));
            }
            let mut activation = Self::new(ActivationMode::CommandLauncher, source);
            activation.launcher_page_id = Some(page_id.to_owned());
            return Ok(activation);
        }
        Ok(Self::new(ActivationMode::parse(value)?, source))
    }

    /// The mode string that opens the command overlay on `page_id`.
    pub fn launcher_page_mode(page_id: &str) -> String {
        format!("{LAUNCHER_PAGE_MODE_PREFIX}{page_id}")
    }

    /// Whether the activation takes the selection of the window it was made
    /// from: not a page of the command overlay the user set to run without
    /// text, see `launcherPages[].inputMode` of the config.
    pub fn can_take_selection(&self, user_config: &Value) -> bool {
        if self.mode == ActivationMode::VoiceCommands {
            return false;
        }
        if self.mode != ActivationMode::CommandLauncher || self.launcher_request.is_some() {
            return true;
        }
        let pages = user_config::launcher_pages(user_config);
        let page = match &self.launcher_page_id {
            Some(id) => pages.iter().find(|page| page.id == *id),
            None => pages.first(),
        };
        page.is_none_or(|page| page.input_mode != LauncherInputMode::None)
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
    fn a_command_page_set_without_text_takes_no_selection() {
        let config = json!({ "launcherPages": [{"id":"main","inputMode":"none"},{"id":"second","inputMode":"selection"},{"id":"third","inputMode":"none"}] });
        let page = |mode: &str| Activation::from_mode(mode, ActivationSource::Ui).unwrap();
        assert!(!page("voiceCommands").can_take_selection(&config));
        assert!(!page("commandLauncher").can_take_selection(&config));
        assert!(page("commandLauncher:second").can_take_selection(&config));
        assert!(!page("commandLauncher:third").can_take_selection(&config));
        assert!(page("commandLauncher:third").can_take_selection(&json!({})));
        assert!(page("commandLauncher:removed").can_take_selection(&config));
        assert!(page("translate").can_take_selection(&config));
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
    fn command_pages_parse_without_changing_the_overlay_mode() {
        let activation =
            Activation::from_mode("commandLauncher:work", ActivationSource::Ui).unwrap();
        assert_eq!(activation.mode, ActivationMode::CommandLauncher);
        assert_eq!(activation.launcher_page_id.as_deref(), Some("work"));
        assert_eq!(
            Activation::launcher_page_mode("work"),
            "commandLauncher:work"
        );
        assert!(Activation::from_mode("commandLauncher:", ActivationSource::Ui).is_err());
        assert!(Activation::from_mode("commandLauncher2", ActivationSource::Ui).is_err());
        assert_eq!(
            Activation::from_mode("commandLauncher", ActivationSource::Ui)
                .unwrap()
                .launcher_page_id,
            None
        );
    }

    #[test]
    fn modes_round_trip() {
        for value in [
            "editor",
            "write",
            "chat",
            "voiceChat",
            "voice",
            "select",
            "aiTasks",
            "commandLauncher",
            "correction",
            "translate",
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
        assert_eq!(ActivationMode::Write.profile(), WindowProfile::Panel);
        assert_eq!(ActivationMode::Voice.profile(), WindowProfile::Panel);
        for mode in [
            ActivationMode::Editor,
            ActivationMode::Select,
            ActivationMode::AiTasks,
            ActivationMode::CommandLauncher,
            ActivationMode::Correction,
            ActivationMode::Translate,
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
