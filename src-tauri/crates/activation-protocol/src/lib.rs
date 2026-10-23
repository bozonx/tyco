use serde::{Deserialize, Serialize};

pub mod transport;

pub const API_VERSION: u32 = 2;
/// Room for the text of a command and the list of commands.
pub const MAX_MESSAGE_BYTES: usize = 1024 * 1024;
pub const START_MODES: &[&str] = &[
    "editor",
    "quickInput",
    "chat",
    "voiceChat",
    "voiceCommands",
    "voice",
    "selectionActions",
    "aiTasks",
    "commandLauncher",
    "correction",
    "translation",
    "history",
    "config",
];

pub fn canonical_mode(value: &str) -> &str {
    match value {
        "quick-input" => "quickInput",
        "selection-actions" => "selectionActions",
        "voice-commands" => "voiceCommands",
        "voice-chat" => "voiceChat",
        "ai-tasks" => "aiTasks",
        "command-launcher" => "commandLauncher",
        "settings" => "config",
        _ => value,
    }
}

/// The spelling of a mode the CLI documents, e.g. `voice-chat` for
/// `voiceChat`; the inverse of `canonical_mode`.
pub fn cli_mode(mode: &str) -> &str {
    match mode {
        "quickInput" => "quick-input",
        "selectionActions" => "selection-actions",
        "voiceCommands" => "voice-commands",
        "voiceChat" => "voice-chat",
        "aiTasks" => "ai-tasks",
        "commandLauncher" => "command-launcher",
        "config" => "settings",
        _ => mode,
    }
}

pub fn is_start_mode(value: &str) -> bool {
    START_MODES.contains(&canonical_mode(value))
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "command", rename_all = "camelCase", deny_unknown_fields)]
pub enum Request {
    /// The commands that may be run from outside.
    ListCommands,
    Status,
    Open {
        mode: String,
        #[serde(default)]
        text: Option<String>,
        #[serde(default)]
        selection: bool,
    },
    DescribeCommand {
        target: String,
        #[serde(default)]
        by_name: bool,
    },
    Run {
        request: RunRequest,
    },
    /// Replaces the selection of the focused window with the result of a
    /// built-in action, as its hotkey does; only `correction` exists.
    ReplaceSelection {
        action: String,
    },
    ListJobs,
    JobStatus {
        id: String,
    },
    JobCancel {
        id: String,
    },
}

/// The machine codes of failed requests and jobs. They are stable: scripts
/// and D-Bus error names (`org.tyco.Error.<code>`) depend on them.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ErrorCode {
    /// A request or its input the API cannot take.
    InvalidInput,
    /// The frame was not a request of this protocol.
    InvalidRequest,
    /// The command needs input the call did not give.
    InputRequired,
    /// More than one command has the name.
    AmbiguousName,
    AccessDenied,
    NotFound,
    Disabled,
    /// The app, or what the command needs, cannot serve the request now.
    Unavailable,
    /// The quick window has not reported its tools yet.
    NotReady,
    Busy,
    SelectionFailed,
    OutputTooLarge,
    ExecutionFailed,
    /// The command changed in the settings while it waited.
    ConfigurationChanged,
    TimedOut,
    Cancelled,
    Failed,
}

impl ErrorCode {
    pub const ALL: [Self; 17] = [
        Self::InvalidInput,
        Self::InvalidRequest,
        Self::InputRequired,
        Self::AmbiguousName,
        Self::AccessDenied,
        Self::NotFound,
        Self::Disabled,
        Self::Unavailable,
        Self::NotReady,
        Self::Busy,
        Self::SelectionFailed,
        Self::OutputTooLarge,
        Self::ExecutionFailed,
        Self::ConfigurationChanged,
        Self::TimedOut,
        Self::Cancelled,
        Self::Failed,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::InvalidInput => "InvalidInput",
            Self::InvalidRequest => "InvalidRequest",
            Self::InputRequired => "InputRequired",
            Self::AmbiguousName => "AmbiguousName",
            Self::AccessDenied => "AccessDenied",
            Self::NotFound => "NotFound",
            Self::Disabled => "Disabled",
            Self::Unavailable => "Unavailable",
            Self::NotReady => "NotReady",
            Self::Busy => "Busy",
            Self::SelectionFailed => "SelectionFailed",
            Self::OutputTooLarge => "OutputTooLarge",
            Self::ExecutionFailed => "ExecutionFailed",
            Self::ConfigurationChanged => "ConfigurationChanged",
            Self::TimedOut => "TimedOut",
            Self::Cancelled => "Cancelled",
            Self::Failed => "Failed",
        }
    }

    /// `None` for a code this version does not know, e.g. from a newer app.
    pub fn parse(code: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|known| known.as_str() == code)
    }

    /// The exit status `tyco-ctl` ends with on this code.
    pub fn exit_code(self) -> i32 {
        match self {
            Self::InvalidInput
            | Self::InvalidRequest
            | Self::InputRequired
            | Self::AmbiguousName => 2,
            Self::AccessDenied => 3,
            Self::NotFound | Self::Unavailable | Self::NotReady | Self::Disabled | Self::Busy => 4,
            Self::TimedOut => 6,
            Self::Cancelled => 7,
            Self::SelectionFailed
            | Self::OutputTooLarge
            | Self::ExecutionFailed
            | Self::ConfigurationChanged
            | Self::Failed => 5,
        }
    }
}

impl From<ErrorCode> for String {
    fn from(code: ErrorCode) -> Self {
        code.as_str().to_owned()
    }
}

impl std::fmt::Display for ErrorCode {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// An `ErrorCode`; kept as text so that a code of a newer app still reads.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    /// What the request asked for, e.g. the list of commands or a job.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunRequest {
    pub target: String,
    #[serde(default)]
    pub by_name: bool,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub input: Option<serde_json::Map<String, serde_json::Value>>,
    #[serde(default)]
    pub interactive: bool,
    #[serde(default)]
    pub selection: bool,
    #[serde(default)]
    pub replace: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(rename = "ExternalJobState"))]
#[serde(rename_all = "camelCase")]
pub enum JobState {
    Accepted,
    Running,
    Succeeded,
    Failed,
    Cancelled,
}

impl JobState {
    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Succeeded | Self::Failed | Self::Cancelled)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(rename = "ExternalJob"))]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub command_id: String,
    pub state: JobState,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub code: Option<String>,
}

impl Response {
    pub fn coded_error(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            success: false,
            error: Some(message.into()),
            code: Some(code.as_str().into()),
            result: None,
        }
    }

    /// The code of a failed response; `Failed` when it has none this version
    /// knows.
    pub fn error_code(&self) -> ErrorCode {
        self.code
            .as_deref()
            .and_then(ErrorCode::parse)
            .unwrap_or(ErrorCode::Failed)
    }

    pub fn json(value: &impl Serialize) -> Self {
        match serde_json::to_value(value) {
            Ok(result) => Self {
                result: Some(result),
                ..Self::success()
            },
            Err(error) => Self::error(error.to_string()),
        }
    }

    pub fn success() -> Self {
        Self {
            success: true,
            error: None,
            code: None,
            result: None,
        }
    }

    pub fn error(error: impl Into<String>) -> Self {
        Self::coded_error(ErrorCode::Failed, error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cli_spellings_of_modes_round_trip() {
        for mode in START_MODES {
            assert_eq!(canonical_mode(cli_mode(mode)), *mode);
            assert!(!cli_mode(mode).chars().any(char::is_uppercase), "{mode}");
        }
    }

    #[test]
    fn rejects_removed_protocol_requests() {
        for request in [
            r#"{"command":"quit"}"#,
            r#"{"command":"activate","mode":"editor"}"#,
            r#"{"command":"runCommand","target":"test"}"#,
            r#"{"command":"replace","action":"command:test"}"#,
        ] {
            assert!(serde_json::from_str::<Request>(request).is_err());
        }
    }

    #[test]
    fn requests_round_trip() {
        for request in [
            Request::Open {
                mode: "editor".into(),
                text: None,
                selection: false,
            },
            Request::Run {
                request: RunRequest {
                    target: "backup".into(),
                    ..Default::default()
                },
            },
            Request::ListCommands,
            Request::ReplaceSelection {
                action: "correction".into(),
            },
            Request::ListJobs,
        ] {
            let encoded = serde_json::to_string(&request).unwrap();
            let decoded: Request = serde_json::from_str(&encoded).unwrap();
            assert_eq!(decoded, request);
        }
    }

    #[test]
    fn error_codes_round_trip_and_unknown_ones_read_as_failed() {
        for code in ErrorCode::ALL {
            assert_eq!(ErrorCode::parse(code.as_str()), Some(code));
            assert_eq!(Response::coded_error(code, "x").error_code(), code);
        }
        let newer = Response {
            code: Some("FromTheFuture".into()),
            ..Response::error("x")
        };
        assert_eq!(newer.error_code(), ErrorCode::Failed);
    }

    #[test]
    fn a_response_carries_its_result_as_json() {
        let encoded = serde_json::to_string(&Response::json(&serde_json::json!([]))).unwrap();
        assert_eq!(encoded, r#"{"success":true,"result":[]}"#);
        let decoded: Response = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded.result, Some(serde_json::json!([])));
        let empty: Response = serde_json::from_str(r#"{"success":true}"#).unwrap();
        assert_eq!(empty, Response::success());
    }
}
