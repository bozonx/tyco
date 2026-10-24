use base64::Engine;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Semaphore;
use ts_rs::TS;

use super::request::PreparedRequest;
use super::{EventSink, HTTP_CHUNK_SIZE, READ_TIMEOUT};

const MAX_REQUEST_BODY_BYTES: usize = 128 * 1024 * 1024;
pub const MAX_RESPONSE_BODY_BYTES: usize = 128 * 1024 * 1024;

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(optional_fields = nullable)]
pub struct FetchRequest {
    pub method: String,
    pub url: String,
    #[serde(default)]
    #[ts(as = "Option<Vec<(String, String)>>", optional)]
    pub headers: Vec<(String, String)>,
    /// Base64: the IPC arguments are JSON, and the body may be audio.
    pub body: Option<String>,
    /// A request of the app itself rather than of an AI provider.
    pub purpose: Option<FetchPurpose>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum FetchPurpose {
    /// An image a chat answer links to, fetched without credentials.
    ChatImage,
    /// A user-configured webhook, with a bounded text response.
    Webhook,
}

/// Control events. Body chunks travel as raw bytes between `Head` and `End`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FetchEvent {
    #[serde(rename_all = "camelCase")]
    Head {
        status: u16,
        status_text: String,
        headers: Vec<(String, String)>,
    },
    End,
    Error {
        message: String,
    },
}

pub fn decode_body(body: Option<&str>) -> Result<Option<Vec<u8>>, String> {
    decode_body_with_limit(body, MAX_REQUEST_BODY_BYTES)
}

fn decode_body_with_limit(
    body: Option<&str>,
    max_decoded_body_bytes: usize,
) -> Result<Option<Vec<u8>>, String> {
    body.map(|body| {
        let max_encoded_bytes = max_decoded_body_bytes.div_ceil(3) * 4;
        if body.len() > max_encoded_bytes {
            return Err(String::from("Request body exceeds the 128 MiB limit"));
        }
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(body)
            .map_err(|error| format!("Invalid request body: {error}"))?;
        if decoded.len() > max_decoded_body_bytes {
            return Err(String::from("Request body exceeds the 128 MiB limit"));
        }
        Ok(decoded)
    })
    .transpose()
}

pub fn parse_method(method: &str) -> Result<reqwest::Method, String> {
    reqwest::Method::from_bytes(method.to_ascii_uppercase().as_bytes())
        .map_err(|_| format!("Invalid HTTP method \"{method}\""))
}

/// Sends one request and streams its response into `sink`. Every outcome ends
/// with exactly one `End` or `Error`, unless the listener is gone first.
pub async fn run_fetch_controlled<S: EventSink>(
    client: &reqwest::Client,
    method: reqwest::Method,
    prepared: PreparedRequest,
    body: Option<Vec<u8>>,
    sink: &S,
    chunk_permits: Option<Arc<Semaphore>>,
    response_limit_bytes: usize,
) {
    let mut builder = client.request(method, prepared.url);
    for (name, value) in &prepared.headers {
        builder = builder.header(name, value);
    }
    if let Some(body) = body {
        builder = builder.body(body);
    }

    let response = match builder.send().await {
        Ok(response) => response,
        Err(error) => {
            sink.send_event(&FetchEvent::Error {
                message: describe(&error),
            });
            return;
        }
    };

    let status = response.status();
    let head = FetchEvent::Head {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or_default().to_string(),
        headers: response
            .headers()
            .iter()
            .map(|(name, value)| {
                (
                    name.as_str().to_string(),
                    value
                        .as_bytes()
                        .iter()
                        .map(|byte| char::from(*byte))
                        .collect(),
                )
            })
            .collect(),
    };
    if !sink.send_event(&head) {
        return;
    }

    let mut stream = response.bytes_stream();
    let mut received = 0usize;
    while let Some(chunk) = stream.next().await {
        match chunk {
            Ok(bytes) => {
                received = received.saturating_add(bytes.len());
                if received > response_limit_bytes {
                    sink.send_event(&FetchEvent::Error {
                        message: format!(
                            "Response body exceeds the {response_limit_bytes} byte limit"
                        ),
                    });
                    return;
                }
                for chunk in bytes.chunks(HTTP_CHUNK_SIZE) {
                    if let Some(chunk_permits) = &chunk_permits {
                        let Ok(Ok(permit)) =
                            tokio::time::timeout(READ_TIMEOUT, chunk_permits.acquire()).await
                        else {
                            sink.send_event(&FetchEvent::Error {
                                message: "HTTP response consumption timed out".into(),
                            });
                            return;
                        };
                        permit.forget();
                    }
                    if !sink.send_bytes(chunk.to_vec()) {
                        return;
                    }
                }
            }
            Err(error) => {
                sink.send_event(&FetchEvent::Error {
                    message: describe(&error),
                });
                return;
            }
        }
    }

    sink.send_event(&FetchEvent::End);
}

/// The error with its causes: reqwest's own message is only the outermost
/// layer ("error sending request"), the useful part is underneath.
fn describe(error: &reqwest::Error) -> String {
    let mut message = error.to_string();
    let mut source = std::error::Error::source(error);
    while let Some(cause) = source {
        message.push_str(": ");
        message.push_str(&cause.to_string());
        source = cause.source();
    }
    if let Some(url) = error.url() {
        let mut redacted = url.clone();
        if redacted.query().is_some() {
            redacted.set_query(Some("<redacted>"));
            message = message.replace(url.as_str(), redacted.as_str());
        }
    }
    message
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    use super::*;
    use crate::services::net::request::{prepare, Protocol};
    use crate::services::secrets::{SecretEntry, Secrets};

    /// `run_fetch_controlled` without flow control and with the default limit.
    async fn run_fetch<S: EventSink>(
        client: &reqwest::Client,
        method: reqwest::Method,
        prepared: PreparedRequest,
        body: Option<Vec<u8>>,
        sink: &S,
    ) {
        run_fetch_controlled(
            client,
            method,
            prepared,
            body,
            sink,
            None,
            MAX_RESPONSE_BODY_BYTES,
        )
        .await;
    }

    #[test]
    fn rejects_encoded_size_before_decoding_and_checks_padding_boundary() {
        assert!(decode_body_with_limit(Some("!!!!!!!!!"), 4)
            .unwrap_err()
            .contains("exceeds"));
        assert!(decode_body_with_limit(Some("YWJjZGU="), 4)
            .unwrap_err()
            .contains("exceeds"));
        assert_eq!(
            decode_body_with_limit(Some("YWJjZA=="), 4).unwrap(),
            Some(b"abcd".to_vec())
        );
    }

    #[derive(Debug, Clone, PartialEq)]
    enum Recorded {
        Event(serde_json::Value),
        Bytes(Vec<u8>),
    }

    #[derive(Clone, Default)]
    struct RecordingSink {
        records: Arc<Mutex<Vec<Recorded>>>,
        event_received: Arc<tokio::sync::Notify>,
        bytes_received: Arc<tokio::sync::Notify>,
    }

    impl EventSink for RecordingSink {
        fn send_event<T: Serialize>(&self, event: &T) -> bool {
            self.records
                .lock()
                .unwrap()
                .push(Recorded::Event(serde_json::to_value(event).unwrap()));
            self.event_received.notify_one();
            true
        }

        fn send_bytes(&self, bytes: Vec<u8>) -> bool {
            self.records.lock().unwrap().push(Recorded::Bytes(bytes));
            self.bytes_received.notify_one();
            true
        }
    }

    impl RecordingSink {
        fn take(&self) -> Vec<Recorded> {
            std::mem::take(&mut self.records.lock().unwrap())
        }
    }

    #[tokio::test]
    async fn integration_response_flow_waits_for_consumption_and_respects_the_limit() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0; 4096];
            assert!(socket.read(&mut request).await.unwrap() > 0);
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\nabc")
                .await
                .unwrap();
        });
        let prepared = prepare(
            Protocol::Http,
            &format!("http://{address}"),
            &[],
            &Secrets::new(),
        )
        .unwrap();
        let sink = RecordingSink::default();
        let chunk_permits = Arc::new(Semaphore::new(0));
        let task_sink = sink.clone();
        let task_flow = chunk_permits.clone();
        let task = tokio::spawn(async move {
            run_fetch_controlled(
                &reqwest::Client::new(),
                reqwest::Method::GET,
                prepared,
                None,
                &task_sink,
                Some(task_flow),
                3,
            )
            .await;
        });
        server.await.unwrap();
        tokio::time::timeout(Duration::from_secs(5), sink.event_received.notified())
            .await
            .expect("response headers were not delivered");
        assert!(!task.is_finished());
        assert!(!sink
            .records
            .lock()
            .unwrap()
            .iter()
            .any(|item| matches!(item, Recorded::Bytes(_))));
        chunk_permits.add_permits(1);
        tokio::time::timeout(Duration::from_secs(1), task)
            .await
            .unwrap()
            .unwrap();
        assert!(sink
            .records
            .lock()
            .unwrap()
            .iter()
            .any(|item| item == &Recorded::Bytes(b"abc".to_vec())));
    }

    #[tokio::test]
    async fn integration_rejects_a_response_exceeding_the_limit() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0; 4096];
            assert!(socket.read(&mut request).await.unwrap() > 0);
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\nabc")
                .await
                .unwrap();
        });
        let prepared = prepare(
            Protocol::Http,
            &format!("http://{address}"),
            &[],
            &Secrets::new(),
        )
        .unwrap();
        let sink = RecordingSink::default();
        run_fetch_controlled(
            &reqwest::Client::new(),
            reqwest::Method::GET,
            prepared,
            None,
            &sink,
            None,
            2,
        )
        .await;
        server.await.unwrap();
        let records = sink.take();
        assert!(!records
            .iter()
            .any(|record| matches!(record, Recorded::Bytes(_))));
        assert_eq!(
            records.last(),
            Some(&Recorded::Event(serde_json::json!({
                "type": "error",
                "message": "Response body exceeds the 2 byte limit"
            })))
        );
    }

    /// Reads one HTTP/1.1 request, returns its head and body.
    async fn read_request(socket: &mut tokio::net::TcpStream) -> (String, Vec<u8>) {
        let mut raw = Vec::new();
        let mut buffer = [0u8; 4096];
        let head_end = loop {
            let read = socket.read(&mut buffer).await.unwrap();
            assert!(read > 0, "peer closed before the request was complete");
            raw.extend_from_slice(&buffer[..read]);
            if let Some(position) = raw.windows(4).position(|window| window == b"\r\n\r\n") {
                break position + 4;
            }
        };
        let head = String::from_utf8_lossy(&raw[..head_end]).to_string();
        let length = head
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse::<usize>().ok())
                    .flatten()
            })
            .unwrap_or(0);
        while raw.len() < head_end + length {
            let read = socket.read(&mut buffer).await.unwrap();
            assert!(read > 0, "peer closed before the request was complete");
            raw.extend_from_slice(&buffer[..read]);
        }
        (head, raw[head_end..head_end + length].to_vec())
    }

    #[tokio::test]
    async fn integration_streams_a_chunked_response_with_the_key_filled_in() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());

        let sink = RecordingSink::default();
        let bytes_received = sink.bytes_received.clone();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let request = read_request(&mut socket).await;
            socket
                .write_all(
                    b"HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ntransfer-encoding: chunked\r\n\r\n",
                )
                .await
                .unwrap();
            for part in ["data: {\"a\":1}\n\n", "data: [DONE]\n\n"] {
                socket
                    .write_all(format!("{:x}\r\n{part}\r\n", part.len()).as_bytes())
                    .await
                    .unwrap();
                socket.flush().await.unwrap();
                tokio::time::timeout(Duration::from_secs(5), bytes_received.notified())
                    .await
                    .expect("response chunk was not delivered before the next chunk");
            }
            socket.write_all(b"0\r\n\r\n").await.unwrap();
            request
        });

        let mut secrets = Secrets::new();
        secrets.insert(
            "openai-compatible".into(),
            SecretEntry {
                value: "real-key".into(),
                origins: vec![origin.clone()],
            },
        );
        let prepared = prepare(
            Protocol::Http,
            &format!("{origin}/v1/chat/completions"),
            &[
                (
                    "authorization".into(),
                    "Bearer tyco-secret:openai-compatible".into(),
                ),
                ("content-type".into(), "application/json".into()),
            ],
            &secrets,
        )
        .unwrap();

        let client = reqwest::Client::new();
        run_fetch(
            &client,
            parse_method("post").unwrap(),
            prepared,
            decode_body(Some("eyJzdHJlYW0iOnRydWV9")).unwrap(),
            &sink,
        )
        .await;

        let (head, body) = server.await.unwrap();
        assert!(head.starts_with("POST /v1/chat/completions HTTP/1.1"));
        assert!(head
            .to_ascii_lowercase()
            .contains("authorization: bearer real-key"));
        assert!(!head.contains("tyco-secret"));
        assert_eq!(body, b"{\"stream\":true}");

        let events = sink.take();
        let Recorded::Event(first) = &events[0] else {
            panic!("head first: {events:?}");
        };
        assert_eq!(first["type"], "head");
        assert_eq!(first["status"], 200);
        assert_eq!(first["statusText"], "OK");

        let text: Vec<u8> = events
            .iter()
            .filter_map(|event| match event {
                Recorded::Bytes(bytes) => Some(bytes.clone()),
                Recorded::Event(_) => None,
            })
            .flatten()
            .collect();
        assert_eq!(
            String::from_utf8(text).unwrap(),
            "data: {\"a\":1}\n\ndata: [DONE]\n\n"
        );
        assert_eq!(
            events.last(),
            Some(&Recorded::Event(serde_json::json!({ "type": "end" })))
        );
    }

    #[tokio::test]
    async fn integration_reports_a_connection_failure_as_an_error_event() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);

        let prepared = prepare(
            Protocol::Http,
            &format!("http://{address}/"),
            &[],
            &Secrets::new(),
        )
        .unwrap();
        let sink = RecordingSink::default();
        run_fetch(
            &reqwest::Client::new(),
            reqwest::Method::GET,
            prepared,
            None,
            &sink,
        )
        .await;

        let events = sink.take();
        assert_eq!(events.len(), 1);
        let Recorded::Event(event) = &events[0] else {
            panic!("{events:?}");
        };
        assert_eq!(event["type"], "error");
    }

    #[test]
    fn validates_method_and_body() {
        assert_eq!(parse_method("get").unwrap(), reqwest::Method::GET);
        assert!(parse_method("GE T").is_err());
        assert_eq!(decode_body(None).unwrap(), None);
        assert!(decode_body(Some("***")).is_err());
    }
}
