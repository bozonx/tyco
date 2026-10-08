use std::env;
use std::io::{self, Read, Write};
use std::time::{Duration, Instant};

use tyco_activation_protocol::{
    is_start_mode, transport, Job, JobState, OutputMode, Request, Response, RunRequest,
    MAX_MESSAGE_BYTES,
};

const USAGE: &str = "Usage: tyco-ctl status
       tyco-ctl open <mode> [--text TEXT | --selection]
       tyco-ctl commands <list [--json] | describe <id> [--name]>
       tyco-ctl run <id> [--name] [--text TEXT | --stdin | --input-json JSON | --selection]
                    [--replace] [--interactive] [--output return|configured]
                    [--wait] [--json] [--timeout SECONDS]
       tyco-ctl jobs <status|cancel|wait> <job-id> [--json] [--timeout SECONDS]
       tyco-ctl quit

Use --stdin for private text. Input is preserved exactly.
Run defaults to non-interactive execution and returned output.
Tyco must already be running in the same user session.";

#[derive(Debug, PartialEq, Eq)]
struct Command {
    request: Request,
    stdin: bool,
    wait: bool,
    json: bool,
    timeout: u64,
}

fn mode(value: &str) -> String {
    tyco_activation_protocol::canonical_mode(value).into()
}

fn parse(args: &[String]) -> Result<Command, String> {
    let mut command = Command {
        request: Request::Status,
        stdin: false,
        wait: false,
        json: false,
        timeout: 300,
    };
    let Some(action) = args.first().map(String::as_str) else {
        return Err(USAGE.into());
    };
    let value = |index: usize| args.get(index).cloned().ok_or_else(|| USAGE.to_owned());
    match action {
        "status" | "quit" if args.len() == 1 => {
            command.request = if action == "quit" {
                Request::Quit
            } else {
                Request::Status
            }
        }
        "commands" => match args.get(1).map(String::as_str) {
            Some("list") => {
                if args.iter().skip(2).any(|arg| arg != "--json") || args.len() > 3 {
                    return Err(USAGE.into());
                }
                command.request = Request::ListCommands;
            }
            Some("describe") => {
                let target = value(2)?;
                if args.len() > 4 || args.get(3).is_some_and(|arg| arg != "--name") {
                    return Err(USAGE.into());
                }
                command.request = Request::DescribeCommand {
                    target,
                    by_name: args.len() == 4,
                };
            }
            _ => return Err(USAGE.into()),
        },
        "open" => {
            let mode = mode(&value(1)?);
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
        "run" => {
            let mut request = RunRequest {
                target: value(1)?,
                ..Default::default()
            };
            if request.target.trim().is_empty() {
                return Err("Command ID is empty".into());
            }
            let mut index = 2;
            let mut input_set = false;
            while index < args.len() {
                match args[index].as_str() {
                    "--name" => request.by_name = true,
                    "--interactive" => request.interactive = true,
                    "--replace" => request.replace = true,
                    "--wait" => command.wait = true,
                    "--json" => command.json = true,
                    "--timeout" => {
                        index += 1;
                        command.timeout = value(index)?.parse().map_err(|_| "Invalid timeout")?;
                    }
                    "--output" => {
                        index += 1;
                        request.output = match value(index)?.as_str() {
                            "return" => OutputMode::Return,
                            "configured" => OutputMode::Configured,
                            _ => return Err("Invalid output mode".into()),
                        };
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
            command.request = Request::Run { request };
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
                    "--json" => command.json = true,
                    "--timeout" => {
                        index += 1;
                        command.timeout = value(index)?.parse().map_err(|_| "Invalid timeout")?;
                    }
                    _ => return Err(USAGE.into()),
                }
                index += 1;
            }
        }
        _ => return Err(USAGE.into()),
    }
    if command.timeout == 0 || command.timeout > 3600 {
        return Err("Timeout must be between 1 and 3600 seconds".into());
    }
    Ok(command)
}

fn checked(response: Response) -> Result<Response, (i32, String)> {
    if response.success {
        return Ok(response);
    }
    let code = response.code.as_deref().unwrap_or("Failed");
    let exit = match code {
        "InvalidArgs" | "InvalidInput" | "InputRequired" | "InvalidRequest" => 2,
        "AccessDenied" | "ConfirmationRequired" | "InteractionRequired" => 3,
        "NotFound" | "Unavailable" | "NotReady" => 4,
        "TimedOut" => 6,
        "Cancelled" => 7,
        _ => 5,
    };
    Err((
        exit,
        format!("{code}: {}", response.error.unwrap_or_default()),
    ))
}

fn send(request: &Request) -> Result<Response, (i32, String)> {
    checked(transport::send(request).map_err(|error| (4, error))?)
}

fn wait(mut job: Job, timeout: u64) -> Result<Job, (i32, String)> {
    let deadline = Instant::now() + Duration::from_secs(timeout);
    while !job.state.is_terminal() {
        if Instant::now() >= deadline {
            return Err((
                6,
                format!(
                    "TimedOut: waiting for {}; the job may still be running",
                    job.id
                ),
            ));
        }
        std::thread::sleep(Duration::from_millis(100));
        let response = send(&Request::JobStatus { id: job.id.clone() })?;
        job = serde_json::from_str(response.output.as_deref().unwrap_or(""))
            .map_err(|error| (5, format!("Invalid job response: {error}")))?;
    }
    Ok(job)
}

fn run() -> Result<(), (i32, String)> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if args.as_slice() == ["--help"] || args.as_slice() == ["-h"] {
        println!("{USAGE}");
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
    let mut command = parse(&args).map_err(|error| (2, error))?;
    if command.stdin {
        let mut text = String::new();
        io::stdin()
            .take((MAX_MESSAGE_BYTES + 1) as u64)
            .read_to_string(&mut text)
            .map_err(|error| (2, error.to_string()))?;
        if text.len() > MAX_MESSAGE_BYTES {
            return Err((2, "Input is too large".into()));
        }
        if let Request::Run { request } = &mut command.request {
            request.text = Some(text);
        }
    }
    let response = send(&command.request)?;
    if command.wait {
        let job: Job = serde_json::from_str(response.output.as_deref().unwrap_or(""))
            .map_err(|error| (5, format!("Invalid job response: {error}")))?;
        let job = wait(job, command.timeout)?;
        if command.json {
            println!("{}", serde_json::to_string(&job).unwrap());
        }
        if job.state != JobState::Succeeded {
            return checked(Response::coded_error(
                job.code.unwrap_or_else(|| "ExecutionFailed".into()),
                job.error.unwrap_or_else(|| "Command failed".into()),
            ))
            .map(|_| ());
        }
        if !command.json {
            if let Some(output) = job.output {
                io::stdout()
                    .write_all(output.as_bytes())
                    .map_err(|error| (5, error.to_string()))?;
            }
        }
    } else if let Some(output) = response.output {
        println!("{output}");
    }
    Ok(())
}

fn main() {
    if let Err((code, error)) = run() {
        eprintln!("{error}");
        std::process::exit(code);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn command(args: &[&str]) -> Result<Command, String> {
        parse(&args.iter().map(|arg| (*arg).into()).collect::<Vec<_>>())
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
        assert!(command(&["run", "test", "--replace"]).is_err());
        assert!(command(&["run", "test", "--stdin", "--text", "x"]).is_err());
        assert!(command(&["run", "test", "--input-json", "[]"]).is_err());
        assert!(command(&["jobs", "wait", "job-1", "--timeout", "0"]).is_err());
    }
    #[test]
    fn errors_have_stable_exit_codes() {
        assert_eq!(
            checked(Response::coded_error("AccessDenied", "blocked"))
                .unwrap_err()
                .0,
            3
        );
        assert_eq!(
            checked(Response::coded_error("ExecutionFailed", "failed"))
                .unwrap_err()
                .0,
            5
        );
    }
}
