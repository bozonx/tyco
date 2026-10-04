use std::io::{self, BufRead, Read, Write};

use serde::{Deserialize, Serialize};

pub const ACTIVATION_ADDRESS: &str = "127.0.0.1:47829";
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
    "history",
    "config",
];

pub fn is_start_mode(value: &str) -> bool {
    START_MODES.contains(&value)
}

/// Actions that replace the selection in the focused window with their
/// result: `correction`, `translate.<slot>` and `aiTask.<slot>`, where the
/// slot indexes the configured translation languages or AI tasks.
pub fn is_selection_action(value: &str) -> bool {
    if value == "correction" {
        return true;
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
#[serde(tag = "command", rename_all = "camelCase")]
pub enum Request {
    Activate {
        mode: String,
    },
    Replace {
        action: String,
    },
    /// Runs a command of the library, found by its id or its name.
    RunCommand {
        target: String,
        /// The text the command gets; absent when there is none.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        text: Option<String>,
    },
    /// The commands that may be run from outside, as JSON.
    ListCommands,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// What the request asked for, e.g. the JSON list of commands.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
}

impl Response {
    pub fn success() -> Self {
        Self {
            success: true,
            error: None,
            output: None,
        }
    }

    pub fn output(output: impl Into<String>) -> Self {
        Self {
            success: true,
            error: None,
            output: Some(output.into()),
        }
    }

    pub fn error(error: impl Into<String>) -> Self {
        Self {
            success: false,
            error: Some(error.into()),
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
    fn request_round_trips() {
        let request = Request::Activate {
            mode: "editor".into(),
        };
        let mut output = Vec::new();
        write_message(&mut output, &request).unwrap();
        let decoded: Request = read_message(&mut output.as_slice()).unwrap();
        assert_eq!(decoded, request);
    }

    #[test]
    fn replace_request_round_trips() {
        let request = Request::Replace {
            action: "translate.1".into(),
        };
        let mut output = Vec::new();
        write_message(&mut output, &request).unwrap();
        let decoded: Request = read_message(&mut output.as_slice()).unwrap();
        assert_eq!(decoded, request);
    }

    #[test]
    fn command_requests_round_trip() {
        for request in [
            Request::RunCommand {
                target: "backup".into(),
                text: None,
            },
            Request::RunCommand {
                target: "Note".into(),
                text: Some("buy milk\nand bread".into()),
            },
            Request::ListCommands,
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
        for valid in ["correction", "translate.0", "aiTask.12"] {
            assert!(is_selection_action(valid), "{valid}");
        }
        for invalid in [
            "",
            "translate",
            "translate.",
            "aiTask.x",
            "other.1",
            "aiTask.1234",
        ] {
            assert!(!is_selection_action(invalid), "{invalid}");
        }
    }
}
