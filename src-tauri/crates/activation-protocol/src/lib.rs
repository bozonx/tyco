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

/// The spelling of a mode the CLI documents, e.g. `voice-chat` for
/// `voiceChat`; the inverse of `canonical_mode`.
pub fn cli_mode(mode: &str) -> &str {
    match mode {
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
    #[serde(default)]
    pub output: OutputMode,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OutputMode {
    #[default]
    Return,
    /// Legacy alias for returned output; UI settings do not affect external calls.
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
            result: None,
        }
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
        Self {
            success: false,
            error: Some(error.into()),
            code: Some("Failed".into()),
            result: None,
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
    fn cli_spellings_of_modes_round_trip() {
        for mode in START_MODES {
            assert_eq!(canonical_mode(cli_mode(mode)), *mode);
            assert!(!cli_mode(mode).chars().any(char::is_uppercase), "{mode}");
        }
    }

    #[test]
    fn rejects_removed_protocol_requests() {
        for request in [
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
            Request::Quit,
        ] {
            let mut output = Vec::new();
            write_message(&mut output, &request).unwrap();
            let decoded: Request = read_message(&mut output.as_slice()).unwrap();
            assert_eq!(decoded, request);
        }
    }

    #[test]
    fn a_response_carries_its_result_as_json() {
        let mut output = Vec::new();
        write_message(&mut output, &Response::json(&serde_json::json!([]))).unwrap();
        assert_eq!(output, b"{\"success\":true,\"result\":[]}\n");
        let decoded: Response = read_message(&mut output.as_slice()).unwrap();
        assert_eq!(decoded.result, Some(serde_json::json!([])));
        let empty: Response = read_message(&mut &b"{\"success\":true}\n"[..]).unwrap();
        assert_eq!(empty, Response::success());
    }
}
