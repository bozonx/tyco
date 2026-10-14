use futures_util::future::Abortable;
use tauri::ipc::{Channel, InvokeBody, InvokeResponseBody, Request};
use tauri::{AppHandle, State};
use tokio::sync::mpsc;

use crate::errors::AppError;
use crate::services::net::http::{self, FetchRequest};
use crate::services::net::request::{prepare, PreparedRequest, Protocol};
use crate::services::net::socket::{self, SocketCommand, SocketRequest};
use crate::services::net::{EventSink, NetState};
use crate::services::secrets::{with_store, SecretStore};
use crate::state::AppState;

/// Header that names the socket a raw binary frame is for.
const SOCKET_ID_HEADER: &str = "x-tyco-socket-id";

/// Starts a request and returns its id at once; the response arrives through
/// `on_event`. A request that cannot be sent at all — a bad URL, a secret for
/// the wrong host — fails here instead. Async: the first request may wait
/// for the system keychain to open.
#[tauri::command]
pub async fn net_fetch(
    app: AppHandle,
    net: State<'_, NetState>,
    app_state: State<'_, AppState>,
    request: FetchRequest,
    on_event: Channel<InvokeResponseBody>,
) -> Result<u64, AppError> {
    let (prepared, client) = if request.purpose.as_deref() == Some("chat-image") {
        crate::services::net::image::prepare_image(&request).await?
    } else {
        if request.purpose.is_some() {
            return Err(AppError::InvalidInput(
                "Unknown network request purpose".into(),
            ));
        }
        let prepared = prepare_authorized_request(
            &app,
            &app_state,
            Protocol::Http,
            &request.url,
            &request.headers,
        )
        .await?;
        (prepared, net.client().clone())
    };
    let method = http::parse_method(&request.method).map_err(AppError::InvalidInput)?;
    let body = http::decode_body(request.body.as_deref()).map_err(AppError::InvalidInput)?;

    let (task, registration) = net.register_task();
    let id = task.id();
    let chunk_permits = task.response_chunk_permits();
    let response_limit_bytes = if request.purpose.is_some() {
        10 * 1024 * 1024
    } else {
        http::MAX_RESPONSE_BODY_BYTES
    };

    tauri::async_runtime::spawn(async move {
        let run = http::run_fetch_controlled(
            &client,
            method,
            prepared,
            body,
            &on_event,
            Some(chunk_permits),
            response_limit_bytes,
        );
        let _ = Abortable::new(run, registration).await;
        drop(task);
    });

    Ok(id)
}

#[tauri::command]
pub fn net_cancel(net: State<'_, NetState>, id: u64) {
    net.cancel_task(id);
}

#[tauri::command]
pub fn net_fetch_ack(net: State<'_, NetState>, id: u64) {
    net.acknowledge_fetch(id);
}

/// Returns an id before connecting, so the handshake is cancellable too.
#[tauri::command]
pub async fn net_socket_open(
    app: AppHandle,
    net: State<'_, NetState>,
    app_state: State<'_, AppState>,
    request: SocketRequest,
    on_event: Channel<InvokeResponseBody>,
) -> Result<u64, AppError> {
    let prepared = prepare_authorized_request(
        &app,
        &app_state,
        Protocol::WebSocket,
        &request.url,
        &request.headers,
    )
    .await?;
    let (task, registration) = net.register_task();
    let id = task.id();

    tauri::async_runtime::spawn(async move {
        let run = async {
            let connection = match socket::connect(&prepared, &request.protocols).await {
                Ok(connection) => connection,
                Err(message) => {
                    on_event.send_event(&socket::SocketEvent::Error { message });
                    return;
                }
            };
            let (sender, receiver) = mpsc::channel(socket::SOCKET_QUEUE_CAPACITY);
            task.register_socket(sender);
            if on_event.send_event(&socket::SocketEvent::Open) {
                socket::run_socket(connection, receiver, &on_event).await;
            }
        };
        let _ = Abortable::new(run, registration).await;
        drop(task);
    });

    Ok(id)
}

async fn prepare_authorized_request(
    app: &AppHandle,
    app_state: &AppState,
    protocol: Protocol,
    url: &str,
    headers: &[(String, String)],
) -> Result<PreparedRequest, AppError> {
    let secrets = with_store(app, SecretStore::snapshot).await?;
    ensure_allowed_origin(
        protocol,
        url,
        &app_state.snapshot().settings.user_config,
        &secrets,
    )?;
    prepare(protocol, url, headers, &secrets).map_err(AppError::InvalidInput)
}

fn ensure_allowed_origin(
    protocol: Protocol,
    url: &str,
    user_config: &serde_json::Value,
    secrets: &crate::services::secrets::Secrets,
) -> Result<(), AppError> {
    let origin = crate::services::net::request::request_origin(protocol, url)
        .map_err(AppError::InvalidInput)?;
    let secret_allows = secrets
        .values()
        .any(|entry| entry.origins.contains(&origin));
    let config_allows = configured_base_urls(user_config)
        .filter_map(|value| url::Url::parse(value).ok())
        .filter_map(|value| crate::services::secrets::origin_of(&value))
        .any(|configured| configured == origin);

    if secret_allows || config_allows {
        Ok(())
    } else {
        Err(AppError::InvalidInput(format!(
            "Network origin \"{origin}\" is not configured"
        )))
    }
}

/// Endpoints the user configured: language model providers and self-hosted
/// speech servers. Deepgram has none and is reached through the origin its key
/// is bound to.
fn configured_base_urls(config: &serde_json::Value) -> impl Iterator<Item = &str> {
    let llm_providers = config
        .get("llm")
        .and_then(|value| value.get("providers"))
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten();
    let stt_models = config
        .get("sttModels")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten();

    let webhooks = config
        .get("commands")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter(|command| {
            command.get("toolId").and_then(serde_json::Value::as_str) == Some("webhook")
        })
        .filter_map(|command| {
            command
                .get("toolConfig")
                .and_then(|config| config.get("url"))
        })
        .filter_map(serde_json::Value::as_str);

    llm_providers
        .chain(stt_models)
        .filter_map(|entry| entry.get("baseUrl"))
        .filter_map(serde_json::Value::as_str)
        .chain(webhooks)
}

#[tauri::command]
pub fn net_socket_send_text(
    net: State<'_, NetState>,
    id: u64,
    text: String,
) -> Result<(), AppError> {
    net.socket_command(id, SocketCommand::Text(text))
}

/// A binary frame as the raw IPC body, so audio is not turned into JSON.
#[tauri::command]
pub fn net_socket_send_binary(
    net: State<'_, NetState>,
    request: Request<'_>,
) -> Result<(), AppError> {
    let id = request
        .headers()
        .get(SOCKET_ID_HEADER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .ok_or_else(|| AppError::InvalidInput(format!("Missing {SOCKET_ID_HEADER} header")))?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::InvalidInput(String::from(
            "Expected a raw binary body",
        )));
    };
    net.socket_command(id, SocketCommand::Binary(bytes.clone()))
}

#[tauri::command]
pub fn net_socket_close(
    net: State<'_, NetState>,
    id: u64,
    payload: Option<String>,
) -> Result<(), AppError> {
    // Closing a socket that has already gone is not an error.
    match net.socket_command(id, SocketCommand::Close(payload)) {
        Err(error @ AppError::ResourceLimit(_)) => Err(error),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::secrets::SecretEntry;

    #[test]
    fn allows_configured_webhooks_without_a_secret() {
        let config = serde_json::json!({"commands":[{"id":"hook", "toolId":"webhook", "toolConfig":{"url":"https://hooks.example/run?text={{TEXT}}"}}]});
        let secrets = crate::services::secrets::Secrets::new();
        assert!(ensure_allowed_origin(
            Protocol::Http,
            "https://hooks.example/run?text=value",
            &config,
            &secrets
        )
        .is_ok());
        assert!(ensure_allowed_origin(
            Protocol::Http,
            "https://other.example/run",
            &config,
            &secrets
        )
        .is_err());
    }

    #[test]
    fn allows_only_configured_or_secret_bound_origins() {
        let config = serde_json::json!({
            "llm": {
                "providers": [{ "baseUrl": "http://localhost:11434/v1" }]
            },
            "sttModels": [{ "baseUrl": "wss://speech.example/v1" }]
        });
        let mut secrets = crate::services::secrets::Secrets::new();
        secrets.insert(
            "google".into(),
            SecretEntry {
                value: "key".into(),
                origins: vec!["https://generativelanguage.googleapis.com".into()],
            },
        );

        assert!(ensure_allowed_origin(
            Protocol::Http,
            "http://localhost:11434/v1/models",
            &config,
            &secrets
        )
        .is_ok());
        assert!(ensure_allowed_origin(
            Protocol::WebSocket,
            "wss://speech.example/v1",
            &config,
            &secrets
        )
        .is_ok());
        assert!(ensure_allowed_origin(
            Protocol::WebSocket,
            "wss://other-speech.example/v1",
            &config,
            &secrets
        )
        .is_err());
        assert!(ensure_allowed_origin(
            Protocol::Http,
            "https://generativelanguage.googleapis.com/v1/models",
            &config,
            &secrets
        )
        .is_ok());
        assert!(ensure_allowed_origin(
            Protocol::Http,
            "http://169.254.169.254/latest/meta-data",
            &config,
            &secrets
        )
        .is_err());
    }
}
