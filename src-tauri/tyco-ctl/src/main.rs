use std::env;
use std::io::{self, BufReader, Read};
use std::net::TcpStream;

use tyco_activation_protocol::{
    is_selection_action, is_start_mode, read_message, write_message, Request, Response,
    ACTIVATION_ADDRESS,
};

const USAGE: &str = "Usage: tyco-ctl activate <mode>
       tyco-ctl replace <correction|translate.N|aiTask.N>
       tyco-ctl run <command id or name> [text... | -]
       tyco-ctl commands
       tyco-ctl quit

`run` takes the text from the arguments, or from stdin when it is `-`;
stdin keeps the text away from the process list.";

/// Where the text of `run` comes from.
#[derive(Debug, PartialEq, Eq)]
enum TextSource {
    None,
    Args(String),
    Stdin,
}

#[derive(Debug, PartialEq, Eq)]
enum Command {
    Send(Request),
    Run { target: String, text: TextSource },
}

fn parse_args(args: impl IntoIterator<Item = String>) -> Result<Command, String> {
    let args = args.into_iter().collect::<Vec<_>>();
    if let [command, target, text @ ..] = args.as_slice() {
        if command == "run" {
            if target.trim().is_empty() {
                return Err(USAGE.into());
            }
            let text = match text {
                [] => TextSource::None,
                [dash] if dash == "-" => TextSource::Stdin,
                words => TextSource::Args(words.join(" ")),
            };
            return Ok(Command::Run {
                target: target.clone(),
                text,
            });
        }
    }
    parse_request(&args).map(Command::Send)
}

fn parse_request(args: &[String]) -> Result<Request, String> {
    match args {
        [command] if command == "commands" => Ok(Request::ListCommands),
        [command] if command == "quit" => Ok(Request::Quit),
        [command, mode] if command == "activate" && is_start_mode(mode) => {
            Ok(Request::Activate { mode: mode.clone() })
        }
        [command, mode] if command == "activate" => Err(format!("Unknown activation mode: {mode}")),
        [command, action] if command == "replace" && is_selection_action(action) => {
            Ok(Request::Replace {
                action: action.clone(),
            })
        }
        [command, action] if command == "replace" => {
            Err(format!("Unknown selection action: {action}"))
        }
        _ => Err(USAGE.into()),
    }
}

fn send(request: &Request) -> Result<Response, String> {
    send_to(ACTIVATION_ADDRESS, request)
}

fn send_to(address: &str, request: &Request) -> Result<Response, String> {
    let mut stream = TcpStream::connect(address)
        .map_err(|error| format!("Tyco activation socket is unavailable: {error}"))?;
    write_message(&mut stream, request).map_err(|error| error.to_string())?;
    read_message(&mut BufReader::new(stream))
}

/// The text as the command gets it: without the line break `echo` and
/// heredocs end it with, and `None` when nothing is left.
fn command_text(text: String) -> Option<String> {
    let text = text.trim_end_matches(['\n', '\r']);
    (!text.trim().is_empty()).then(|| text.to_owned())
}

fn request_for(command: Command) -> Result<Request, String> {
    match command {
        Command::Send(request) => Ok(request),
        Command::Run { target, text } => {
            let text = match text {
                TextSource::None => None,
                TextSource::Args(text) => command_text(text),
                TextSource::Stdin => {
                    let mut text = String::new();
                    io::stdin()
                        .read_to_string(&mut text)
                        .map_err(|error| format!("Could not read the text from stdin: {error}"))?;
                    command_text(text)
                }
            };
            Ok(Request::RunCommand { target, text })
        }
    }
}

fn run() -> Result<(), String> {
    let request = request_for(parse_args(env::args().skip(1))?)?;
    let response = send(&request)?;
    if !response.success {
        return Err(response
            .error
            .unwrap_or_else(|| "The request was rejected".into()));
    }
    if let Some(output) = response.output {
        println!("{output}");
    }
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_activate_command() {
        assert_eq!(
            parse_args(["activate".into(), "editor".into()]).unwrap(),
            Command::Send(Request::Activate {
                mode: "editor".into()
            })
        );
        assert!(parse_args(["editor".into()]).is_err());
        assert!(parse_args(["activate".into()]).is_err());
        assert!(parse_args(["activate".into(), "unknown".into()]).is_err());
    }

    #[test]
    fn parses_replace_command() {
        assert_eq!(
            parse_args(["replace".into(), "aiTask.0".into()]).unwrap(),
            Command::Send(Request::Replace {
                action: "aiTask.0".into()
            })
        );
        assert!(parse_args(["replace".into(), "bogus".into()]).is_err());
        assert!(parse_args(["replace".into()]).is_err());
    }

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn parses_run_command() {
        assert_eq!(
            parse_args(args(&["run", "backup"])).unwrap(),
            Command::Run {
                target: "backup".into(),
                text: TextSource::None
            }
        );
        assert_eq!(
            parse_args(args(&["run", "Work note", "buy", "milk"])).unwrap(),
            Command::Run {
                target: "Work note".into(),
                text: TextSource::Args("buy milk".into())
            }
        );
        assert_eq!(
            parse_args(args(&["run", "note", "-"])).unwrap(),
            Command::Run {
                target: "note".into(),
                text: TextSource::Stdin
            }
        );
        assert!(parse_args(args(&["run"])).is_err());
        assert!(parse_args(args(&["run", " "])).is_err());
    }

    #[test]
    fn parses_commands_command() {
        assert_eq!(
            parse_args(args(&["commands"])).unwrap(),
            Command::Send(Request::ListCommands)
        );
        assert!(parse_args(args(&["commands", "extra"])).is_err());
    }

    #[test]
    fn parses_quit_command() {
        assert_eq!(
            parse_args(args(&["quit"])).unwrap(),
            Command::Send(Request::Quit)
        );
        assert!(parse_args(args(&["quit", "extra"])).is_err());
    }

    #[test]
    fn trims_the_final_line_break_of_the_text() {
        assert_eq!(command_text("milk\n".into()).as_deref(), Some("milk"));
        assert_eq!(
            command_text("  two\nlines\r\n".into()).as_deref(),
            Some("  two\nlines")
        );
        assert_eq!(command_text(" \n".into()), None);
        assert_eq!(
            request_for(Command::Run {
                target: "x".into(),
                text: TextSource::Args(String::new())
            })
            .unwrap(),
            Request::RunCommand {
                target: "x".into(),
                text: None
            }
        );
    }

    #[test]
    fn reports_an_unavailable_main_process() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        assert!(send_to(
            &address.to_string(),
            &Request::Activate {
                mode: "editor".into()
            }
        )
        .is_err());
    }
}
