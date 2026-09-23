use futures_util::future::{AbortHandle, Abortable};
use tauri::ipc::{Channel, InvokeBody, InvokeResponseBody, Request};
use tauri::State;
use tokio::sync::mpsc;

use crate::errors::AppError;
use crate::services::net::http::{self, FetchRequest};
use crate::services::net::request::{prepare, Protocol};
use crate::services::net::socket::{self, SocketCommand, SocketRequest};
use crate::services::net::NetState;
use crate::services::secrets::SecretStore;
use crate::state::AppState;

/// Header that names the socket a raw binary frame is for.
const SOCKET_ID_HEADER: &str = "x-tyco-socket-id";

/// Starts a request and returns its id at once; the response arrives through
/// `on_event`. A request that cannot be sent at all — a bad URL, a secret for
/// the wrong host — fails here instead.
#[tauri::command]
pub fn net_fetch(
    net: State<'_, NetState>,
    secrets: State<'_, SecretStore>,
    app_state: State<'_, AppState>,
    request: FetchRequest,
    on_event: Channel<InvokeResponseBody>,
) -> Result<u64, AppError> {
    let secret_snapshot = secrets.snapshot();
    ensure_allowed_origin(
        Protocol::Http,
        &request.url,
        &app_state.params().user_config,
        &secret_snapshot,
    )?;
    let prepared = prepare(
        Protocol::Http,
        &request.url,
        &request.headers,
        &secret_snapshot,
    )
    .map_err(AppError::Message)?;
    let method = http::parse_method(&request.method).map_err(AppError::Message)?;
    let body = http::decode_body(request.body.as_deref()).map_err(AppError::Message)?;

    let id = net.next_id();
    let client = net.client().clone();
    let fetches = net.fetches();
    let (handle, registration) = AbortHandle::new_pair();
    fetches.lock().expect("fetches lock").insert(id, handle);

    tauri::async_runtime::spawn(async move {
        let run = http::run_fetch(&client, method, prepared, body, &on_event);
        let _ = Abortable::new(run, registration).await;
        fetches.lock().expect("fetches lock").remove(&id);
    });

    Ok(id)
}

#[tauri::command]
pub fn net_cancel(net: State<'_, NetState>, id: u64) {
    net.cancel_fetch(id);
}

/// Resolves once the socket is open; frames arrive through `on_event`.
#[tauri::command]
pub async fn net_socket_open(
    net: State<'_, NetState>,
    secrets: State<'_, SecretStore>,
    app_state: State<'_, AppState>,
    request: SocketRequest,
    on_event: Channel<InvokeResponseBody>,
) -> Result<u64, AppError> {
    let secret_snapshot = secrets.snapshot();
    ensure_allowed_origin(
        Protocol::WebSocket,
        &request.url,
        &app_state.params().user_config,
        &secret_snapshot,
    )?;
    let prepared = prepare(
        Protocol::WebSocket,
        &request.url,
        &request.headers,
        &secret_snapshot,
    )
    .map_err(AppError::Message)?;
    let connection = socket::connect(&prepared, &request.protocols)
        .await
        .map_err(AppError::Message)?;

    let id = net.next_id();
    let sockets = net.sockets();
    let (sender, receiver) = mpsc::unbounded_channel();
    sockets.lock().expect("sockets lock").insert(id, sender);

    tauri::async_runtime::spawn(async move {
        socket::run_socket(connection, receiver, &on_event).await;
        sockets.lock().expect("sockets lock").remove(&id);
    });

    Ok(id)
}

fn ensure_allowed_origin(
    protocol: Protocol,
    url: &str,
    user_config: &serde_json::Value,
    secrets: &crate::services::secrets::Secrets,
) -> Result<(), AppError> {
    let origin =
        crate::services::net::request::request_origin(protocol, url).map_err(AppError::Message)?;
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
        Err(AppError::Message(format!(
            "Network origin \"{origin}\" is not configured"
        )))
    }
}

fn configured_base_urls(config: &serde_json::Value) -> impl Iterator<Item = &str> {
    let llm = config
        .get("llm")
        .and_then(|value| value.get("providers"))
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|provider| provider.get("baseUrl"))
        .filter_map(serde_json::Value::as_str);
    let stt = config
        .get("sttModels")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|model| model.get("baseUrl"))
        .filter_map(serde_json::Value::as_str);
    llm.chain(stt)
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
        .ok_or_else(|| AppError::Message(format!("Missing {SOCKET_ID_HEADER} header")))?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::Message(String::from(
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
    let _ = net.socket_command(id, SocketCommand::Close(payload));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::secrets::SecretEntry;

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
