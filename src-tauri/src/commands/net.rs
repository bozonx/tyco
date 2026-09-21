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

/// Header that names the socket a raw binary frame is for.
const SOCKET_ID_HEADER: &str = "x-tyco-socket-id";

/// Starts a request and returns its id at once; the response arrives through
/// `on_event`. A request that cannot be sent at all — a bad URL, a secret for
/// the wrong host — fails here instead.
#[tauri::command]
pub fn net_fetch(
    net: State<'_, NetState>,
    secrets: State<'_, SecretStore>,
    request: FetchRequest,
    on_event: Channel<InvokeResponseBody>,
) -> Result<u64, AppError> {
    let prepared = prepare(
        Protocol::Http,
        &request.url,
        &request.headers,
        &secrets.snapshot(),
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
    request: SocketRequest,
    on_event: Channel<InvokeResponseBody>,
) -> Result<u64, AppError> {
    let prepared = prepare(
        Protocol::WebSocket,
        &request.url,
        &request.headers,
        &secrets.snapshot(),
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
