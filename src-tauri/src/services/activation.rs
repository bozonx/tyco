use crate::errors::AppError;
use crate::services::external_commands::LauncherRequest;

#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq)]
pub enum StartMode {
    Editor,
    Write,
    Chat,
    VoiceChat,
    Voice,
    Select,
    AiTasks,
    CommandLauncher,
    Correction,
    Translate,
    History,
    Config,
}

impl StartMode {
    #[allow(dead_code)]
    pub const ALL: [Self; 12] = [
        Self::Editor,
        Self::Write,
        Self::Chat,
        Self::VoiceChat,
        Self::Voice,
        Self::Select,
        Self::AiTasks,
        Self::CommandLauncher,
        Self::Correction,
        Self::Translate,
        Self::History,
        Self::Config,
    ];

    pub fn parse(value: &str) -> Result<Self, AppError> {
        match tyco_activation_protocol::canonical_mode(value) {
            "editor" => Ok(Self::Editor),
            "write" => Ok(Self::Write),
            "chat" => Ok(Self::Chat),
            "voiceChat" => Ok(Self::VoiceChat),
            "voice" => Ok(Self::Voice),
            "select" => Ok(Self::Select),
            "aiTasks" => Ok(Self::AiTasks),
            "commandLauncher" => Ok(Self::CommandLauncher),
            "correction" => Ok(Self::Correction),
            "translate" => Ok(Self::Translate),
            "history" => Ok(Self::History),
            "config" => Ok(Self::Config),
            _ => Err(AppError::Message(format!(
                "Unknown activation mode: {value}"
            ))),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Editor => "editor",
            Self::Write => "write",
            Self::Chat => "chat",
            Self::VoiceChat => "voiceChat",
            Self::Voice => "voice",
            Self::Select => "select",
            Self::AiTasks => "aiTasks",
            Self::CommandLauncher => "commandLauncher",
            Self::Correction => "correction",
            Self::Translate => "translate",
            Self::History => "history",
            Self::Config => "config",
        }
    }
    pub fn profile(self) -> WindowProfile {
        match self {
            // the dictation bar leaves the screen above it in view
            Self::Write | Self::Voice => WindowProfile::Panel,
            _ => WindowProfile::Sheet,
        }
    }
}

/// Where the window is placed. Its size never depends on it: every activation
/// uses `WINDOW_SIZE`, so the window is never resized while it is shown.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WindowProfile {
    /// Anchored to the bottom of the screen.
    Panel,
    /// Centered on the screen.
    Sheet,
}

/// Logical size of every activated window; keep it in sync with the windows in
/// `tauri.conf.json`. The quick input panel draws only its input field and
/// lets clicks through the rest of the window.
pub const WINDOW_SIZE: (f64, f64) = (930.0, 600.0);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ActivationSource {
    // Reserved for the in-process providers introduced in task 4.
    #[allow(dead_code)]
    Hotkey,
    Dbus,
    Cli,
    Ui,
}

#[derive(Debug)]
pub struct Activation {
    pub mode: StartMode,
    pub source: ActivationSource,
    pub window_id: Option<String>,
    pub selected_text: Option<String>,
    /// The command the command overlay opens with, for an external call.
    pub launcher_page: usize,
    pub launcher_request: Option<LauncherRequest>,
}

impl Activation {
    pub fn new(mode: StartMode, source: ActivationSource) -> Self {
        Self {
            mode,
            source,
            window_id: None,
            selected_text: None,
            launcher_page: 0,
            launcher_request: None,
        }
    }

    pub fn from_mode(value: &str, source: ActivationSource) -> Result<Self, AppError> {
        if let Some(page) = value
            .strip_prefix("commandLauncher")
            .filter(|page| !page.is_empty())
        {
            let page = page
                .parse::<usize>()
                .ok()
                .filter(|page| *page > 0)
                .ok_or_else(|| AppError::Message("Invalid command page".into()))?;
            let mut activation = Self::new(StartMode::CommandLauncher, source);
            activation.launcher_page = page - 1;
            return Ok(activation);
        }
        Ok(Self::new(StartMode::parse(value)?, source))
    }

    /// Accept a positional mode, --mode MODE, or --mode=MODE after argv[0].
    pub fn from_args(args: &[String]) -> Result<Option<Self>, AppError> {
        let values = &args[args.len().min(1)..];
        let mode = match values {
            [] => return Ok(None),
            [flag, mode] if flag == "--mode" => mode.as_str(),
            [value] => value.strip_prefix("--mode=").unwrap_or(value),
            _ => {
                return Err(AppError::Message(
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

    #[test]
    fn command_pages_parse_without_changing_the_overlay_mode() {
        let activation = Activation::from_mode("commandLauncher5", ActivationSource::Ui).unwrap();
        assert_eq!(activation.mode, StartMode::CommandLauncher);
        assert_eq!(activation.launcher_page, 4);
        assert!(Activation::from_mode("commandLauncher0", ActivationSource::Ui).is_err());
        assert_eq!(
            Activation::from_mode("commandLauncher42", ActivationSource::Ui)
                .unwrap()
                .launcher_page,
            41
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
            let mode = StartMode::parse(value).unwrap();
            assert_eq!(mode.as_str(), value);
        }
        assert!(StartMode::parse("unknown").is_err());
    }

    #[test]
    fn activation_protocol_has_the_same_modes() {
        assert_eq!(
            StartMode::ALL.map(StartMode::as_str).as_slice(),
            tyco_activation_protocol::START_MODES
        );
    }

    #[test]
    fn selects_geometry_profile() {
        assert_eq!(StartMode::Write.profile(), WindowProfile::Panel);
        assert_eq!(StartMode::Voice.profile(), WindowProfile::Panel);
        for mode in [
            StartMode::Editor,
            StartMode::Select,
            StartMode::AiTasks,
            StartMode::CommandLauncher,
            StartMode::Correction,
            StartMode::Translate,
            StartMode::Chat,
            StartMode::VoiceChat,
            StartMode::History,
            StartMode::Config,
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
            assert_eq!(activation.mode, StartMode::Chat);
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
