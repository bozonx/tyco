use std::env;
use std::io::{self, Read, Write};
use std::time::{Duration, Instant};

use tyco_activation_protocol::{
    is_start_mode, transport, ErrorCode, Job, JobState, Request, Response, RunRequest,
    MAX_MESSAGE_BYTES,
};

const USAGE: &str = "Usage: tyco-ctl status
       tyco-ctl open <mode> [--text TEXT | --selection]
       tyco-ctl commands list [--json]
       tyco-ctl commands describe <id | --name NAME>
       tyco-ctl run <id | --name NAME> [--text TEXT | --stdin | --input-json JSON | --selection]
                    [--replace] [--interactive]
                    [--wait] [--json] [--timeout SECONDS]
       tyco-ctl replace correction
       tyco-ctl jobs list [--json]
       tyco-ctl jobs <status|cancel|wait> <job-id> [--json] [--timeout SECONDS]

Modes: editor, write, chat, voice-chat, voice-commands, voice, select, ai-tasks,
       command-launcher, correction, translate, history, settings.
Use --stdin for private text. Input is preserved exactly.
Run defaults to non-interactive execution and always returns output.
Use --replace to replace a selection.
replace correction corrects the selection in place, as its hotkey does.
All requests accept --json to format results and stderr errors as JSON.
Use <command> --help for command help.
Tyco must already be running in the same user session.";

#[derive(Debug, PartialEq, Eq)]
struct CliInvocation {
    request: Request,
    stdin: bool,
    wait: bool,
    json: bool,
    /// `None` until `--timeout` is given; it only bounds `--wait`.
    timeout_secs: Option<u64>,
}

const DEFAULT_JOB_WAIT_TIMEOUT_SECS: u64 = 300;

fn canonical_activation_mode(value: &str) -> String {
    tyco_activation_protocol::canonical_mode(value).into()
}

fn parse_cli_invocation(args: &[String]) -> Result<CliInvocation, String> {
    let mut filtered = Vec::new();
    let mut json = false;
    let mut args = args.iter();
    while let Some(arg) = args.next() {
        if arg == "--json" {
            if json {
                return Err("--json may only be specified once".into());
            }
            json = true;
        } else {
            filtered.push(arg.clone());
            if matches!(
                arg.as_str(),
                "--text" | "--input-json" | "--name" | "--timeout"
            ) {
                if let Some(value) = args.next() {
                    filtered.push(value.clone());
                }
            }
        }
    }
    let args = filtered.as_slice();
    let mut command = CliInvocation {
        request: Request::Status,
        stdin: false,
        wait: false,
        json,
        timeout_secs: None,
    };
    let Some(action) = args.first().map(String::as_str) else {
        return Err(USAGE.into());
    };
    let value = |index: usize| args.get(index).cloned().ok_or_else(|| USAGE.to_owned());
    match action {
        "status" if args.len() == 1 => command.request = Request::Status,
        "commands" => match args.get(1).map(String::as_str) {
            Some("list") => {
                if args.len() != 2 {
                    return Err(USAGE.into());
                }
                command.request = Request::ListCommands;
            }
            Some("describe") => {
                let (target, by_name) = match &args[2..] {
                    [flag, name] if flag == "--name" => (name.clone(), true),
                    [id] if id != "--name" => (id.clone(), false),
                    _ => return Err(USAGE.into()),
                };
                command.request = Request::DescribeCommand { target, by_name };
            }
            _ => return Err(USAGE.into()),
        },
        "open" => {
            let mode = canonical_activation_mode(&value(1)?);
            if !is_start_mode(&mode) {
                return Err(format!("Unknown mode: {mode}"));
            }
            let mut text = None;
            let mut selection = false;
            let mut index = 2;
            while index < args.len() {
                match args[index].as_str() {
                    "--text" if text.is_none() => {
                        index += 1;
                        text = Some(value(index)?);
                    }
                    "--selection" if !selection => selection = true,
                    _ => return Err(USAGE.into()),
                }
                index += 1;
            }
            if selection && text.is_some() {
                return Err("Choose text or selection".into());
            }
            command.request = Request::Open {
                mode,
                text,
                selection,
            };
        }
        "replace" => match &args[1..] {
            [action] if action == "correction" => {
                command.request = Request::ReplaceSelection {
                    action: action.clone(),
                }
            }
            _ => return Err(USAGE.into()),
        },
        "run" => {
            let by_name = args.get(1).is_some_and(|arg| arg == "--name");
            let mut request = RunRequest {
                target: value(if by_name { 2 } else { 1 })?,
                by_name,
                ..Default::default()
            };
            if request.target.trim().is_empty() {
                return Err("Command ID is empty".into());
            }
            let mut index = if by_name { 3 } else { 2 };
            let mut input_set = false;
            while index < args.len() {
                match args[index].as_str() {
                    "--interactive" => request.interactive = true,
                    "--replace" => request.replace = true,
                    "--wait" => command.wait = true,
                    "--timeout" => {
                        index += 1;
                        command.timeout_secs =
                            Some(value(index)?.parse().map_err(|_| "Invalid timeout")?);
                    }
                    "--text" | "--input-json" if !input_set => {
                        let json = args[index] == "--input-json";
                        index += 1;
                        let input = value(index)?;
                        if json {
                            request.input =
                                Some(serde_json::from_str(&input).map_err(|error| {
                                    format!("Input must be a JSON object: {error}")
                                })?);
                        } else {
                            request.text = Some(input);
                        }
                        input_set = true;
                    }
                    "--stdin" if !input_set => {
                        command.stdin = true;
                        input_set = true;
                    }
                    "--selection" if !input_set => {
                        request.selection = true;
                        input_set = true;
                    }
                    _ => return Err(USAGE.into()),
                }
                index += 1;
            }
            if request.replace && !request.selection {
                return Err("--replace requires --selection".into());
            }
            if !command.wait && command.timeout_secs.is_some() {
                return Err("--timeout requires --wait".into());
            }
            command.request = Request::Run { request };
        }
        "jobs" if args.get(1).is_some_and(|arg| arg == "list") => {
            if args.len() != 2 {
                return Err(USAGE.into());
            }
            command.request = Request::ListJobs;
        }
        "jobs" => {
            let action = value(1)?;
            let id = value(2)?;
            command.request = match action.as_str() {
                "status" | "wait" => Request::JobStatus { id },
                "cancel" => Request::JobCancel { id },
                _ => return Err(USAGE.into()),
            };
            command.wait = action == "wait";
            let mut index = 3;
            while index < args.len() {
                match args[index].as_str() {
                    "--timeout" if command.wait => {
                        index += 1;
                        command.timeout_secs =
                            Some(value(index)?.parse().map_err(|_| "Invalid timeout")?);
                    }
                    _ => return Err(USAGE.into()),
                }
                index += 1;
            }
        }
        _ => return Err(USAGE.into()),
    }
    if command
        .timeout_secs
        .is_some_and(|timeout| timeout == 0 || timeout > 3600)
    {
        return Err("Timeout must be between 1 and 3600 seconds".into());
    }
    Ok(command)
}

#[derive(Debug)]
struct CliError {
    exit_code: i32,
    code: String,
    message: String,
}

impl CliError {
    fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            exit_code: code.exit_code(),
            code: code.into(),
            message: message.into(),
        }
    }

    fn json(&self) -> serde_json::Value {
        serde_json::json!({ "success": false, "code": self.code, "error": self.message })
    }
}

fn ensure_success_response(response: Response) -> Result<Response, CliError> {
    if response.success {
        return Ok(response);
    }
    let exit = response.error_code().exit_code();
    let code = response
        .code
        .as_deref()
        .unwrap_or(ErrorCode::Failed.as_str());
    Err(CliError {
        exit_code: exit,
        code: code.into(),
        message: response.error.unwrap_or_default(),
    })
}

fn send(request: &Request) -> Result<Response, CliError> {
    ensure_success_response(
        transport::send(request).map_err(|error| CliError::new(ErrorCode::Unavailable, error))?,
    )
}

fn decode_job_response(response: Response) -> Result<Job, CliError> {
    serde_json::from_value(response.result.unwrap_or_default())
        .map_err(|error| CliError::new(ErrorCode::Failed, format!("Invalid job response: {error}")))
}

/// `id<TAB>name` lines, for people; `--json` gives the full list.
fn command_lines(list: &serde_json::Value) -> String {
    list.as_array()
        .into_iter()
        .flatten()
        .map(|command| {
            let field = |key| command[key].as_str().unwrap_or_default();
            format!("{}\t{}\n", field("id"), field("name"))
        })
        .collect()
}

fn wait_for_job(mut job: Job, timeout_secs: u64) -> Result<Job, CliError> {
    let deadline = Instant::now() + Duration::from_secs(timeout_secs);
    while !job.state.is_terminal() {
        if Instant::now() >= deadline {
            return Err(CliError::new(
                ErrorCode::TimedOut,
                format!("Waiting for {}; the job may still be running", job.id),
            ));
        }
        std::thread::sleep(Duration::from_millis(100));
        job = decode_job_response(send(&Request::JobStatus { id: job.id.clone() })?)?;
    }
    Ok(job)
}

fn help(args: &[String]) -> Option<&'static str> {
    let path = args.iter().map(String::as_str).collect::<Vec<_>>();
    let (flag, command) = path.split_last()?;
    if !matches!(*flag, "--help" | "-h") {
        return None;
    }
    Some(match command {
        [] => USAGE,
        ["status"] => "Usage: tyco-ctl status\nPrint application status and selection permission as JSON.",
        ["open"] => "Usage: tyco-ctl open <mode> [--text TEXT | --selection]\nOpen a window; selection capture requires permission. See tyco-ctl --help for modes.",
        ["commands"] => "Usage: tyco-ctl commands <list [--json] | describe <id | --name NAME>>\nDiscover callable commands and inspect their accepted input without executing them.",
        ["commands", "list"] => "Usage: tyco-ctl commands list [--json]\nPrint callable commands as id<TAB>name lines, or JSON with --json.",
        ["commands", "describe"] => "Usage: tyco-ctl commands describe <id | --name NAME>\nPrint the command's effective input schema and capabilities as JSON.",
        ["run"] => "Usage: tyco-ctl run <id | --name NAME> [--text TEXT | --stdin | --input-json JSON | --selection]\n       [--replace] [--interactive] [--wait] [--json] [--timeout SECONDS]\nSubmit a library command. Without --wait, returns a job. With --wait, returns output.\n--json formats results and stderr errors as JSON. --timeout only bounds waiting.\nInput sources are exclusive; --replace requires --selection. Use --stdin for private text.",
        ["replace"] | ["replace", "correction"] => "Usage: tyco-ctl replace correction\nRequest correction of the current selection without waiting; requires selection permission.",
        ["jobs"] => "Usage: tyco-ctl jobs list [--json]\n       tyco-ctl jobs <status|cancel|wait> <job-id> [--json] [--timeout SECONDS]\nInspect retained invocations, cancel work, or collect results. Only wait accepts --timeout.",
        ["jobs", "list"] => "Usage: tyco-ctl jobs list [--json]\nPrint retained jobs as JSON, newest first, without output or error details. Use status for details.",
        ["jobs", "status"] => "Usage: tyco-ctl jobs status <job-id> [--json]\nPrint job details as JSON. Exit 0 means the job was found, even if it failed.",
        ["jobs", "cancel"] => "Usage: tyco-ctl jobs cancel <job-id> [--json]\nRequest cancellation and print job JSON. Does not roll back side effects.",
        ["jobs", "wait"] => "Usage: tyco-ctl jobs wait <job-id> [--json] [--timeout SECONDS]\nWait for completion; return output or full terminal job JSON. Exit with the job's result.\nTimeout defaults to 300 seconds (1-3600); a client timeout does not cancel the job.",
        _ => return None,
    })
}

/// Ignore values of input flags: text containing --json is not an option.
fn wants_json_errors(args: &[String]) -> bool {
    let mut args = args.iter();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--json" => return true,
            "--text" | "--input-json" | "--name" | "--timeout" => {
                args.next();
            }
            _ => {}
        }
    }
    false
}

fn run() -> Result<(), CliError> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if let Some(help) = help(&args) {
        println!("{help}");
        return Ok(());
    }
    if args.as_slice() == ["--version"] {
        println!(
            "tyco-ctl {} (API {})",
            env!("CARGO_PKG_VERSION"),
            tyco_activation_protocol::API_VERSION
        );
        return Ok(());
    }
    let mut command = parse_cli_invocation(&args)
        .map_err(|error| CliError::new(ErrorCode::InvalidInput, error))?;
    if command.stdin {
        let mut text = String::new();
        io::stdin()
            .take((MAX_MESSAGE_BYTES + 1) as u64)
            .read_to_string(&mut text)
            .map_err(|error| CliError::new(ErrorCode::InvalidInput, error.to_string()))?;
        if text.len() > MAX_MESSAGE_BYTES {
            return Err(CliError::new(ErrorCode::InvalidInput, "Input is too large"));
        }
        if let Request::Run { request } = &mut command.request {
            request.text = Some(text);
        }
    }
    let response = send(&command.request)?;
    if command.wait {
        let job = wait_for_job(
            decode_job_response(response)?,
            command
                .timeout_secs
                .unwrap_or(DEFAULT_JOB_WAIT_TIMEOUT_SECS),
        )?;
        if command.json {
            println!("{}", serde_json::to_string(&job).unwrap());
        }
        if job.state != JobState::Succeeded {
            // the job's own code, even one this version does not know
            return ensure_success_response(Response {
                code: Some(
                    job.code
                        .unwrap_or_else(|| ErrorCode::ExecutionFailed.into()),
                ),
                ..Response::error(job.error.unwrap_or_else(|| "Command failed".into()))
            })
            .map(|_| ());
        }
        if !command.json {
            if let Some(output) = job.output {
                io::stdout()
                    .write_all(output.as_bytes())
                    .map_err(|error| CliError::new(ErrorCode::Failed, error.to_string()))?;
            }
        }
    } else if let Some(result) = response.result {
        if matches!(command.request, Request::ListCommands) && !command.json {
            print!("{}", command_lines(&result));
        } else {
            println!("{result}");
        }
    }
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        if wants_json_errors(&env::args().skip(1).collect::<Vec<_>>()) {
            eprintln!("{}", error.json());
        } else {
            eprintln!("{}: {}", error.code, error.message);
        }
        std::process::exit(error.exit_code);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn command(args: &[&str]) -> Result<CliInvocation, String> {
        parse_cli_invocation(&args.iter().map(|arg| (*arg).into()).collect::<Vec<_>>())
    }
    #[test]
    fn discovery_help_and_removed_shutdown_are_explicit() {
        assert!(command(&["quit"]).is_err());
        assert!(command(&["status", "--json"]).unwrap().json);
        assert!(
            command(&["commands", "describe", "fix", "--json"])
                .unwrap()
                .json
        );
        assert_eq!(
            command(&["jobs", "list"]).unwrap().request,
            Request::ListJobs
        );
        assert!(command(&["jobs", "list", "job-1"]).is_err());
        assert!(command(&["jobs", "list", "--timeout", "1"]).is_err());
        for args in [
            vec!["run", "--help"],
            vec!["jobs", "wait", "-h"],
            vec!["commands", "describe", "--help"],
        ] {
            assert!(help(&args.iter().map(|arg| (*arg).into()).collect::<Vec<_>>()).is_some());
        }
        assert!(help(&["quit".into(), "--help".into()]).is_none());
    }

    #[test]
    fn json_errors_preserve_machine_codes_and_ignore_text_values() {
        assert_eq!(
            CliError::new(ErrorCode::AccessDenied, "denied").json(),
            serde_json::json!({"success":false,"code":"AccessDenied","error":"denied"})
        );
        assert_eq!(
            CliError::new(ErrorCode::InvalidInput, "Invalid timeout").json()["code"],
            "InvalidInput"
        );
        let error = ensure_success_response(Response {
            code: Some("FutureCode".into()),
            ..Response::error("details")
        })
        .unwrap_err();
        assert_eq!(error.json()["code"], "FutureCode");
        assert_eq!(error.exit_code, 5);
        assert!(!wants_json_errors(&[
            "run".into(),
            "fix".into(),
            "--text".into(),
            "--json".into()
        ]));
    }

    #[test]
    fn explicit_run_options_reject_legacy_aliases() {
        let parsed = command(&["run", "test", "--stdin", "--wait"]).unwrap();
        assert!(parsed.stdin && parsed.wait);
        let Request::Run { request } = parsed.request else {
            panic!()
        };
        assert!(!request.interactive && !request.selection);
        assert!(command(&["activate", "commandLauncher"]).is_err());
        assert!(command(&["commands"]).is_err());
        assert!(command(&["run", "test", "text"]).is_err());
        assert!(command(&["run", "test", "-"]).is_err());
        assert!(command(&["open", "command-launcher", "--selection"]).is_ok());
        assert!(command(&["replace", "command:test"]).is_err());
        assert!(command(&["replace", "correction"]).is_ok());
        assert!(command(&["replace", "correction", "--selection"]).is_err());
        assert!(command(&["run", "test", "--replace"]).is_err());
        assert!(command(&["run", "test", "--stdin", "--text", "x"]).is_err());
        assert!(command(&["run", "test", "--input-json", "[]"]).is_err());
        assert!(command(&["jobs", "wait", "job-1", "--timeout", "0"]).is_err());
        assert!(command(&["jobs", "status", "job-1", "--timeout", "5"]).is_err());
        assert!(command(&["run", "test", "--stdin", "--json"]).is_ok());
        assert!(command(&["run", "test", "--stdin", "--timeout", "5"]).is_err());
        assert!(command(&["run", "test", "--stdin", "--wait", "--timeout", "5"]).is_ok());
    }

    #[test]
    fn names_a_command_with_the_flag_before_the_name() {
        let run = |args: &[&str]| match command(args).unwrap().request {
            Request::Run { request } => (request.target, request.by_name),
            _ => panic!(),
        };
        assert_eq!(run(&["run", "--name", "ls"]), ("ls".into(), true));
        assert!(command(&["run", "ls", "--name"]).is_err());
        assert_eq!(run(&["run", "ls"]), ("ls".into(), false));
        assert!(command(&["run", "--name"]).is_err());
        assert!(command(&["run", "--name", "ls", "--name"]).is_err());

        let describe = |args: &[&str]| match command(args).unwrap().request {
            Request::DescribeCommand { target, by_name } => (target, by_name),
            _ => panic!(),
        };
        let name = ("My command".to_owned(), true);
        assert_eq!(
            describe(&["commands", "describe", "--name", "My command"]),
            name
        );
        assert!(command(&["commands", "describe", "My command", "--name"]).is_err());
        assert_eq!(
            describe(&["commands", "describe", "ls"]),
            ("ls".into(), false)
        );
        assert!(command(&["commands", "describe", "--name"]).is_err());
    }

    #[test]
    fn lists_commands_for_people_unless_json_is_asked() {
        assert!(!command(&["commands", "list"]).unwrap().json);
        assert!(command(&["commands", "list", "--json"]).unwrap().json);
        assert!(command(&["commands", "list", "--json", "--json"]).is_err());
        let list = serde_json::json!([
            { "id": "fix", "name": "Fix", "input": "text" },
            { "id": "backup", "name": "Бэкап", "input": "none" }
        ]);
        assert_eq!(command_lines(&list), "fix\tFix\nbackup\tБэкап\n");
    }
    #[test]
    fn errors_have_stable_exit_codes() {
        assert_eq!(
            ensure_success_response(Response::coded_error(ErrorCode::AccessDenied, "blocked"))
                .unwrap_err()
                .exit_code,
            3
        );
        assert_eq!(
            ensure_success_response(Response::coded_error(ErrorCode::ExecutionFailed, "failed"))
                .unwrap_err()
                .exit_code,
            5
        );
        assert_eq!(
            ensure_success_response(Response::coded_error(ErrorCode::AmbiguousName, "twins"))
                .unwrap_err()
                .exit_code,
            2
        );
        assert_eq!(
            ensure_success_response(Response::coded_error(ErrorCode::Busy, "busy"))
                .unwrap_err()
                .exit_code,
            4
        );
    }
}
