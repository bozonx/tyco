use std::io::BufReader;
use std::net::{TcpListener, TcpStream};
use std::thread;

use tauri::AppHandle;
use tyco_activation_protocol::{
    read_message, write_message, Request, Response, ACTIVATION_ADDRESS,
};

use crate::services::activation::{Activation, ActivationSource, StartMode};
use crate::services::runtime;

pub fn spawn_server(app: AppHandle) {
    thread::spawn(move || {
        if let Err(error) = serve(ACTIVATION_ADDRESS, move |request| dispatch(&app, request)) {
            log::error!("Activation socket is unavailable: {error}");
        }
    });
}

fn serve(
    address: &str,
    handler: impl Fn(Request) -> Response + Send + Sync + 'static,
) -> Result<(), String> {
    let listener = TcpListener::bind(address).map_err(|error| error.to_string())?;
    log::info!("Activation socket listening at {address}");

    for stream in listener.incoming() {
        match stream {
            Ok(stream) => handle_stream(stream, &handler),
            Err(error) => log::warn!("Activation socket connection failed: {error}"),
        }
    }
    Ok(())
}

fn handle_stream(stream: TcpStream, handler: &impl Fn(Request) -> Response) {
    let mut reader = BufReader::new(&stream);
    let response = match read_message(&mut reader) {
        Ok(request) => handler(request),
        Err(error) => Response::error(format!("Invalid request: {error}")),
    };
    if let Err(error) = write_message(&mut &stream, &response) {
        log::warn!("Could not send activation response: {error}");
    }
}

fn dispatch(app: &AppHandle, request: Request) -> Response {
    let Request::Activate { mode } = request;
    let result = StartMode::parse(&mode)
        .and_then(|mode| runtime::activate(app, Activation::new(mode, ActivationSource::Cli)));
    match result {
        Ok(()) => Response::success(),
        Err(error) => Response::error(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;

    #[test]
    fn protocol_delivers_every_mode_and_rejections() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let received = Arc::new(Mutex::new(Vec::new()));
        let server_received = Arc::clone(&received);
        thread::spawn(move || {
            for stream in listener.incoming().take(9) {
                handle_stream(stream.unwrap(), &|request| {
                    let Request::Activate { mode } = request;
                    match StartMode::parse(&mode) {
                        Ok(mode) => {
                            server_received
                                .lock()
                                .unwrap()
                                .push(mode.as_str().to_owned());
                            Response::success()
                        }
                        Err(error) => Response::error(error.to_string()),
                    }
                });
            }
        });

        for mode in [
            "editor", "write", "chat", "voice", "select", "aiTasks", "history", "config", "unknown",
        ] {
            let mut stream = TcpStream::connect(address).unwrap();
            write_message(
                &mut stream,
                &Request::Activate {
                    mode: mode.to_owned(),
                },
            )
            .unwrap();
            let response: Response = read_message(&mut BufReader::new(stream)).unwrap();
            assert_eq!(response.success, mode != "unknown");
        }
        assert_eq!(received.lock().unwrap().len(), 8);
    }
}
