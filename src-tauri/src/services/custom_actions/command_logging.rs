use super::process_runner::ScriptExecutionResult;
use crate::services::secret_detector::redact_secrets;
use serde::Deserialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;
const MAX_LOGGED_OUTPUT_BYTES: usize = 4 << 10;
const MAX_LOG_FILE_BYTES: u64 = 5 << 20;
const LOG_FILE_NAME: &str = "actions.log";
pub fn format_timestamp() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs());

    let days = secs / 86400;
    let rem = secs % 86400;
    let hh = rem / 3600;
    let mm = (rem % 3600) / 60;
    let ss = rem % 60;

    let z = days + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };

    format!("{y:04}-{m:02}-{d:02} {hh:02}:{mm:02}:{ss:02} UTC")
}

/// The log of command runs in `log_dir`.
pub fn action_log_path(log_dir: &Path) -> PathBuf {
    log_dir.join(LOG_FILE_NAME)
}

/// Appends to `actions.log`, moving a full one to `actions.log.1` first.
pub fn append_action_log(log_dir: &Path, entry: &str) -> std::io::Result<()> {
    static LOG_WRITE_LOCK: Mutex<()> = Mutex::new(());
    let _guard = LOG_WRITE_LOCK
        .lock()
        .map_err(|_| std::io::Error::other("Action log lock poisoned"))?;
    crate::services::atomic_file::create_private_dir(log_dir)
        .map_err(|error| std::io::Error::other(error.to_string()))?;
    let log_path = action_log_path(log_dir);
    if fs::metadata(&log_path).is_ok_and(|meta| meta.len() > MAX_LOG_FILE_BYTES) {
        let rotated = log_dir.join(format!("{LOG_FILE_NAME}.1"));
        if rotated.exists() {
            fs::remove_file(&rotated)?;
        }
        fs::rename(&log_path, rotated)?;
    }
    let mut options = OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&log_path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))?;
    }
    file.write_all(entry.as_bytes())
}

pub fn log_custom_action(
    log_dir: &Path,
    name: &str,
    action_type: &str,
    details: &str,
) -> std::io::Result<()> {
    let sanitized_details = redact_secrets(details.trim());
    let entry = format!(
        "[{}] [Action: \"{}\"] Type: {}\n{}\n{}\n",
        format_timestamp(),
        name,
        action_type,
        truncate(&sanitized_details, MAX_LOGGED_OUTPUT_BYTES),
        "=".repeat(80),
    );
    append_action_log(log_dir, &entry)
}

/// One run of a library command, as the command overlay reports it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandRunRecord {
    pub command_id: String,
    pub name: String,
    /// Where the command was invoked from, e.g. `launcher`.
    pub source: String,
    /// The text the command got; absent for a command that takes none.
    pub text: Option<String>,
    #[serde(rename = "success")]
    pub is_success: bool,
    /// Why it failed, or what it reported.
    pub message: Option<String>,
}

/// Appends the run to `actions.log`, so the user can see what ran and why.
/// The text and the message may hold secrets: they are masked first.
pub fn log_command_run(log_dir: &Path, record: &CommandRunRecord) -> std::io::Result<()> {
    append_action_log(log_dir, &format_command_run(record))
}

fn format_command_run(record: &CommandRunRecord) -> String {
    let mut entry = format!(
        "[{}] [Command: \"{}\"] Id: {}, Source: {}, Result: {}\n",
        format_timestamp(),
        record.name,
        record.command_id,
        record.source,
        if record.is_success {
            "success"
        } else {
            "failed"
        },
    );
    if let Some(text) = &record.text {
        entry.push_str(&format!("Text:\n{}\n", or_empty(&redact_secrets(text))));
    }
    if let Some(message) = record.message.as_deref().filter(|m| !m.trim().is_empty()) {
        entry.push_str(&format!(
            "Message: {}\n",
            or_empty(&redact_secrets(message))
        ));
    }
    entry.push_str(&"=".repeat(80));
    entry.push('\n');
    entry
}

fn truncate(text: &str, max_bytes: usize) -> String {
    if text.len() <= max_bytes {
        return text.to_string();
    }
    let mut end = max_bytes;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n... ({} bytes more)", &text[..end], text.len() - end)
}

fn or_empty(text: &str) -> String {
    let text = text.trim();
    if text.is_empty() {
        String::from("(empty)")
    } else {
        truncate(text, MAX_LOGGED_OUTPUT_BYTES)
    }
}

pub(super) struct LogContext {
    pub(super) dir: Option<PathBuf>,
    pub(super) name: String,
    pub(super) command: String,
    pub(super) cwd: String,
    pub(super) should_log_output: bool,
    pub(super) started: Instant,
}

impl LogContext {
    pub(super) fn write(&self, result: &ScriptExecutionResult, error: Option<&str>) {
        let duration = self.started.elapsed();
        if let Some(error) = error {
            log::warn!("[Action: \"{}\"] {error}", self.name);
        } else if result.is_success {
            log::info!(
                "[Action: \"{}\"] Finished in {duration:?} with exit code {:?}",
                self.name,
                result.exit_code
            );
        } else {
            log::warn!(
                "[Action: \"{}\"] Failed in {duration:?} with exit code {:?}",
                self.name,
                result.exit_code
            );
        }

        let failed = error.is_some() || !result.is_success;
        if !(self.should_log_output || failed) {
            return;
        }
        let Some(dir) = &self.dir else { return };
        let status = match (error, result.is_success) {
            (Some(error), _) => format!("ERROR: {error}"),
            (None, true) => String::from("SUCCESS"),
            (None, false) => String::from("FAILED"),
        };
        let stdout_sanitized = redact_secrets(result.stdout.trim());
        let stderr_sanitized = redact_secrets(result.stderr.trim());
        let command_sanitized = redact_secrets(self.command.trim());
        let entry = format!(
            "[{}] [Action: \"{}\"] Status: {} (exit code: {:?}) Duration: {:?}\nCommand: {}\nCWD: {}\n--- stdout ---\n{}\n--- stderr ---\n{}\n{}\n",
            format_timestamp(),
            self.name,
            status,
            result.exit_code,
            duration,
            command_sanitized,
            self.cwd,
            or_empty(&truncate(&stdout_sanitized, MAX_LOGGED_OUTPUT_BYTES)),
            or_empty(&truncate(&stderr_sanitized, MAX_LOGGED_OUTPUT_BYTES)),
            "=".repeat(80),
        );
        let _ = append_action_log(dir, &entry);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::test_support::TestDir;
    #[test]
    fn logs_a_command_run_with_secrets_masked() {
        let record = CommandRunRecord {
            command_id: String::from("backup"),
            name: String::from("Backup"),
            source: String::from("launcher"),
            text: Some(String::from("key sk-proj-1234567890abcdef1234567890")),
            is_success: false,
            message: Some(String::from("exit code 1")),
        };
        let entry = format_command_run(&record);
        assert!(
            entry.contains("[Command: \"Backup\"] Id: backup, Source: launcher, Result: failed")
        );
        assert!(entry.contains("Message: exit code 1"));
        assert!(!entry.contains("sk-proj-"));

        let without_text = format_command_run(&CommandRunRecord {
            text: None,
            message: None,
            is_success: true,
            ..record
        });
        assert!(without_text.contains("Result: success"));
        assert!(!without_text.contains("Text:"));
        assert!(!without_text.contains("Message:"));
    }
    #[test]
    fn rotates_a_full_log() {
        let dir = TestDir::new("tyco_test_rotate_");
        fs::create_dir_all(&dir).unwrap();
        let big = vec![b'x'; MAX_LOG_FILE_BYTES as usize + 1];
        fs::write(dir.join(LOG_FILE_NAME), big).unwrap();

        append_action_log(&dir, "fresh\n").unwrap();

        assert_eq!(
            fs::read_to_string(dir.join(LOG_FILE_NAME)).unwrap(),
            "fresh\n"
        );
        assert!(dir.join(format!("{LOG_FILE_NAME}.1")).exists());
    }
    #[test]
    fn truncates_on_a_char_boundary() {
        let text = "\u{00e9}\u{00e9}\u{00e9}";
        assert!(truncate(text, 3).starts_with("\u{00e9}\n"));
    }
    #[test]
    fn custom_action_log_redacts_secrets() {
        let dir = TestDir::new("tyco_test_action_log_");
        let secret = "sk-1234567890abcdef1234567890abcdef";
        log_custom_action(&dir, "test", "script", &format!("Token: {secret}")).unwrap();

        let contents = fs::read_to_string(dir.join(LOG_FILE_NAME)).unwrap();
        assert!(!contents.contains(secret));
        assert!(contents.contains("[REDACTED"));
    }
}
