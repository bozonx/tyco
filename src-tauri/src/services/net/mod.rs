//! The network, on behalf of the webview.
//!
//! The frontend runs the AI logic, but its requests leave from here: no CORS,
//! and provider keys filled in from `services::secrets` on the way out, so the
//! webview never holds one. Responses and socket frames go back through a
//! Tauri channel — JSON events for control, raw bytes for bodies.

pub mod http;
pub mod request;
pub mod socket;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::future::AbortHandle;
use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};
use tokio::sync::mpsc::UnboundedSender;

use crate::errors::AppError;
use socket::SocketCommand;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
/// Silence on an open response longer than this is a dead connection. Long
/// enough for a reasoning model that thinks before its first token.
const READ_TIMEOUT: Duration = Duration::from_secs(180);

/// Where a request's events go. A trait so the loops run in tests without a
/// webview.
pub trait EventSink: Send + Sync + 'static {
    /// Returns false once nobody is listening any more.
    fn event<T: Serialize>(&self, event: &T) -> bool;
    fn bytes(&self, bytes: Vec<u8>) -> bool;
}

impl EventSink for Channel<InvokeResponseBody> {
    fn event<T: Serialize>(&self, event: &T) -> bool {
        match serde_json::to_string(event) {
            Ok(json) => self.send(InvokeResponseBody::Json(json)).is_ok(),
            Err(error) => {
                log::error!("net: cannot serialize event: {error}");
                false
            }
        }
    }

    fn bytes(&self, bytes: Vec<u8>) -> bool {
        self.send(InvokeResponseBody::Raw(bytes)).is_ok()
    }
}

pub struct NetState {
    client: reqwest::Client,
    next_id: AtomicU64,
    fetches: Arc<Mutex<HashMap<u64, AbortHandle>>>,
    sockets: Arc<Mutex<HashMap<u64, UnboundedSender<SocketCommand>>>>,
}

impl NetState {
    pub fn new() -> Result<Self, AppError> {
        let client = reqwest::Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .read_timeout(READ_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| AppError::Message(format!("HTTP client: {error}")))?;

        Ok(Self {
            client,
            next_id: AtomicU64::new(1),
            fetches: Arc::default(),
            sockets: Arc::default(),
        })
    }

    pub fn client(&self) -> &reqwest::Client {
        &self.client
    }

    pub fn next_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }

    pub fn fetches(&self) -> Arc<Mutex<HashMap<u64, AbortHandle>>> {
        Arc::clone(&self.fetches)
    }

    pub fn sockets(&self) -> Arc<Mutex<HashMap<u64, UnboundedSender<SocketCommand>>>> {
        Arc::clone(&self.sockets)
    }

    /// Stops a request. Unknown ids are fine: the request may have finished.
    pub fn cancel_fetch(&self, id: u64) {
        if let Some(handle) = self.fetches.lock().expect("fetches lock").remove(&id) {
            handle.abort();
        }
    }

    pub fn socket_command(&self, id: u64, command: SocketCommand) -> Result<(), AppError> {
        let sockets = self.sockets.lock().expect("sockets lock");
        let sender = sockets
            .get(&id)
            .ok_or_else(|| AppError::Message(format!("Socket {id} is closed")))?;
        sender
            .send(command)
            .map_err(|_| AppError::Message(format!("Socket {id} is closed")))
    }
}
