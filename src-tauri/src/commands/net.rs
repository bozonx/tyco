//! Requests and sockets of the webview, sent from here; see `services::net`.
//! A task is steered only by the window that started it.

use serde::Deserialize;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, State, WebviewWindow};
use ts_rs::TS;

use crate::errors::AppError;
use crate::ipc::BinaryRequest;
use crate::services::net::authorization::NetworkPolicy;
use crate::services::net::http::FetchRequest;
use crate::services::net::socket::{SocketCommand, SocketRequest};
use crate::services::net::NetState;
use crate::services::secrets::{with_store, SecretStore};
use crate::state::AppState;

/// Starts a request and returns its id at once; the response arrives through
/// `on_event`. A request that cannot be sent at all — a bad URL, a secret for
/// the wrong host — fails here instead. Async: the first request may wait
/// for the system keychain to open.
#[tauri::command]
pub async fn start_fetch(
    app: AppHandle,
    window: WebviewWindow,
    net: State<'_, NetState>,
    app_state: State<'_, AppState>,
    request: FetchRequest,
    on_event: Channel<InvokeResponseBody>,
) -> Result<u64, AppError> {
    crate::services::net::gateway::fetch(
        &net,
        window.label(),
        NetworkPolicy::from_config(&app_state.user_config()),
        with_store(&app, SecretStore::snapshot),
        request,
        on_event,
    )
    .await
}

/// Lets the response `id` send one more body chunk: the webview took one.
#[tauri::command]
pub fn acknowledge_fetch_chunk(window: WebviewWindow, net: State<'_, NetState>, id: u64) {
    net.acknowledge_fetch_chunk(window.label(), id);
}

/// Stops a request or a socket. Unknown ids are fine: it may have finished.
#[tauri::command]
pub fn cancel_net_task(window: WebviewWindow, net: State<'_, NetState>, id: u64) {
    net.cancel_task(window.label(), id);
}

/// Returns an id before connecting, so the handshake is cancellable too.
#[tauri::command]
pub async fn open_socket(
    app: AppHandle,
    window: WebviewWindow,
    net: State<'_, NetState>,
    app_state: State<'_, AppState>,
    request: SocketRequest,
    on_event: Channel<InvokeResponseBody>,
) -> Result<u64, AppError> {
    crate::services::net::gateway::open_socket(
        &net,
        window.label(),
        NetworkPolicy::from_config(&app_state.user_config()),
        with_store(&app, SecretStore::snapshot),
        request,
        on_event,
    )
    .await
}

#[tauri::command]
pub fn send_socket_text(
    window: WebviewWindow,
    net: State<'_, NetState>,
    id: u64,
    text: String,
) -> Result<(), AppError> {
    net.socket_command(window.label(), id, SocketCommand::Text(text))
}

#[derive(Deserialize, TS)]
pub struct SocketFrameMeta {
    /// The socket the frame is for.
    pub id: u64,
}

/// A binary frame as the raw IPC body, so audio is not turned into JSON.
#[tauri::command]
pub fn send_socket_binary(
    window: WebviewWindow,
    net: State<'_, NetState>,
    request: BinaryRequest<SocketFrameMeta>,
) -> Result<(), AppError> {
    net.socket_command(
        window.label(),
        request.meta.id,
        SocketCommand::Binary(request.bytes),
    )
}

/// With `final_message`, sends it and lets the server close the socket, e.g.
/// after the end of an audio stream; without, closes it at once.
#[tauri::command]
pub fn close_socket(
    window: WebviewWindow,
    net: State<'_, NetState>,
    id: u64,
    final_message: Option<String>,
) -> Result<(), AppError> {
    // Closing a socket that has already gone is not an error.
    match net.socket_command(window.label(), id, SocketCommand::Close(final_message)) {
        Err(error @ AppError::ResourceLimit(_)) => Err(error),
        _ => Ok(()),
    }
}
