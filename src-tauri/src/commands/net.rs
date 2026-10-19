use tauri::ipc::{Channel, InvokeBody, InvokeResponseBody, Request};
use tauri::{AppHandle, State};

use crate::errors::AppError;
use crate::services::net::authorization::NetworkPolicy;
use crate::services::net::http::FetchRequest;
use crate::services::net::socket::{SocketCommand, SocketRequest};
use crate::services::net::NetState;
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
    crate::services::net::gateway::fetch(
        &net,
        NetworkPolicy::from_config(&app_state.user_config()),
        with_store(&app, SecretStore::snapshot),
        request,
        on_event,
    )
    .await
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
    crate::services::net::gateway::open_socket(
        &net,
        NetworkPolicy::from_config(&app_state.user_config()),
        with_store(&app, SecretStore::snapshot),
        request,
        on_event,
    )
    .await
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
