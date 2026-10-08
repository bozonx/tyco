use std::io::{self, BufRead, Read, Write};

use serde::{Deserialize, Serialize};

pub mod transport;

pub const API_VERSION: u32 = 1;
/// Room for the text of a command and the list of commands.
pub const MAX_MESSAGE_BYTES: usize = 1024 * 1024;
pub const START_MODES: &[&str] = &[
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
];

pub fn canonical_mode(value: &str) -> &str {
    match value {
        "voice-chat" => "voiceChat",
        "ai-tasks" => "aiTasks",
        "command-launcher" => "commandLauncher",
        "settings" => "config",
        _ => value,
    }
}

pub fn is_start_mode(value: &str) -> bool {
    START_MODES.contains(&canonical_mode(value))
}

/// Prefix of the selection action that runs a command of the library.
pub const COMMAND_ACTION_PREFIX: &str = "command:";

/// Actions that replace the selection in the focused window with their
/// result: `correction`, `translate.<slot>` and `aiTask.<slot>`, where the
/// slot indexes the configured translation languages or AI tasks, and
/// `command:<id>`, a command of the library that returns a text.
pub fn is_selection_action(value: &str) -> bool {
    if value == "correction" {
        return true;
    }
    if let Some(id) = value.strip_prefix(COMMAND_ACTION_PREFIX) {
        return !id.trim().is_empty();
    }
    let Some((kind, slot)) = value.split_once('.') else {
        return false;
    };
    matches!(kind, "translate" | "aiTask")
        && !slot.is_empty()
        && slot.len() <= 3
        && slot.bytes().all(|byte| byte.is_ascii_digit())
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "command", rename_all = "camelCase", deny_unknown_fields)]
pub enum Request {
    Replace {
        action: String,
    },
    /// The commands that may be run from outside, as JSON.
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
    JobStatus {
        id: String,
    },
    JobCancel {
        id: String,
    },
    /// Quits the application gracefully.
    Quit,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    /// What the request asked for, e.g. the JSON list of commands.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
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
    #[serde(default)]
    pub output: OutputMode,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OutputMode {
    #[default]
    Return,
    Configured,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
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
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub command_id: String,
    pub state: JobState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

impl Response {
    pub fn coded_error(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            success: false,
            error: Some(message.into()),
            code: Some(code.into()),
            output: None,
        }
    }
    pub fn json(value: &impl Serialize) -> Self {
        match serde_json::to_string(value) {
            Ok(json) => Self::output(json),
            Err(error) => Self::error(error.to_string()),
        }
    }

    pub fn success() -> Self {
        Self {
            success: true,
            error: None,
            code: None,
            output: None,
        }
    }

    pub fn output(output: impl Into<String>) -> Self {
        Self {
            success: true,
            error: None,
            code: None,
            output: Some(output.into()),
        }
    }

    pub fn error(error: impl Into<String>) -> Self {
        Self {
            success: false,
            error: Some(error.into()),
            code: Some("Failed".into()),
            output: None,
        }
    }
}

pub fn read_message<T: for<'de> Deserialize<'de>>(reader: &mut impl BufRead) -> Result<T, String> {
    let mut bytes = Vec::new();
    Read::take(reader, (MAX_MESSAGE_BYTES + 1) as u64)
        .read_until(b'\n', &mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() > MAX_MESSAGE_BYTES {
        return Err("Protocol message is too large".into());
    }
    if bytes.last() == Some(&b'\n') {
        bytes.pop();
    }
    serde_json::from_slice(&bytes).map_err(|error| error.to_string())
}

pub fn write_message<T: Serialize>(writer: &mut impl Write, message: &T) -> io::Result<()> {
    serde_json::to_writer(&mut *writer, message)?;
    writer.write_all(b"\n")?;
    writer.flush()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_removed_protocol_requests() {
        for request in [
            r#"{"command":"activate","mode":"editor"}"#,
            r#"{"command":"runCommand","target":"test"}"#,
        ] {
            assert!(serde_json::from_str::<Request>(request).is_err());
        }
    }

    #[test]
    fn request_round_trips() {
        let request = Request::Open {
            mode: "editor".into(),
            text: None,
            selection: false,
        };
        let mut output = Vec::new();
        write_message(&mut output, &request).unwrap();
        let decoded: Request = read_message(&mut output.as_slice()).unwrap();
        assert_eq!(decoded, request);
    }

    #[test]
    fn replace_request_round_trips() {
        let request = Request::Replace {
            action: "command:translate-es".into(),
        };
        let mut output = Vec::new();
        write_message(&mut output, &request).unwrap();
        let decoded: Request = read_message(&mut output.as_slice()).unwrap();
        assert_eq!(decoded, request);
    }

    #[test]
    fn command_requests_round_trip() {
        for request in [
            Request::Run {
                request: RunRequest {
                    target: "backup".into(),
                    ..Default::default()
                },
            },
            Request::ListCommands,
            Request::Quit,
        ] {
            let mut output = Vec::new();
            write_message(&mut output, &request).unwrap();
            let decoded: Request = read_message(&mut output.as_slice()).unwrap();
            assert_eq!(decoded, request);
        }
    }

    #[test]
    fn a_response_carries_its_output() {
        let mut output = Vec::new();
        write_message(&mut output, &Response::output("[]")).unwrap();
        let decoded: Response = read_message(&mut output.as_slice()).unwrap();
        assert_eq!(decoded.output.as_deref(), Some("[]"));
        // a response of an older build has no output
        let old: Response = read_message(&mut &b"{\"success\":true}\n"[..]).unwrap();
        assert_eq!(old, Response::success());
    }

    #[test]
    fn validates_selection_actions() {
        for valid in [
            "correction",
            "translate.0",
            "aiTask.12",
            "command:default:core.correct:fix",
        ] {
            assert!(is_selection_action(valid), "{valid}");
        }
        for invalid in [
            "",
            "translate",
            "translate.",
            "aiTask.x",
            "other.1",
            "aiTask.1234",
            "command:",
            "command: ",
        ] {
            assert!(!is_selection_action(invalid), "{invalid}");
        }
    }
}
