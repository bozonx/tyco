use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, ChildStdout, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use super::command_logging::LogContext;
use crate::errors::AppError;
use crate::services::platform::process::{PipeReader, PollablePipe};
use crate::services::platform::shell;

/// Stands in for the text in a command; see `shell::substitute`.
pub const TEXT_PLACEHOLDER: &str = "{{TEXT}}";

/// How long a command whose output is needed may run before it is killed,
/// unless the command sets its own time; see `SCRIPT_OUTPUT_TIMEOUT_SEC`.
const OUTPUT_TIMEOUT: Duration = Duration::from_secs(60);
/// The longest time a command may set; see `SCRIPT_MAX_TIMEOUT_SEC`.
const MAX_OUTPUT_TIMEOUT: Duration = Duration::from_secs(3600);
/// How long a command whose output is not needed is waited for. One still
/// running by then, e.g. a GUI app it started, is left in the background.
const STATUS_WAIT: Duration = Duration::from_secs(3);
/// How long the output is read after the command exits. A process it started
/// in the background may hold the pipes open for good.
const PIPE_GRACE: Duration = Duration::from_millis(500);
const POLL_INTERVAL: Duration = Duration::from_millis(20);
/// The error of a command stopped by `cancel_script`.
pub const SCRIPT_CANCELLED: &str = "Cancelled";

const MAX_OUTPUT_BYTES: usize = 1 << 20;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScriptExecutionResult {
    #[serde(rename = "success")]
    pub is_success: bool,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    /// The command did not finish while waited for and keeps running.
    #[serde(rename = "running")]
    pub is_running: bool,
}

pub struct ScriptRequest<'a> {
    pub name: &'a str,
    pub command: &'a str,
    pub working_dir: Option<&'a str>,
    pub text: &'a str,
    /// The caller uses the output: the command is waited for longer and
    /// killed if it does not finish in time.
    pub should_capture_output: bool,
    /// Replaces `OUTPUT_TIMEOUT`, up to `MAX_OUTPUT_TIMEOUT`.
    pub output_timeout: Option<Duration>,
    pub should_log_output: bool,
    /// Lets `cancel_script` stop the command while it is waited for.
    pub run_id: Option<&'a str>,
}

type CancelFlag = Arc<AtomicBool>;

/// The commands being waited for that the caller may cancel, by run id.
fn cancellable_runs() -> &'static Mutex<HashMap<String, CancelFlag>> {
    static RUNS: OnceLock<Mutex<HashMap<String, CancelFlag>>> = OnceLock::new();
    RUNS.get_or_init(Mutex::default)
}

/// Keeps the run cancellable while it is alive.
struct CancelRegistration {
    run_id: Option<String>,
    flag: CancelFlag,
}

impl CancelRegistration {
    fn new(run_id: Option<&str>) -> Result<Self, AppError> {
        let flag = CancelFlag::default();
        if let Some(run_id) = run_id {
            let mut runs = cancellable_runs()
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            if runs.contains_key(run_id) {
                return Err(AppError::InvalidInput(format!(
                    "Run ID {run_id} is already active"
                )));
            }
            runs.insert(run_id.to_owned(), flag.clone());
        }
        Ok(Self {
            run_id: run_id.map(str::to_owned),
            flag,
        })
    }
}

impl Drop for CancelRegistration {
    fn drop(&mut self) {
        if let Some(run_id) = &self.run_id {
            cancellable_runs()
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .remove_entry(run_id);
        }
    }
}

/// Kills the command of run `run_id` if it is still waited for; returns
/// whether there was one. A command left running in the background is not
/// waited for any more and keeps running.
pub fn cancel_script(run_id: &str) -> bool {
    let runs = cancellable_runs()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    match runs.get(run_id) {
        Some(flag) => {
            flag.store(true, Ordering::SeqCst);
            true
        }
        None => false,
    }
}

/// Cancels all script runs that are currently waited for.
pub fn cancel_all_scripts() {
    let runs = cancellable_runs()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    for flag in runs.values() {
        flag.store(true, Ordering::SeqCst);
    }
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

type SharedOutputBuffer = Arc<Mutex<Vec<u8>>>;

/// Reads a pipe into a buffer of bounded size; the receiver gets a message
/// once the pipe is closed.
fn spawn_reader(
    pipe: impl PollablePipe,
    buffer: SharedOutputBuffer,
) -> std::io::Result<PipeReader> {
    PipeReader::start(pipe, move |bytes| {
        if let Ok(mut buffer) = buffer.lock() {
            let room = MAX_OUTPUT_BYTES.saturating_sub(buffer.len());
            buffer.extend_from_slice(&bytes[..bytes.len().min(room)]);
        }
    })
}

fn read_buffer(buffer: &SharedOutputBuffer) -> String {
    buffer
        .lock()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        .unwrap_or_default()
}

struct RunningScript {
    child: Child,
    stdout: SharedOutputBuffer,
    stderr: SharedOutputBuffer,
    readers: Vec<PipeReader>,
    kill_and_reap_on_drop: bool,
}

impl RunningScript {
    fn start(
        child: Child,
        stdout: Option<ChildStdout>,
        stderr: Option<ChildStderr>,
    ) -> std::io::Result<Self> {
        let stdout_buffer = SharedOutputBuffer::default();
        let stderr_buffer = SharedOutputBuffer::default();
        let mut running = Self {
            child,
            stdout: stdout_buffer,
            stderr: stderr_buffer,
            readers: Vec::new(),
            kill_and_reap_on_drop: true,
        };
        if let Some(pipe) = stdout {
            running
                .readers
                .push(spawn_reader(pipe, running.stdout.clone())?);
        }
        if let Some(pipe) = stderr {
            running
                .readers
                .push(spawn_reader(pipe, running.stderr.clone())?);
        }
        Ok(running)
    }

    /// Waits until the command exits, the deadline passes or the run is
    /// cancelled.
    fn wait_until(
        &mut self,
        deadline: Instant,
        cancelled: &AtomicBool,
    ) -> std::io::Result<ProcessWaitOutcome> {
        loop {
            if let Some(status) = self.child.try_wait()? {
                return Ok(ProcessWaitOutcome::Exited(status));
            }
            if cancelled.load(Ordering::SeqCst) {
                return Ok(ProcessWaitOutcome::Cancelled);
            }
            if Instant::now() >= deadline {
                return Ok(ProcessWaitOutcome::TimedOut);
            }
            thread::sleep(POLL_INTERVAL);
        }
    }

    fn finish(mut self, status: std::process::ExitStatus) -> ScriptExecutionResult {
        let deadline = Instant::now() + PIPE_GRACE;
        for reader in &self.readers {
            reader.drain_until(deadline);
        }
        self.readers.clear();
        self.kill_and_reap_on_drop = false;
        ScriptExecutionResult {
            is_success: status.success(),
            exit_code: status.code(),
            stdout: read_buffer(&self.stdout),
            stderr: read_buffer(&self.stderr),
            is_running: false,
        }
    }
}

impl Drop for RunningScript {
    fn drop(&mut self) {
        if self.kill_and_reap_on_drop {
            shell::kill_tree(&mut self.child);
            let _ = self.child.wait();
        }
    }
}

enum ProcessWaitOutcome {
    Exited(std::process::ExitStatus),
    TimedOut,
    Cancelled,
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
        should_log_output: request.should_log_output,
        started: Instant::now(),
    };
    let fail = |log: &LogContext, message: String| {
        log.write(&empty_result(), Some(&message));
        AppError::Message(message)
    };

    let cwd =
        resolve_working_dir(request.working_dir).map_err(|error| fail(&log, error.to_string()))?;
    let mut command = shell::command_with_text(request.command, TEXT_PLACEHOLDER, request.text);
    if let Some(cwd) = &cwd {
        command.current_dir(cwd);
        log.cwd = cwd.to_string_lossy().into_owned();
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let registration = CancelRegistration::new(request.run_id)?;
    let mut child = command
        .spawn()
        .map_err(|error| fail(&log, format!("Failed to start the command: {error}")))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let mut running = RunningScript::start(child, stdout, stderr)?;

    let output_timeout = request
        .output_timeout
        .filter(|timeout| !timeout.is_zero())
        .map_or(OUTPUT_TIMEOUT, |timeout| timeout.min(MAX_OUTPUT_TIMEOUT));
    let wait = if request.should_capture_output {
        output_timeout
    } else {
        STATUS_WAIT
    };
    let status = running
        .wait_until(Instant::now() + wait, &registration.flag)
        .map_err(|error| fail(&log, format!("Failed to wait for the command: {error}")))?;
    drop(registration);

    match status {
        ProcessWaitOutcome::Exited(status) => {
            let result = running.finish(status);
            log.write(&result, None);
            return Ok(result);
        }
        ProcessWaitOutcome::Cancelled => {
            return Err(fail(&log, String::from(SCRIPT_CANCELLED)));
        }
        ProcessWaitOutcome::TimedOut => {}
    }

    if request.should_capture_output {
        return Err(fail(
            &log,
            format!(
                "The command did not finish in {} s",
                output_timeout.as_secs()
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
        is_running: true,
        ..empty_result()
    })
}

fn empty_result() -> ScriptExecutionResult {
    ScriptExecutionResult {
        is_success: false,
        exit_code: None,
        stdout: String::new(),
        stderr: String::new(),
        is_running: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::test_support::TestDir;
    use std::fs;

    fn request<'a>(command: &'a str, text: &'a str) -> ScriptRequest<'a> {
        ScriptRequest {
            name: "Test",
            command,
            working_dir: None,
            text,
            should_capture_output: true,
            output_timeout: None,
            should_log_output: false,
            run_id: None,
        }
    }

    #[cfg(not(target_os = "windows"))]
    mod commands {
        pub const CAT: &str = "cat";
        pub const ECHO_PLACEHOLDER: &str = "printf %s {{TEXT}}";
        pub const PWD: &str = "pwd";
        pub const SLEEP: &str = "sleep 30";
    }

    #[cfg(target_os = "windows")]
    mod commands {
        pub const CAT: &str = "[Console]::Out.Write([Console]::In.ReadToEnd())";
        pub const ECHO_PLACEHOLDER: &str = "[Console]::Out.Write({{TEXT}})";
        pub const PWD: &str = "(Get-Location).Path";
        pub const SLEEP: &str = "Start-Sleep 30";
    }

    /// A timeout stops the processes the command started too: they would run
    /// on and keep the output pipes open.
    #[cfg(unix)]
    #[test]
    fn integration_a_timeout_stops_the_whole_process_tree() {
        let directory = TestDir::new("process-tree");
        let pid_file = directory.join("pid");
        let command = format!("sleep 30 & echo $! > '{}'; wait", pid_file.display());
        let mut timed = request(&command, "");
        timed.output_timeout = Some(Duration::from_millis(500));

        let started = Instant::now();
        assert!(execute_script(&timed, None).is_err());
        assert!(started.elapsed() < Duration::from_secs(5));

        let pid: i32 = fs::read_to_string(&pid_file)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        let _ = fs::remove_file(&pid_file);
        thread::sleep(Duration::from_millis(100));
        // SAFETY: signal 0 only probes whether the process exists
        assert_ne!(unsafe { libc::kill(pid, 0) }, 0, "the child still runs");
    }

    #[test]
    fn integration_passes_the_text_through_the_placeholder() {
        let text = "don't \"stop\" $HOME";
        let result = execute_script(&request(commands::ECHO_PLACEHOLDER, text), None).unwrap();
        assert!(result.is_success, "{}", result.stderr);
        assert_eq!(result.stdout, text);
    }

    #[test]
    fn integration_does_not_pass_text_to_stdin() {
        let result = execute_script(&request(commands::CAT, "input text"), None).unwrap();
        assert!(result.is_success, "{}", result.stderr);
        assert_eq!(result.stdout, "");
    }

    #[test]
    fn integration_runs_in_the_home_directory_by_default() {
        let result = execute_script(&request(commands::PWD, ""), None).unwrap();
        let home = shell::home_dir().unwrap();
        assert_eq!(
            PathBuf::from(result.stdout.trim()).canonicalize().unwrap(),
            home.canonicalize().unwrap()
        );
    }

    #[test]
    fn integration_runs_in_the_given_directory() {
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
    fn integration_refuses_a_missing_working_directory() {
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
    fn integration_leaves_a_long_command_running_when_its_output_is_not_needed() {
        let started = Instant::now();
        let result = execute_script(
            &ScriptRequest {
                should_capture_output: false,
                ..request(commands::SLEEP, "")
            },
            None,
        )
        .unwrap();
        assert!(result.is_running);
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn integration_kills_a_command_that_outlives_its_own_timeout() {
        let started = Instant::now();
        let error = execute_script(
            &ScriptRequest {
                output_timeout: Some(Duration::from_secs(1)),
                ..request(commands::SLEEP, "")
            },
            None,
        )
        .unwrap_err();
        assert_eq!(error.to_string(), "The command did not finish in 1 s");
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn integration_kills_a_cancelled_command() {
        let run_id = format!("cancel-test-{}", std::process::id());
        let canceller = {
            let run_id = run_id.clone();
            thread::spawn(move || {
                let deadline = Instant::now() + Duration::from_secs(5);
                while !cancel_script(&run_id) && Instant::now() < deadline {
                    thread::sleep(Duration::from_millis(10));
                }
            })
        };
        let started = Instant::now();
        let result = execute_script(
            &ScriptRequest {
                run_id: Some(&run_id),
                ..request(commands::SLEEP, "")
            },
            None,
        );
        canceller.join().unwrap();
        assert_eq!(result.unwrap_err().to_string(), SCRIPT_CANCELLED);
        assert!(started.elapsed() < Duration::from_secs(10));
        assert!(!cancel_script(&run_id), "the run is forgotten once done");
    }

    #[test]
    fn integration_reports_a_failure() {
        let result = execute_script(&request("exit 3", ""), None).unwrap();
        assert!(!result.is_success);
        assert_eq!(result.exit_code, Some(3));
    }

    #[test]
    fn integration_logs_the_command_without_the_text() {
        let dir = TestDir::new("process-log");
        let result = execute_script(
            &ScriptRequest {
                should_log_output: true,
                ..request(commands::ECHO_PLACEHOLDER, "private_text")
            },
            Some(&dir),
        )
        .unwrap();
        assert!(result.is_success);

        let content = fs::read_to_string(dir.join("actions.log")).unwrap();
        assert!(content.contains("[Action: \"Test\"]"));
        assert!(content.contains(&format!("Command: {}", commands::ECHO_PLACEHOLDER)));
        assert!(!content.contains("Command: printf %s 'private_text'"));
    }

    #[test]
    fn rejects_duplicate_run_ids_without_losing_registration() {
        let registration = CancelRegistration::new(Some("duplicate-test")).unwrap();
        assert!(CancelRegistration::new(Some("duplicate-test")).is_err());
        assert!(cancel_script("duplicate-test"));
        assert!(registration.flag.load(Ordering::SeqCst));
        drop(registration);
        assert!(!cancel_script("duplicate-test"));
    }

    #[test]
    fn cancels_all_running_scripts() {
        let reg1 = CancelRegistration::new(Some("run-1")).unwrap();
        let reg2 = CancelRegistration::new(Some("run-2")).unwrap();
        assert!(!reg1.flag.load(Ordering::SeqCst));
        assert!(!reg2.flag.load(Ordering::SeqCst));

        cancel_all_scripts();

        assert!(reg1.flag.load(Ordering::SeqCst));
        assert!(reg2.flag.load(Ordering::SeqCst));
    }
}
