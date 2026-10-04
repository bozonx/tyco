use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, ChildStdout, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::errors::AppError;
use crate::services::platform::shell;
use crate::services::secret_detector::redact_secrets;

/// Stands in for the text in a command; see `shell::substitute`.
pub const TEXT_PLACEHOLDER: &str = "{{TEXT}}";
/// The text also comes to the command in this variable and on stdin.
pub const TEXT_ENV_VAR: &str = "TYCO_TEXT";

/// How long a command whose output is needed may run before it is killed.
const OUTPUT_TIMEOUT: Duration = Duration::from_secs(60);
/// How long a command whose output is not needed is waited for. One still
/// running by then, e.g. a GUI app it started, is left in the background.
const STATUS_WAIT: Duration = Duration::from_secs(3);
/// How long the output is read after the command exits. A process it started
/// in the background may hold the pipes open for good.
const PIPE_GRACE: Duration = Duration::from_millis(500);
const POLL_INTERVAL: Duration = Duration::from_millis(20);

const MAX_OUTPUT_BYTES: usize = 1 << 20;
const MAX_LOGGED_OUTPUT_BYTES: usize = 4 << 10;
const MAX_LOG_FILE_BYTES: u64 = 5 << 20;
const LOG_FILE_NAME: &str = "actions.log";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScriptExecutionResult {
    pub success: bool,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    /// The command did not finish while waited for and keeps running.
    pub running: bool,
}

pub struct ScriptRequest<'a> {
    pub name: &'a str,
    pub command: &'a str,
    pub working_dir: Option<&'a str>,
    pub text: &'a str,
    /// The caller uses the output: the command is waited for longer and
    /// killed if it does not finish in time.
    pub capture_output: bool,
    pub log_output: bool,
}

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

pub fn expand_home_dir(path: &str) -> PathBuf {
    let home = || shell::home_dir();
    if path == "~" {
        if let Some(home) = home() {
            return home;
        }
    } else if let Some(stripped) = path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\")) {
        if let Some(home) = home() {
            return home.join(stripped);
        }
    }
    PathBuf::from(path)
}

/// The directory a command runs in: the given one, or the home directory.
pub fn resolve_working_dir(working_dir: Option<&str>) -> Result<Option<PathBuf>, AppError> {
    let trimmed = working_dir.map(str::trim).unwrap_or_default();
    if trimmed.is_empty() {
        return Ok(shell::home_dir());
    }
    let path = expand_home_dir(trimmed);
    if path.is_dir() {
        Ok(Some(path))
    } else {
        Err(AppError::Message(format!(
            "Working directory `{trimmed}` does not exist"
        )))
    }
}

/// Appends to `actions.log`, moving a full one to `actions.log.1` first.
pub fn append_action_log(log_dir: &Path, entry: &str) -> std::io::Result<()> {
    fs::create_dir_all(log_dir)?;
    let log_path = log_dir.join(LOG_FILE_NAME);
    if fs::metadata(&log_path).is_ok_and(|meta| meta.len() > MAX_LOG_FILE_BYTES) {
        fs::rename(&log_path, log_dir.join(format!("{LOG_FILE_NAME}.1")))?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)?;
    file.write_all(entry.as_bytes())
}

pub fn log_custom_action(
    log_dir: &Path,
    name: &str,
    action_type: &str,
    details: &str,
) -> std::io::Result<()> {
    let entry = format!(
        "[{}] [Action: \"{}\"] Type: {}\n{}\n{}\n",
        format_timestamp(),
        name,
        action_type,
        truncate(details.trim(), MAX_LOGGED_OUTPUT_BYTES),
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
    pub success: bool,
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
        if record.success { "success" } else { "failed" },
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

type Buffer = Arc<Mutex<Vec<u8>>>;

/// Reads a pipe into a buffer of bounded size; the receiver gets a message
/// once the pipe is closed.
fn spawn_reader(mut pipe: impl Read + Send + 'static, buffer: Buffer) -> Receiver<()> {
    let (done, finished) = mpsc::channel();
    thread::spawn(move || {
        let mut chunk = [0u8; 8192];
        while let Ok(read) = pipe.read(&mut chunk) {
            if read == 0 {
                break;
            }
            if let Ok(mut buffer) = buffer.lock() {
                let room = MAX_OUTPUT_BYTES.saturating_sub(buffer.len());
                buffer.extend_from_slice(&chunk[..read.min(room)]);
            }
        }
        let _ = done.send(());
    });
    finished
}

fn read_buffer(buffer: &Buffer) -> String {
    buffer
        .lock()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        .unwrap_or_default()
}

struct Running {
    child: Child,
    stdout: Buffer,
    stderr: Buffer,
    readers: Vec<Receiver<()>>,
}

impl Running {
    fn start(
        mut child: Child,
        stdout: Option<ChildStdout>,
        stderr: Option<ChildStderr>,
        text: &str,
    ) -> Self {
        if let Some(mut stdin) = child.stdin.take() {
            // a command that never reads stdin must not block the caller
            let text = text.to_string();
            thread::spawn(move || {
                let _ = stdin.write_all(text.as_bytes());
            });
        }
        let stdout_buffer = Buffer::default();
        let stderr_buffer = Buffer::default();
        let mut readers = Vec::new();
        if let Some(pipe) = stdout {
            readers.push(spawn_reader(pipe, stdout_buffer.clone()));
        }
        if let Some(pipe) = stderr {
            readers.push(spawn_reader(pipe, stderr_buffer.clone()));
        }
        Self {
            child,
            stdout: stdout_buffer,
            stderr: stderr_buffer,
            readers,
        }
    }

    /// Waits until the command exits or the deadline passes.
    fn wait_until(
        &mut self,
        deadline: Instant,
    ) -> std::io::Result<Option<std::process::ExitStatus>> {
        loop {
            if let Some(status) = self.child.try_wait()? {
                return Ok(Some(status));
            }
            if Instant::now() >= deadline {
                return Ok(None);
            }
            thread::sleep(POLL_INTERVAL);
        }
    }

    fn finish(self, status: std::process::ExitStatus) -> ScriptExecutionResult {
        let deadline = Instant::now() + PIPE_GRACE;
        for reader in &self.readers {
            let left = deadline.saturating_duration_since(Instant::now());
            if let Err(RecvTimeoutError::Timeout) = reader.recv_timeout(left) {
                break;
            }
        }
        ScriptExecutionResult {
            success: status.success(),
            exit_code: status.code(),
            stdout: read_buffer(&self.stdout),
            stderr: read_buffer(&self.stderr),
            running: false,
        }
    }
}

struct LogContext {
    dir: Option<PathBuf>,
    name: String,
    command: String,
    cwd: String,
    log_output: bool,
    started: Instant,
}

impl LogContext {
    fn write(&self, result: &ScriptExecutionResult, error: Option<&str>) {
        let duration = self.started.elapsed();
        if let Some(error) = error {
            log::warn!("[Action: \"{}\"] {error}", self.name);
        } else if result.success {
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

        let failed = error.is_some() || !result.success;
        if !(self.log_output || failed) {
            return;
        }
        let Some(dir) = &self.dir else { return };
        let status = match (error, result.success) {
            (Some(error), _) => format!("ERROR: {error}"),
            (None, true) => String::from("SUCCESS"),
            (None, false) => String::from("FAILED"),
        };
        // the command is logged as written: the text is the user's, not ours to keep
        let entry = format!(
            "[{}] [Action: \"{}\"] Status: {} (exit code: {:?}) Duration: {:?}\nCommand: {}\nCWD: {}\n--- stdout ---\n{}\n--- stderr ---\n{}\n{}\n",
            format_timestamp(),
            self.name,
            status,
            result.exit_code,
            duration,
            self.command,
            self.cwd,
            or_empty(&result.stdout),
            or_empty(&result.stderr),
            "=".repeat(80),
        );
        let _ = append_action_log(dir, &entry);
    }
}

pub fn execute_script(
    request: &ScriptRequest,
    log_dir: Option<&Path>,
) -> Result<ScriptExecutionResult, AppError> {
    let mut log = LogContext {
        dir: log_dir.map(Path::to_path_buf),
        name: request.name.to_string(),
        command: request.command.to_string(),
        cwd: String::from("(default)"),
        log_output: request.log_output,
        started: Instant::now(),
    };
    let fail = |log: &LogContext, message: String| {
        log.write(&empty_result(), Some(&message));
        AppError::Message(message)
    };

    let cwd =
        resolve_working_dir(request.working_dir).map_err(|error| fail(&log, error.to_string()))?;
    let script = shell::substitute(request.command, TEXT_PLACEHOLDER, request.text);

    let mut command = shell::command(&script);
    if let Some(cwd) = &cwd {
        command.current_dir(cwd);
        log.cwd = cwd.to_string_lossy().into_owned();
    }
    command
        .env(TEXT_ENV_VAR, request.text)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|error| fail(&log, format!("Failed to start the command: {error}")))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let mut running = Running::start(child, stdout, stderr, request.text);

    let wait = if request.capture_output {
        OUTPUT_TIMEOUT
    } else {
        STATUS_WAIT
    };
    let status = running
        .wait_until(Instant::now() + wait)
        .map_err(|error| fail(&log, format!("Failed to wait for the command: {error}")))?;

    if let Some(status) = status {
        let result = running.finish(status);
        log.write(&result, None);
        return Ok(result);
    }

    if request.capture_output {
        let _ = running.child.kill();
        let _ = running.child.wait();
        return Err(fail(
            &log,
            format!(
                "The command did not finish in {} s",
                OUTPUT_TIMEOUT.as_secs()
            ),
        ));
    }

    // left running, e.g. a GUI app; the outcome only goes to the log
    thread::spawn(move || {
        let status = running.child.wait();
        match status {
            Ok(status) => log.write(&running.finish(status), None),
            Err(error) => log.write(&empty_result(), Some(&error.to_string())),
        }
    });
    Ok(ScriptExecutionResult {
        running: true,
        ..empty_result()
    })
}

fn empty_result() -> ScriptExecutionResult {
    ScriptExecutionResult {
        success: false,
        exit_code: None,
        stdout: String::new(),
        stderr: String::new(),
        running: false,
    }
}

/// A file picked by the user, as a command that runs it.
pub fn pick_script_file(app: &AppHandle) -> Option<String> {
    let path = app.dialog().file().blocking_pick_file()?.into_path().ok()?;
    Some(shell::script_invocation(&path.to_string_lossy()))
}

pub fn pick_directory(app: &AppHandle) -> Option<String> {
    let path = app
        .dialog()
        .file()
        .blocking_pick_folder()?
        .into_path()
        .ok()?;
    Some(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request<'a>(command: &'a str, text: &'a str) -> ScriptRequest<'a> {
        ScriptRequest {
            name: "Test",
            command,
            working_dir: None,
            text,
            capture_output: true,
            log_output: false,
        }
    }

    #[test]
    fn logs_a_command_run_with_secrets_masked() {
        let record = CommandRunRecord {
            command_id: String::from("backup"),
            name: String::from("Backup"),
            source: String::from("launcher"),
            text: Some(String::from("key sk-proj-1234567890abcdef1234567890")),
            success: false,
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
            success: true,
            ..record
        });
        assert!(without_text.contains("Result: success"));
        assert!(!without_text.contains("Text:"));
        assert!(!without_text.contains("Message:"));
    }

    #[cfg(not(target_os = "windows"))]
    mod commands {
        pub const ECHO_ENV: &str = "printf %s \"$TYCO_TEXT\"";
        pub const CAT: &str = "cat";
        pub const ECHO_PLACEHOLDER: &str = "printf %s {{TEXT}}";
        pub const PWD: &str = "pwd";
        pub const SLEEP: &str = "sleep 30";
    }

    #[cfg(target_os = "windows")]
    mod commands {
        pub const ECHO_ENV: &str = "[Console]::Out.Write($env:TYCO_TEXT)";
        pub const CAT: &str = "[Console]::Out.Write([Console]::In.ReadToEnd())";
        pub const ECHO_PLACEHOLDER: &str = "[Console]::Out.Write({{TEXT}})";
        pub const PWD: &str = "(Get-Location).Path";
        pub const SLEEP: &str = "Start-Sleep 30";
    }

    #[test]
    fn passes_the_text_in_every_way() {
        let text = "don't \"stop\" $HOME";
        for command in [
            commands::ECHO_ENV,
            commands::CAT,
            commands::ECHO_PLACEHOLDER,
        ] {
            let result = execute_script(&request(command, text), None).unwrap();
            assert!(result.success, "{command}: {}", result.stderr);
            assert_eq!(result.stdout, text, "{command}");
        }
    }

    #[test]
    fn runs_in_the_home_directory_by_default() {
        let result = execute_script(&request(commands::PWD, ""), None).unwrap();
        let home = shell::home_dir().unwrap();
        assert_eq!(
            PathBuf::from(result.stdout.trim()).canonicalize().unwrap(),
            home.canonicalize().unwrap()
        );
    }

    #[test]
    fn runs_in_the_given_directory() {
        let dir = std::env::temp_dir().canonicalize().unwrap();
        let dir_str = dir.to_string_lossy().into_owned();
        let result = execute_script(
            &ScriptRequest {
                working_dir: Some(&dir_str),
                ..request(commands::PWD, "")
            },
            None,
        )
        .unwrap();
        assert_eq!(
            PathBuf::from(result.stdout.trim()).canonicalize().unwrap(),
            dir
        );
    }

    #[test]
    fn refuses_a_missing_working_directory() {
        let result = execute_script(
            &ScriptRequest {
                working_dir: Some("/no/such/tyco/dir"),
                ..request(commands::PWD, "")
            },
            None,
        );
        assert!(result.is_err());
    }

    #[test]
    fn leaves_a_long_command_running_when_its_output_is_not_needed() {
        let started = Instant::now();
        let result = execute_script(
            &ScriptRequest {
                capture_output: false,
                ..request(commands::SLEEP, "")
            },
            None,
        )
        .unwrap();
        assert!(result.running);
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn reports_a_failure() {
        let result = execute_script(&request("exit 3", ""), None).unwrap();
        assert!(!result.success);
        assert_eq!(result.exit_code, Some(3));
    }

    #[test]
    fn logs_the_command_without_the_text() {
        let dir = std::env::temp_dir().join(format!("tyco_test_log_{}", std::process::id()));
        let result = execute_script(
            &ScriptRequest {
                log_output: true,
                ..request(commands::ECHO_PLACEHOLDER, "private_text")
            },
            Some(&dir),
        )
        .unwrap();
        assert!(result.success);

        let content = fs::read_to_string(dir.join(LOG_FILE_NAME)).unwrap();
        assert!(content.contains("[Action: \"Test\"]"));
        assert!(content.contains(&format!("Command: {}", commands::ECHO_PLACEHOLDER)));
        assert!(!content.contains("Command: printf %s 'private_text'"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rotates_a_full_log() {
        let dir = std::env::temp_dir().join(format!("tyco_test_rotate_{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let big = vec![b'x'; MAX_LOG_FILE_BYTES as usize + 1];
        fs::write(dir.join(LOG_FILE_NAME), big).unwrap();

        append_action_log(&dir, "fresh\n").unwrap();

        assert_eq!(
            fs::read_to_string(dir.join(LOG_FILE_NAME)).unwrap(),
            "fresh\n"
        );
        assert!(dir.join(format!("{LOG_FILE_NAME}.1")).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn truncates_on_a_char_boundary() {
        let text = "яяя";
        assert!(truncate(text, 3).starts_with("я\n"));
    }
}
