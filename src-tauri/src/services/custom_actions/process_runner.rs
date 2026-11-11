use crate::locks::{CondvarExt, MutexExt};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, ChildStdout, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use super::command_logging::LogContext;
use crate::errors::AppError;
use crate::services::platform::process::{PipeReader, PollablePipe};
use crate::services::platform::shell;
use crate::services::variables::{self, VariableValues};

/// Stands in for the text in a command; see `shell::substitute`.
pub const TEXT_PLACEHOLDER: &str = "{{TEXT}}";

/// Stands in for the selection in a command.
pub const SELECTION_PLACEHOLDER: &str = "{{SELECTION}}";

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
/// The error of a command whose output does not fit `MAX_OUTPUT_BYTES`.
pub const SCRIPT_OUTPUT_TOO_LARGE: &str = "The command output exceeds 1 MiB";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, ts_rs::TS)]
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
    pub selection_text: Option<&'a str>,
    /// The caller uses the output: the command is waited for until it exits
    /// or the run is cancelled. The caller shows the run and can cancel it, so
    /// there is no time limit; a background caller cancels on its own limit.
    pub should_capture_output: bool,
    pub should_log_output: bool,
    /// Lets `cancel_script` stop the command while it is waited for.
    pub run_id: Option<&'a str>,
    /// The variables `{{var:NAME}}` of the command and its working directory
    /// stand for; the script gets them in its environment too.
    pub variables: &'a VariableValues,
}

type CancelFlag = Arc<AtomicBool>;

#[derive(Default)]
struct RunRegistry {
    is_stopping: bool,
    next_id: u64,
    runs: HashMap<u64, (Option<String>, CancelFlag)>,
}
#[derive(Default)]
struct SharedRuns {
    registry: Mutex<RunRegistry>,
    changed: Condvar,
}

/// Each application owns its script registry; unnamed runs also stop on shutdown.
#[derive(Clone, Default)]
pub struct ScriptRuns {
    shared: Arc<SharedRuns>,
}
impl ScriptRuns {
    fn register(&self, run_id: Option<&str>) -> Result<CancelRegistration, AppError> {
        let mut registry = self.shared.registry.locked();
        if registry.is_stopping {
            return Err(AppError::ServiceUnavailable(
                "Script service is stopping".into(),
            ));
        }
        if let Some(run_id) = run_id {
            if registry
                .runs
                .values()
                .any(|(name, _)| name.as_deref() == Some(run_id))
            {
                return Err(AppError::InvalidInput(format!(
                    "Run ID {run_id} is already active"
                )));
            }
        }
        registry.next_id += 1;
        let id = registry.next_id;
        let flag = CancelFlag::default();
        registry
            .runs
            .insert(id, (run_id.map(str::to_owned), flag.clone()));
        Ok(CancelRegistration {
            id,
            flag,
            shared: self.shared.clone(),
        })
    }
    pub fn cancel(&self, run_id: &str) -> bool {
        let registry = self.shared.registry.locked();
        for (name, flag) in registry.runs.values() {
            if name.as_deref() == Some(run_id) {
                flag.store(true, Ordering::SeqCst);
                return true;
            }
        }
        false
    }
}

impl crate::services::background::StoppableService for ScriptRuns {
    fn stop(&self) {
        let mut registry = self.shared.registry.locked();
        registry.is_stopping = true;
        for (_, flag) in registry.runs.values() {
            flag.store(true, Ordering::SeqCst);
        }
    }
    fn wait_until(&self, deadline: Instant) -> bool {
        let registry = self.shared.registry.locked();
        self.shared
            .changed
            .wait_while_until(registry, deadline, |registry| !registry.runs.is_empty())
    }
}

struct CancelRegistration {
    id: u64,
    flag: CancelFlag,
    shared: Arc<SharedRuns>,
}
impl Drop for CancelRegistration {
    fn drop(&mut self) {
        self.shared.registry.locked().runs.remove(&self.id);
        self.shared.changed.notify_all();
    }
}

/// The directory a command runs in: the given one, or the home directory.
pub fn resolve_working_dir(working_dir: Option<&str>) -> Result<Option<PathBuf>, AppError> {
    let trimmed = working_dir.map(str::trim).unwrap_or_default();
    if trimmed.is_empty() {
        return Ok(shell::home_dir());
    }
    let path = shell::expand_home(trimmed, shell::home_dir().as_deref());
    if let Some(path) = path.filter(|path| path.is_dir()) {
        Ok(Some(path))
    } else {
        Err(AppError::InvalidInput(format!(
            "Working directory `{trimmed}` does not exist"
        )))
    }
}

/// The output of a pipe, up to `MAX_OUTPUT_BYTES`.
#[derive(Default)]
struct OutputBuffer {
    bytes: Vec<u8>,
    /// More came than fits: the bytes are not the whole output.
    is_overflowed: bool,
}

type SharedOutputBuffer = Arc<Mutex<OutputBuffer>>;

/// Reads a pipe into a buffer of bounded size; the receiver gets a message
/// once the pipe is closed.
fn spawn_reader(
    pipe: impl PollablePipe,
    buffer: SharedOutputBuffer,
) -> std::io::Result<PipeReader> {
    PipeReader::start(pipe, move |bytes| {
        if let Ok(mut buffer) = buffer.lock() {
            let room = MAX_OUTPUT_BYTES.saturating_sub(buffer.bytes.len());
            if bytes.len() > room {
                buffer.is_overflowed = true;
            }
            buffer
                .bytes
                .extend_from_slice(&bytes[..bytes.len().min(room)]);
        }
    })
}

fn read_buffer(buffer: &SharedOutputBuffer) -> String {
    buffer
        .lock()
        .map(|buffer| String::from_utf8_lossy(&buffer.bytes).into_owned())
        .unwrap_or_default()
}

fn is_overflowed(buffer: &SharedOutputBuffer) -> bool {
    buffer.lock().is_ok_and(|buffer| buffer.is_overflowed)
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

    /// Waits until the command exits, the deadline (if any) passes or the run
    /// is cancelled.
    fn wait_until(
        &mut self,
        deadline: Option<Instant>,
        cancelled: &AtomicBool,
    ) -> std::io::Result<ProcessWaitOutcome> {
        loop {
            if let Some(status) = self.child.try_wait()? {
                return Ok(ProcessWaitOutcome::Exited(status));
            }
            if cancelled.load(Ordering::SeqCst) {
                return Ok(ProcessWaitOutcome::Cancelled);
            }
            if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
                return Ok(ProcessWaitOutcome::TimedOut);
            }
            thread::sleep(POLL_INTERVAL);
        }
    }

    /// The result of the exited command, and whether its stdout did not fit.
    fn finish(mut self, status: std::process::ExitStatus) -> (ScriptExecutionResult, bool) {
        let deadline = Instant::now() + PIPE_GRACE;
        for reader in &self.readers {
            reader.drain_until(deadline);
        }
        self.readers.clear();
        self.kill_and_reap_on_drop = false;
        let result = ScriptExecutionResult {
            is_success: status.success(),
            exit_code: status.code(),
            stdout: read_buffer(&self.stdout),
            stderr: read_buffer(&self.stderr),
            is_running: false,
        };
        (result, is_overflowed(&self.stdout))
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
    runs: &ScriptRuns,
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
        AppError::Failed(message)
    };

    variables::substitute(request.command, request.variables, variables::Place::Text)
        .inspect_err(|error| log.write(&empty_result(), Some(&error.to_string())))?;
    let working_dir = request
        .working_dir
        .map(|dir| variables::substitute(dir, request.variables, variables::Place::Text))
        .transpose()
        .inspect_err(|error| log.write(&empty_result(), Some(&error.to_string())))?;
    let cwd = resolve_working_dir(working_dir.as_deref())
        .map_err(|error| fail(&log, error.to_string()))?;
    let mut command = script_command(request);
    if let Some(cwd) = &cwd {
        command.current_dir(cwd);
        log.cwd = cwd.to_string_lossy().into_owned();
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let registration = runs.register(request.run_id).inspect_err(|error| {
        log.write(&empty_result(), Some(&error.to_string()));
    })?;
    let mut child = command
        .spawn()
        .map_err(|error| fail(&log, format!("Failed to start the command: {error}")))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let mut running = RunningScript::start(child, stdout, stderr)
        .map_err(|error| fail(&log, format!("Failed to read the command output: {error}")))?;

    let deadline = (!request.should_capture_output).then(|| Instant::now() + STATUS_WAIT);
    let status = running
        .wait_until(deadline, &registration.flag)
        .map_err(|error| fail(&log, format!("Failed to wait for the command: {error}")))?;

    match status {
        ProcessWaitOutcome::Exited(status) => {
            let (result, is_stdout_overflowed) = running.finish(status);
            // a cut output would pass for the whole one, e.g. replace a selection
            if is_stdout_overflowed && request.should_capture_output {
                log.write(&result, Some(SCRIPT_OUTPUT_TOO_LARGE));
                return Err(AppError::Failed(SCRIPT_OUTPUT_TOO_LARGE.into()));
            }
            log.write(&result, None);
            return Ok(result);
        }
        ProcessWaitOutcome::Cancelled => {
            return Err(fail(&log, String::from(SCRIPT_CANCELLED)));
        }
        ProcessWaitOutcome::TimedOut => {}
    }

    // left running, e.g. a GUI app; the outcome only goes to the log
    thread::spawn(move || {
        let status = running.child.wait();
        match status {
            Ok(status) => log.write(&running.finish(status).0, None),
            Err(error) => log.write(&empty_result(), Some(&error.to_string())),
        }
    });
    Ok(ScriptExecutionResult {
        is_running: true,
        ..empty_result()
    })
}

/// The shell command of `request`: the text and each variable it refers to
/// go by the environment, see `shell::substitute_all`.
fn script_command(request: &ScriptRequest) -> std::process::Command {
    let names = variables::references(request.command);
    let tokens: Vec<(String, String)> = names
        .iter()
        .map(|name| (variables::placeholder(name), VariableValues::env_name(name)))
        .collect();
    let selection = request.selection_text.unwrap_or_default();
    let mut placeholders = vec![
        shell::Placeholder {
            token: TEXT_PLACEHOLDER,
            env: shell::TEXT_ENV,
            value: request.text,
        },
        shell::Placeholder {
            token: SELECTION_PLACEHOLDER,
            env: shell::SELECTION_ENV,
            value: selection,
        },
    ];
    let resolved: Vec<String> = names
        .iter()
        .map(|name| request.variables.resolve(name).unwrap_or_default())
        .collect();
    for ((token, env), value) in tokens.iter().zip(&resolved) {
        placeholders.push(shell::Placeholder { token, env, value });
    }
    let mut command = shell::command(&shell::substitute_all(request.command, &placeholders));
    command.env(shell::TEXT_ENV, request.text);
    command.env(shell::SELECTION_ENV, selection);
    command.envs(request.variables.env());
    command
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
    use crate::services::background::StoppableService;
    use crate::services::test_support::TestDir;
    use std::fs;

    fn request<'a>(command: &'a str, text: &'a str) -> ScriptRequest<'a> {
        ScriptRequest {
            name: "Test",
            command,
            working_dir: None,
            text,
            selection_text: None,
            should_capture_output: true,
            should_log_output: false,
            run_id: None,
            variables: &NO_VARIABLES,
        }
    }

    static NO_VARIABLES: std::sync::LazyLock<VariableValues> =
        std::sync::LazyLock::new(VariableValues::default);

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

    /// Cancels the run `run_id` of `runs` as soon as it is registered.
    fn cancel_when_started(runs: &ScriptRuns, run_id: &str) -> thread::JoinHandle<()> {
        let runs = runs.clone();
        let run_id = run_id.to_owned();
        thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(5);
            while !runs.cancel(&run_id) && Instant::now() < deadline {
                thread::sleep(Duration::from_millis(10));
            }
        })
    }

    /// A cancellation stops the processes the command started too: they would
    /// run on and keep the output pipes open.
    #[cfg(unix)]
    #[test]
    fn integration_a_cancellation_stops_the_whole_process_tree() {
        let directory = TestDir::new("process-tree");
        let pid_file = directory.join("pid");
        let command = format!("sleep 30 & echo $! > '{}'; wait", pid_file.display());
        let run_id = format!("tree-test-{}", std::process::id());
        let runs = ScriptRuns::default();
        // the pid file must exist before the run is cancelled
        let canceller = {
            let runs = runs.clone();
            let run_id = run_id.clone();
            let pid_file = pid_file.clone();
            thread::spawn(move || {
                let deadline = Instant::now() + Duration::from_secs(5);
                while !pid_file.exists() && Instant::now() < deadline {
                    thread::sleep(Duration::from_millis(10));
                }
                thread::sleep(Duration::from_millis(50));
                runs.cancel(&run_id);
            })
        };

        let started = Instant::now();
        let result = execute_script(
            &runs,
            &ScriptRequest {
                run_id: Some(&run_id),
                ..request(&command, "")
            },
            None,
        );
        canceller.join().unwrap();
        assert_eq!(result.unwrap_err().to_string(), SCRIPT_CANCELLED);
        assert!(started.elapsed() < Duration::from_secs(10));

        let pid: i32 = fs::read_to_string(&pid_file)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        let _ = fs::remove_file(&pid_file);
        let deadline = Instant::now() + Duration::from_secs(2);
        while unsafe { libc::kill(pid, 0) } == 0 {
            assert!(
                Instant::now() < deadline,
                "the child process still runs after the cancellation"
            );
            thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn integration_passes_the_text_through_the_placeholder() {
        let text = "don't \"stop\" $HOME";
        let result = execute_script(
            &ScriptRuns::default(),
            &request(commands::ECHO_PLACEHOLDER, text),
            None,
        )
        .unwrap();
        assert!(result.is_success, "{}", result.stderr);
        assert_eq!(result.stdout, text);
    }

    #[test]
    fn integration_does_not_pass_text_to_stdin() {
        let result = execute_script(
            &ScriptRuns::default(),
            &request(commands::CAT, "input text"),
            None,
        )
        .unwrap();
        assert!(result.is_success, "{}", result.stderr);
        assert_eq!(result.stdout, "");
    }

    #[test]
    fn integration_runs_in_the_home_directory_by_default() {
        let result =
            execute_script(&ScriptRuns::default(), &request(commands::PWD, ""), None).unwrap();
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
            &ScriptRuns::default(),
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
            &ScriptRuns::default(),
            &ScriptRequest {
                working_dir: Some("/no/such/tyco/dir"),
                ..request(commands::PWD, "")
            },
            None,
        );
        assert!(result.is_err());
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn integration_fills_variables_quoted_and_passes_them_in_the_environment() {
        let dir = TestDir::new("script-variables");
        let nasty = "it's \"x\" $HOME `id` {{TEXT}} {{var:OTHER}}";
        let variables = VariableValues::from_pairs(&[
            ("NOTES_DIR", nasty),
            ("OTHER", "other"),
            (variables::USER_DIR, "/sync/tyco"),
            ("ROOT", dir.to_str().unwrap()),
            ("WORK", "{{var:ROOT}}"),
        ]);
        let result = execute_script(
            &ScriptRuns::default(),
            &ScriptRequest {
                working_dir: Some("{{var:WORK}}"),
                variables: &variables,
                ..request(
                    "printf '%s|%s|%s|%s|' {{var:NOTES_DIR}} \"$TYCO_VAR_OTHER\" \"$TYCO_USER_DIR\" {{TEXT}}; pwd",
                    "text",
                )
            },
            None,
        )
        .unwrap();
        let (printed, cwd) = result.stdout.rsplit_once('|').unwrap();
        assert_eq!(
            printed,
            format!(
                "{}|other|/sync/tyco|text",
                nasty.replace("{{var:OTHER}}", "other")
            )
        );
        assert_eq!(
            PathBuf::from(cwd.trim()).canonicalize().unwrap(),
            dir.canonicalize().unwrap()
        );
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn integration_substitutes_selection_and_exports_tyco_selection_env() {
        let result = execute_script(
            &ScriptRuns::default(),
            &ScriptRequest {
                selection_text: Some("selected quote's"),
                ..request(
                    "printf '%s|%s' {{SELECTION}} \"$TYCO_SELECTION\"",
                    "ignored",
                )
            },
            None,
        )
        .unwrap();
        assert_eq!(result.stdout, "selected quote's|selected quote's");
    }

    #[test]
    fn cyclic_or_missing_nested_values_stop_scripts_before_starting() {
        for (value, cyclic) in [("{{var:CHILD}}", true), ("{{var:UNSET}}", false)] {
            let variables =
                VariableValues::from_pairs(&[("ROOT", value), ("CHILD", "{{var:ROOT}}")]);
            let error = execute_script(
                &ScriptRuns::default(),
                &ScriptRequest {
                    variables: &variables,
                    ..request("{{var:ROOT}}", "")
                },
                None,
            )
            .unwrap_err();
            if cyclic {
                assert!(
                    matches!(error, AppError::InvalidInput(message) if message.contains("ROOT"))
                );
            } else {
                assert!(
                    matches!(error, AppError::VariableNotSet(message) if message.contains("UNSET"))
                );
            }
        }
    }

    #[test]
    fn a_variable_without_a_value_stops_the_script_before_it_starts() {
        let dir = TestDir::new("script-missing-variable");
        let marker = dir.join("ran");
        let command = format!("touch {}; echo {{{{var:NOTES_DIR}}}}", marker.display());
        let error =
            execute_script(&ScriptRuns::default(), &request(&command, ""), None).unwrap_err();
        assert!(
            matches!(&error, AppError::VariableNotSet(message) if message.contains("NOTES_DIR"))
        );
        assert!(!marker.exists());
        let error = execute_script(
            &ScriptRuns::default(),
            &ScriptRequest {
                working_dir: Some("{{var:WORK}}"),
                ..request("true", "")
            },
            None,
        )
        .unwrap_err();
        assert!(matches!(&error, AppError::VariableNotSet(message) if message.contains("WORK")));
    }

    #[test]
    fn integration_leaves_a_long_command_running_when_its_output_is_not_needed() {
        let started = Instant::now();
        let result = execute_script(
            &ScriptRuns::default(),
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

    #[cfg(unix)]
    #[test]
    fn integration_an_output_too_large_fails_instead_of_being_cut() {
        let command = format!("head -c {} /dev/zero", MAX_OUTPUT_BYTES + 1);
        let error =
            execute_script(&ScriptRuns::default(), &request(&command, ""), None).unwrap_err();
        assert_eq!(error.to_string(), SCRIPT_OUTPUT_TOO_LARGE);

        let command = format!("head -c {MAX_OUTPUT_BYTES} /dev/zero");
        let result = execute_script(&ScriptRuns::default(), &request(&command, ""), None).unwrap();
        assert_eq!(result.stdout.len(), MAX_OUTPUT_BYTES);
    }

    #[test]
    fn integration_kills_a_cancelled_command() {
        let run_id = format!("cancel-test-{}", std::process::id());
        let runs = ScriptRuns::default();
        let canceller = cancel_when_started(&runs, &run_id);
        let started = Instant::now();
        let result = execute_script(
            &runs,
            &ScriptRequest {
                run_id: Some(&run_id),
                ..request(commands::SLEEP, "")
            },
            None,
        );
        canceller.join().unwrap();
        assert_eq!(result.unwrap_err().to_string(), SCRIPT_CANCELLED);
        assert!(started.elapsed() < Duration::from_secs(10));
        assert!(!runs.cancel(&run_id), "the run is forgotten once done");
    }

    #[test]
    fn integration_reports_a_failure() {
        let result = execute_script(&ScriptRuns::default(), &request("exit 3", ""), None).unwrap();
        assert!(!result.is_success);
        assert_eq!(result.exit_code, Some(3));
    }

    #[test]
    fn integration_logs_the_command_without_the_text() {
        let dir = TestDir::new("process-log");
        let result = execute_script(
            &ScriptRuns::default(),
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
        let runs = ScriptRuns::default();
        let registration = runs.register(Some("duplicate-test")).unwrap();
        assert!(runs.register(Some("duplicate-test")).is_err());
        assert!(runs.cancel("duplicate-test"));
        assert!(registration.flag.load(Ordering::SeqCst));
        drop(registration);
        assert!(!runs.cancel("duplicate-test"));
    }

    #[test]
    fn application_registries_are_independent_and_shutdown_waits_for_unnamed_runs() {
        let first = ScriptRuns::default();
        let second = ScriptRuns::default();
        let named = first.register(Some("same-id")).unwrap();
        let other = second.register(Some("same-id")).unwrap();
        let unnamed = first.register(None).unwrap();
        first.stop();
        assert!(named.flag.load(Ordering::SeqCst));
        assert!(unnamed.flag.load(Ordering::SeqCst));
        assert!(!other.flag.load(Ordering::SeqCst));
        assert!(first.register(None).is_err());
        assert!(!first.wait_until(Instant::now()));
        drop(named);
        drop(unnamed);
        assert!(first.wait_until(Instant::now()));
    }

    #[test]
    fn cancels_all_running_scripts() {
        let runs = ScriptRuns::default();
        let reg1 = runs.register(Some("run-1")).unwrap();
        let reg2 = runs.register(None).unwrap();
        assert!(!reg1.flag.load(Ordering::SeqCst));
        assert!(!reg2.flag.load(Ordering::SeqCst));

        runs.stop();

        assert!(reg1.flag.load(Ordering::SeqCst));
        assert!(reg2.flag.load(Ordering::SeqCst));
    }
}
