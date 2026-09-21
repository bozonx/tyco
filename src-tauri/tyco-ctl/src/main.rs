use std::env;
use std::io::BufReader;
use std::net::TcpStream;

use tyco_activation_protocol::{
    is_start_mode, read_message, write_message, Request, Response, ACTIVATION_ADDRESS,
};

fn parse_args(args: impl IntoIterator<Item = String>) -> Result<String, String> {
    let args = args.into_iter().collect::<Vec<_>>();
    match args.as_slice() {
        [command, mode] if command == "activate" && is_start_mode(mode) => Ok(mode.clone()),
        [command, mode] if command == "activate" => Err(format!("Unknown activation mode: {mode}")),
        _ => Err("Usage: tyco-ctl activate <mode>".into()),
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

fn run() -> Result<(), String> {
    let mode = parse_args(env::args().skip(1))?;
    let response = send(&Request::Activate { mode })?;
    if response.success {
        Ok(())
    } else {
        Err(response
            .error
            .unwrap_or_else(|| "Activation was rejected".into()))
    }
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
            "editor"
        );
        assert!(parse_args(["editor".into()]).is_err());
        assert!(parse_args(["activate".into()]).is_err());
        assert!(parse_args(["activate".into(), "unknown".into()]).is_err());
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
