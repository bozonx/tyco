use std::io::{self, BufRead, Read, Write};

use serde::{Deserialize, Serialize};

pub const ACTIVATION_ADDRESS: &str = "127.0.0.1:47829";
pub const MAX_MESSAGE_BYTES: usize = 8 * 1024;
pub const START_MODES: &[&str] = &[
    "editor", "write", "chat", "voice", "select", "aiTasks", "history", "config",
];

pub fn is_start_mode(value: &str) -> bool {
    START_MODES.contains(&value)
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "command", rename_all = "camelCase")]
pub enum Request {
    Activate { mode: String },
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl Response {
    pub fn success() -> Self {
        Self {
            success: true,
            error: None,
        }
    }

    pub fn error(error: impl Into<String>) -> Self {
        Self {
            success: false,
            error: Some(error.into()),
        }
    }
}

pub fn read_message<T: for<'de> Deserialize<'de>>(
    reader: &mut impl BufRead,
) -> Result<T, String> {
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
}
