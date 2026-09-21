use base64::Engine;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};

use super::request::PreparedRequest;
use super::EventSink;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchRequest {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    /// Base64: the IPC arguments are JSON, and the body may be audio.
    pub body: Option<String>,
}

/// Control events. Body chunks travel as raw bytes between `Head` and `End`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
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
    body.map(|body| {
        base64::engine::general_purpose::STANDARD
            .decode(body)
            .map_err(|error| format!("Invalid request body: {error}"))
    })
    .transpose()
}

pub fn parse_method(method: &str) -> Result<reqwest::Method, String> {
    reqwest::Method::from_bytes(method.to_ascii_uppercase().as_bytes())
        .map_err(|_| format!("Invalid HTTP method \"{method}\""))
}

/// Sends one request and streams its response into `sink`. Every outcome ends
/// with exactly one `End` or `Error`, unless the listener is gone first.
pub async fn run_fetch<S: EventSink>(
    client: &reqwest::Client,
    method: reqwest::Method,
    prepared: PreparedRequest,
    body: Option<Vec<u8>>,
    sink: &S,
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
            sink.event(&FetchEvent::Error {
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
                    String::from_utf8_lossy(value.as_bytes()).into_owned(),
                )
            })
            .collect(),
    };
    if !sink.event(&head) {
        return;
    }

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        match chunk {
            Ok(bytes) => {
                if !bytes.is_empty() && !sink.bytes(bytes.to_vec()) {
                    return;
                }
            }
            Err(error) => {
                sink.event(&FetchEvent::Error {
                    message: describe(&error),
                });
                return;
            }
        }
    }

    sink.event(&FetchEvent::End);
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

    #[derive(Debug, Clone, PartialEq)]
    enum Recorded {
        Event(serde_json::Value),
        Bytes(Vec<u8>),
    }

    #[derive(Clone, Default)]
    struct RecordingSink(Arc<Mutex<Vec<Recorded>>>);

    impl EventSink for RecordingSink {
        fn event<T: Serialize>(&self, event: &T) -> bool {
            self.0
                .lock()
                .unwrap()
                .push(Recorded::Event(serde_json::to_value(event).unwrap()));
            true
        }

        fn bytes(&self, bytes: Vec<u8>) -> bool {
            self.0.lock().unwrap().push(Recorded::Bytes(bytes));
            true
        }
    }

    impl RecordingSink {
        fn take(&self) -> Vec<Recorded> {
            std::mem::take(&mut self.0.lock().unwrap())
        }
    }

    /// Reads one HTTP/1.1 request, returns its head and body.
    async fn read_request(socket: &mut tokio::net::TcpStream) -> (String, Vec<u8>) {
        let mut raw = Vec::new();
        let mut buffer = [0u8; 4096];
        let head_end = loop {
            let read = socket.read(&mut buffer).await.unwrap();
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
            raw.extend_from_slice(&buffer[..read]);
        }
        (head, raw[head_end..head_end + length].to_vec())
    }

    #[tokio::test]
    async fn streams_a_chunked_response_with_the_key_filled_in() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());

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
                tokio::time::sleep(Duration::from_millis(20)).await;
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

        let sink = RecordingSink::default();
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
    async fn reports_a_connection_failure_as_an_error_event() {
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
