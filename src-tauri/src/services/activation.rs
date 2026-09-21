use crate::errors::AppError;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StartMode {
    Editor,
    Write,
    Chat,
    Voice,
    Select,
    AiTasks,
    History,
    Config,
}

impl StartMode {
    pub const ALL: [Self; 8] = [
        Self::Editor,
        Self::Write,
        Self::Chat,
        Self::Voice,
        Self::Select,
        Self::AiTasks,
        Self::History,
        Self::Config,
    ];

    pub fn parse(value: &str) -> Result<Self, AppError> {
        match value {
            "editor" => Ok(Self::Editor),
            "write" => Ok(Self::Write),
            "chat" => Ok(Self::Chat),
            "voice" => Ok(Self::Voice),
            "select" => Ok(Self::Select),
            "aiTasks" => Ok(Self::AiTasks),
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
            Self::Voice => "voice",
            Self::Select => "select",
            Self::AiTasks => "aiTasks",
            Self::History => "history",
            Self::Config => "config",
        }
    }
    pub fn profile(self) -> WindowProfile {
        match self {
            Self::Chat | Self::History | Self::Config => WindowProfile::Sheet,
            _ => WindowProfile::Panel,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WindowProfile {
    Panel,
    Sheet,
}

impl WindowProfile {
    pub fn size(self) -> (f64, f64) {
        match self {
            // The panel keeps the current UI minimums until task 7.
            Self::Panel => (800.0, 600.0),
            Self::Sheet => (1000.0, 800.0),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ActivationIntent {
    KeyboardFirst,
    ContextFirst,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ActivationSource {
    // Reserved for the in-process providers introduced in task 4.
    #[allow(dead_code)]
    Hotkey,
    Dbus,
    Cli,
    Tray,
}

#[derive(Debug)]
pub struct Activation {
    pub mode: StartMode,
    pub intent: ActivationIntent,
    pub source: ActivationSource,
    pub window_id: Option<String>,
    pub selected_text: Option<String>,
}

impl Activation {
    pub fn new(mode: StartMode, source: ActivationSource) -> Self {
        Self {
            mode,
            intent: match mode {
                StartMode::Editor
                | StartMode::Write
                | StartMode::Chat
                | StartMode::History
                | StartMode::Config => ActivationIntent::KeyboardFirst,
                _ => ActivationIntent::ContextFirst,
            },
            source,
            window_id: None,
            selected_text: None,
        }
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
        Ok(Some(Self::new(
            StartMode::parse(mode)?,
            ActivationSource::Cli,
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modes_round_trip_and_select_intent() {
        for value in [
            "editor", "write", "chat", "voice", "select", "aiTasks", "history", "config",
        ] {
            let mode = StartMode::parse(value).unwrap();
            assert_eq!(mode.as_str(), value);
            assert_eq!(
                Activation::new(mode, ActivationSource::Dbus).intent,
                if ["editor", "write", "chat", "history", "config"].contains(&value) {
                    ActivationIntent::KeyboardFirst
                } else {
                    ActivationIntent::ContextFirst
                }
            );
        }
        assert!(StartMode::parse("unknown").is_err());
    }

    #[test]
    fn selects_geometry_profile() {
        assert_eq!(StartMode::Editor.profile(), WindowProfile::Panel);
        assert_eq!(StartMode::Voice.profile(), WindowProfile::Panel);
        for mode in [StartMode::Chat, StartMode::History, StartMode::Config] {
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
