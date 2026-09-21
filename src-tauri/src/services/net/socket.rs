use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::net::TcpStream;
use tokio::sync::mpsc::UnboundedReceiver;
use tokio::time::{sleep_until, Instant};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

use super::request::PreparedRequest;
use super::EventSink;

pub type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(20);
/// How long a server gets to flush and close after an end-of-stream message,
/// the same grace `@bozonx/ai-kit` gives its own sockets.
const CLOSE_GRACE: Duration = Duration::from_secs(5);
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

    match tokio::time::timeout(HANDSHAKE_TIMEOUT, connect_async(request)).await {
        Ok(Ok((socket, _))) => Ok(socket),
        Ok(Err(error)) => Err(error.to_string()),
        Err(_) => Err(String::from("WebSocket handshake timed out")),
    }
}

/// Pumps one open socket until it closes. Ends with exactly one `Close` or
/// `Error`, unless the listener is gone first.
pub async fn run_socket<S: EventSink>(
    socket: Socket,
    mut commands: UnboundedReceiver<SocketCommand>,
    sink: &S,
) {
    let (mut write, mut read) = socket.split();
    let mut closing_deadline: Option<Instant> = None;

    loop {
        tokio::select! {
            command = commands.recv(), if closing_deadline.is_none() => {
                let sent = match command {
                    Some(SocketCommand::Text(text)) => write.send(Message::Text(text)).await,
                    Some(SocketCommand::Binary(bytes)) => write.send(Message::Binary(bytes)).await,
                    Some(SocketCommand::Close(Some(payload))) => {
                        closing_deadline = Some(Instant::now() + CLOSE_GRACE);
                        write.send(Message::Text(payload)).await
                    }
                    Some(SocketCommand::Close(None)) | None => {
                        closing_deadline = Some(Instant::now() + CLOSE_GRACE);
                        write.send(Message::Close(Some(normal_close()))).await
                    }
                };
                if let Err(error) = sent {
                    sink.event(&SocketEvent::Error { message: error.to_string() });
                    return;
                }
            }
            message = read.next() => {
                match message {
                    Some(Ok(Message::Text(data))) => {
                        if !sink.event(&SocketEvent::Message { data }) {
                            let _ = write.send(Message::Close(Some(normal_close()))).await;
                            return;
                        }
                    }
                    Some(Ok(Message::Binary(bytes))) => {
                        if !sink.bytes(bytes) {
                            let _ = write.send(Message::Close(Some(normal_close()))).await;
                            return;
                        }
                    }
                    Some(Ok(Message::Close(frame))) => {
                        // Sends the close reply tungstenite has queued.
                        let _ = write.flush().await;
                        let (code, reason) = frame
                            .map(|frame| (u16::from(frame.code), frame.reason.into_owned()))
                            .unwrap_or((NO_STATUS, String::new()));
                        sink.event(&SocketEvent::Close { code, reason });
                        return;
                    }
                    Some(Ok(_)) => {}
                    // We asked to close; a server that drops the connection
                    // instead of answering has still closed it.
                    Some(Err(_)) | None if closing_deadline.is_some() => {
                        sink.event(&SocketEvent::Close { code: 1000, reason: String::new() });
                        return;
                    }
                    Some(Err(error)) => {
                        sink.event(&SocketEvent::Error { message: error.to_string() });
                        return;
                    }
                    None => {
                        sink.event(&SocketEvent::Close {
                            code: ABNORMAL_CLOSE,
                            reason: String::from("connection closed without a close frame"),
                        });
                        return;
                    }
                }
            }
            _ = sleep_until(closing_deadline.unwrap_or_else(Instant::now)), if closing_deadline.is_some() => {
                let _ = write.send(Message::Close(Some(normal_close()))).await;
                sink.event(&SocketEvent::Close { code: 1000, reason: String::new() });
                return;
            }
        }
    }
}

fn normal_close() -> CloseFrame<'static> {
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
        fn event<T: Serialize>(&self, event: &T) -> bool {
            self.0
                .lock()
                .unwrap()
                .push(serde_json::to_value(event).unwrap());
            true
        }

        fn bytes(&self, bytes: Vec<u8>) -> bool {
            self.0
                .lock()
                .unwrap()
                .push(serde_json::json!({ "bytes": bytes }));
            true
        }
    }

    // The handshake callback's error type is tungstenite's, not ours.
    #[allow(clippy::result_large_err)]
    #[tokio::test]
    async fn close_with_payload_waits_for_the_server_to_finish() {
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
                        received.push(text.clone());
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
        let (sender, receiver) = mpsc::unbounded_channel();
        sender.send(SocketCommand::Binary(vec![0; 320])).unwrap();
        sender
            .send(SocketCommand::Close(Some("end-of-stream".into())))
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
    async fn close_without_payload_closes_now() {
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
        let (sender, receiver) = mpsc::unbounded_channel();
        sender.send(SocketCommand::Close(None)).unwrap();

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
