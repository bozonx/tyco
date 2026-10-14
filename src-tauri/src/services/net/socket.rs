use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::net::TcpStream;
use tokio::sync::mpsc::Receiver;
use tokio::time::{sleep_until, Instant};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::{protocol::WebSocketConfig, Message};
use tokio_tungstenite::{connect_async_with_config, MaybeTlsStream, WebSocketStream};

use super::request::PreparedRequest;
use super::EventSink;

pub type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(20);
/// How long a server gets to flush and close after an end-of-stream message,
/// the same grace `@bozonx/ai-kit` gives its own sockets.
const CLOSE_GRACE: Duration = Duration::from_secs(10);
const WRITE_TIMEOUT: Duration = Duration::from_secs(20);
pub const SOCKET_QUEUE_CAPACITY: usize = 32;
pub const MAX_FRAME_BYTES: usize = 256 * 1024;
/// Close code for a connection that ended without a close frame.
const ABNORMAL_CLOSE: u16 = 1006;
/// Close code for a close frame that carried no status.
const NO_STATUS: u16 = 1005;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SocketRequest {
    pub url: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub protocols: Vec<String>,
}

#[derive(Debug)]
pub enum SocketCommand {
    Text(String),
    Binary(Vec<u8>),
    /// With a payload: send it and let the server close. Without: close now.
    Close(Option<String>),
}

/// Control events. Binary frames travel as raw bytes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SocketEvent {
    Open,
    Message { data: String },
    Close { code: u16, reason: String },
    Error { message: String },
}

pub async fn connect(prepared: &PreparedRequest, protocols: &[String]) -> Result<Socket, String> {
    let mut request = prepared
        .url
        .as_str()
        .into_client_request()
        .map_err(|error| error.to_string())?;
    let headers = request.headers_mut();
    for (name, value) in &prepared.headers {
        let name = tokio_tungstenite::tungstenite::http::HeaderName::from_bytes(name.as_bytes())
            .map_err(|error| format!("Invalid header \"{name}\": {error}"))?;
        let value = HeaderValue::from_str(value)
            .map_err(|error| format!("Invalid value for header \"{name}\": {error}"))?;
        headers.append(name, value);
    }
    if !protocols.is_empty() {
        let value = HeaderValue::from_str(&protocols.join(", "))
            .map_err(|error| format!("Invalid subprotocols: {error}"))?;
        headers.insert("sec-websocket-protocol", value);
    }

    let config = WebSocketConfig::default()
        .max_message_size(Some(MAX_FRAME_BYTES))
        .max_frame_size(Some(MAX_FRAME_BYTES));
    match tokio::time::timeout(
        HANDSHAKE_TIMEOUT,
        connect_async_with_config(request, Some(config), false),
    )
    .await
    {
        Ok(Ok((socket, _))) => Ok(socket),
        Ok(Err(error)) => Err(error.to_string()),
        Err(_) => Err(String::from("WebSocket handshake timed out")),
    }
}

/// Pumps one open socket until it closes. Ends with exactly one `Close` or
/// `Error`, unless the listener is gone first.
pub async fn run_socket<S: EventSink>(socket: Socket, commands: Receiver<SocketCommand>, sink: &S) {
    run_socket_with(socket, commands, sink, WRITE_TIMEOUT).await;
}

async fn run_socket_with<S: EventSink>(
    socket: Socket,
    mut commands: Receiver<SocketCommand>,
    sink: &S,
    write_timeout: Duration,
) {
    let (mut write, mut read) = socket.split();
    let mut closing_deadline: Option<Instant> = None;
    let mut awaiting_results = false;

    loop {
        tokio::select! {
            command = commands.recv(), if closing_deadline.is_none() => {
                let sent = match command {
                    Some(SocketCommand::Text(text)) => bounded_write(write.send(Message::Text(text.into())), write_timeout, closing_deadline).await,
                    Some(SocketCommand::Binary(bytes)) => bounded_write(write.send(Message::Binary(bytes.into())), write_timeout, closing_deadline).await,
                    Some(SocketCommand::Close(Some(payload))) => {
                        awaiting_results = true;
                        closing_deadline = Some(Instant::now() + CLOSE_GRACE);
                        bounded_write(write.send(Message::Text(payload.into())), write_timeout, closing_deadline).await
                    }
                    Some(SocketCommand::Close(None)) | None => {
                        closing_deadline = Some(Instant::now() + CLOSE_GRACE);
                        bounded_write(write.send(Message::Close(Some(normal_close()))), write_timeout, closing_deadline).await
                    }
                };
                if let Err(error) = sent {
                    sink.send_event(&SocketEvent::Error { message: error });
                    return;
                }
            }
            message = read.next() => {
                match message {
                    Some(Ok(Message::Text(data))) => {
                        if !sink.send_event(&SocketEvent::Message { data: data.to_string() }) {
                            let _ = bounded_write(write.send(Message::Close(Some(normal_close()))), write_timeout, closing_deadline).await;
                            return;
                        }
                    }
                    Some(Ok(Message::Binary(bytes))) => {
                        if !sink.send_bytes(bytes.into()) {
                            let _ = bounded_write(write.send(Message::Close(Some(normal_close()))), write_timeout, closing_deadline).await;
                            return;
                        }
                    }
                    Some(Ok(Message::Close(frame))) => {
                        // Sends the close reply tungstenite has queued.
                        let _ = bounded_write(write.flush(), write_timeout, closing_deadline).await;
                        let (code, reason) = frame
                            .map(|frame| (u16::from(frame.code), frame.reason.to_string()))
                            .unwrap_or((NO_STATUS, String::new()));
                        sink.send_event(&SocketEvent::Close { code, reason });
                        return;
                    }
                    Some(Ok(Message::Ping(_))) => {
                        if let Err(message) = bounded_write(write.flush(), write_timeout, closing_deadline).await {
                            sink.send_event(&SocketEvent::Error { message });
                            return;
                        }
                    }
                    Some(Ok(_)) => {}
                    // We asked to close; a server that drops the connection
                    // instead of answering has still closed it.
                    Some(Err(_)) | None if closing_deadline.is_some() && !awaiting_results => {
                        sink.send_event(&SocketEvent::Close { code: 1000, reason: String::new() });
                        return;
                    }
                    Some(Err(error)) => {
                        sink.send_event(&SocketEvent::Error { message: error.to_string() });
                        return;
                    }
                    None => {
                        sink.send_event(&SocketEvent::Close {
                            code: ABNORMAL_CLOSE,
                            reason: String::from("connection closed without a close frame"),
                        });
                        return;
                    }
                }
            }
            _ = sleep_until(closing_deadline.unwrap_or_else(Instant::now)), if closing_deadline.is_some() => {
                if awaiting_results {
                    sink.send_event(&SocketEvent::Error { message: "Timed out waiting for the final speech recognition result".into() });
                } else {
                    sink.send_event(&SocketEvent::Close { code: 1000, reason: String::new() });
                }
                return;
            }
        }
    }
}

/// Every write yields on a deadline, including sends inside select branches.
async fn bounded_write<T, E: std::fmt::Display>(
    operation: impl std::future::Future<Output = Result<T, E>>,
    timeout: Duration,
    closing_deadline: Option<Instant>,
) -> Result<T, String> {
    let write_deadline = Instant::now() + timeout;
    let deadline = write_deadline.min(closing_deadline.unwrap_or(write_deadline));
    tokio::time::timeout_at(deadline, operation)
        .await
        .map_err(|_| String::from("WebSocket write timed out"))?
        .map_err(|error| error.to_string())
}

fn normal_close() -> CloseFrame {
    CloseFrame {
        code: CloseCode::Normal,
        reason: "".into(),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use tokio::net::TcpListener;
    use tokio::sync::mpsc;
    use tokio_tungstenite::accept_hdr_async;
    use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};

    use super::*;
    use crate::services::net::request::{prepare, Protocol};
    use crate::services::secrets::{SecretEntry, Secrets};

    #[derive(Clone, Default)]
    struct RecordingSink(Arc<Mutex<Vec<serde_json::Value>>>);

    impl EventSink for RecordingSink {
        fn send_event<T: Serialize>(&self, event: &T) -> bool {
            self.0
                .lock()
                .unwrap()
                .push(serde_json::to_value(event).unwrap());
            true
        }

        fn send_bytes(&self, bytes: Vec<u8>) -> bool {
            self.0
                .lock()
                .unwrap()
                .push(serde_json::json!({ "bytes": bytes }));
            true
        }
    }

    #[tokio::test]
    async fn a_stalled_write_obeys_the_close_deadline() {
        let start = Instant::now();
        let result = bounded_write(
            std::future::pending::<Result<(), String>>(),
            Duration::from_secs(20),
            Some(start + Duration::from_millis(10)),
        )
        .await;
        assert_eq!(result.unwrap_err(), "WebSocket write timed out");
        assert!(start.elapsed() < Duration::from_secs(1));
    }

    #[tokio::test]
    async fn integration_a_peer_that_does_not_read_cannot_stall_the_socket_pump() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let socket = tokio_tungstenite::accept_async(stream).await.unwrap();
            let _socket = socket;
            std::future::pending::<()>().await;
        });
        let prepared = prepare(
            Protocol::WebSocket,
            &format!("ws://{address}"),
            &[],
            &Secrets::new(),
        )
        .unwrap();
        let socket = connect(&prepared, &[]).await.unwrap();
        let (sender, receiver) = mpsc::channel(SOCKET_QUEUE_CAPACITY);
        let producer = tokio::spawn(async move {
            loop {
                if sender
                    .send(SocketCommand::Binary(vec![0; MAX_FRAME_BYTES]))
                    .await
                    .is_err()
                {
                    return;
                }
            }
        });
        let sink = RecordingSink::default();
        tokio::time::timeout(
            Duration::from_secs(3),
            run_socket_with(socket, receiver, &sink, Duration::from_millis(20)),
        )
        .await
        .unwrap();
        assert!(sink
            .0
            .lock()
            .unwrap()
            .iter()
            .any(|event| event["message"] == "WebSocket write timed out"));
        producer.await.unwrap();
        server.abort();
    }

    // The handshake callback's error type is tungstenite's, not ours.
    #[allow(clippy::result_large_err)]
    #[tokio::test]
    async fn integration_close_with_payload_waits_for_the_server_to_finish() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let authorization = Arc::new(Mutex::new(String::new()));
        let seen_authorization = Arc::clone(&authorization);

        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = accept_hdr_async(stream, |request: &Request, response: Response| {
                *seen_authorization.lock().unwrap() = request
                    .headers()
                    .get("authorization")
                    .map(|value| value.to_str().unwrap().to_string())
                    .unwrap_or_default();
                Ok(response)
            })
            .await
            .unwrap();

            socket.send(Message::Text("partial".into())).await.unwrap();
            let mut received = Vec::new();
            while let Some(Ok(message)) = socket.next().await {
                match message {
                    Message::Binary(bytes) => received.push(format!("bin:{}", bytes.len())),
                    Message::Text(text) => {
                        received.push(text.to_string());
                        if text == "end-of-stream" {
                            // The tail of the transcript, after the client asked to stop.
                            socket.send(Message::Text("final".into())).await.unwrap();
                            socket.close(None).await.unwrap();
                        }
                    }
                    _ => {}
                }
            }
            received
        });

        let mut secrets = Secrets::new();
        secrets.insert(
            "stt".into(),
            SecretEntry {
                value: "live-key".into(),
                origins: vec![format!("http://{address}")],
            },
        );
        let prepared = prepare(
            Protocol::WebSocket,
            &format!("ws://{address}/listen"),
            &[("authorization".into(), "Token tyco-secret:stt".into())],
            &secrets,
        )
        .unwrap();

        let socket = connect(&prepared, &[]).await.unwrap();
        let (sender, receiver) = mpsc::channel(SOCKET_QUEUE_CAPACITY);
        sender
            .try_send(SocketCommand::Binary(vec![0; 320]))
            .unwrap();
        sender
            .try_send(SocketCommand::Close(Some("end-of-stream".into())))
            .unwrap();

        let sink = RecordingSink::default();
        run_socket(socket, receiver, &sink).await;

        assert_eq!(server.await.unwrap(), vec!["bin:320", "end-of-stream"]);
        assert_eq!(*authorization.lock().unwrap(), "Token live-key");
        let events = sink.0.lock().unwrap().clone();
        assert_eq!(
            events,
            vec![
                serde_json::json!({ "type": "message", "data": "partial" }),
                serde_json::json!({ "type": "message", "data": "final" }),
                serde_json::json!({ "type": "close", "code": 1005, "reason": "" }),
            ]
        );
    }

    #[tokio::test]
    async fn integration_a_disconnect_after_end_of_audio_is_not_a_successful_flush() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
            while let Some(Ok(message)) = socket.next().await {
                if matches!(message, Message::Text(_)) {
                    break;
                }
            }
        });
        let prepared = prepare(
            Protocol::WebSocket,
            &format!("ws://{address}"),
            &[],
            &Secrets::new(),
        )
        .unwrap();
        let socket = connect(&prepared, &[]).await.unwrap();
        let (sender, receiver) = mpsc::channel(SOCKET_QUEUE_CAPACITY);
        sender
            .try_send(SocketCommand::Close(Some("end-of-stream".into())))
            .unwrap();
        let sink = RecordingSink::default();
        run_socket(socket, receiver, &sink).await;
        server.await.unwrap();
        let events = sink.0.lock().unwrap();
        assert!(!events
            .iter()
            .any(|event| event["type"] == "close" && event["code"] == 1000));
        assert!(events
            .iter()
            .any(|event| event["type"] == "error" || event["code"] == 1006));
    }

    #[tokio::test]
    async fn integration_close_without_payload_closes_now() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
            // Reading on after the close frame is what sends the reply.
            while let Some(Ok(_)) = socket.next().await {}
        });

        let prepared = prepare(
            Protocol::WebSocket,
            &format!("ws://{address}/"),
            &[],
            &Secrets::new(),
        )
        .unwrap();
        let socket = connect(&prepared, &[]).await.unwrap();
        let (sender, receiver) = mpsc::channel(SOCKET_QUEUE_CAPACITY);
        sender.try_send(SocketCommand::Close(None)).unwrap();

        let sink = RecordingSink::default();
        run_socket(socket, receiver, &sink).await;
        server.await.unwrap();

        let events = sink.0.lock().unwrap().clone();
        assert_eq!(
            events,
            vec![serde_json::json!({ "type": "close", "code": 1000, "reason": "" })]
        );
    }
}
