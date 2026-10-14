//! The network, on behalf of the webview.
//!
//! The frontend runs the AI logic, but its requests leave from here: no CORS,
//! and provider keys filled in from `services::secrets` on the way out, so the
//! webview never holds one. Responses and socket frames go back through a
//! Tauri channel — JSON events for control, raw bytes for bodies.

pub mod http;
pub mod image;
pub mod request;
pub mod socket;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::future::{AbortHandle, AbortRegistration};
use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};
use tokio::sync::{mpsc::Sender, Semaphore};

pub const FETCH_WINDOW_CHUNKS: usize = 8;

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
    fn send_event<T: Serialize>(&self, event: &T) -> bool;
    fn send_bytes(&self, bytes: Vec<u8>) -> bool;
}

impl EventSink for Channel<InvokeResponseBody> {
    fn send_event<T: Serialize>(&self, event: &T) -> bool {
        match serde_json::to_string(event) {
            Ok(json) => self.send(InvokeResponseBody::Json(json)).is_ok(),
            Err(error) => {
                log::error!("net: cannot serialize event: {error}");
                false
            }
        }
    }

    fn send_bytes(&self, bytes: Vec<u8>) -> bool {
        self.send(InvokeResponseBody::Raw(bytes)).is_ok()
    }
}

pub struct NetState {
    client: reqwest::Client,
    next_id: AtomicU64,
    fetches: Arc<Mutex<HashMap<u64, AbortHandle>>>,
    sockets: Arc<Mutex<HashMap<u64, Sender<SocketCommand>>>>,
    read_flows: Arc<Mutex<HashMap<u64, Arc<Semaphore>>>>,
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
            read_flows: Arc::default(),
        })
    }

    pub fn client(&self) -> &reqwest::Client {
        &self.client
    }

    fn next_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }

    /// Registration owns cleanup even when a task is cancelled or panics.
    pub fn register_task(&self) -> (NetTask, AbortRegistration) {
        let id = self.next_id();
        let (handle, registration) = AbortHandle::new_pair();
        self.fetches
            .lock()
            .expect("fetches lock")
            .insert(id, handle);
        let flow = Arc::new(Semaphore::new(FETCH_WINDOW_CHUNKS));
        self.read_flows
            .lock()
            .expect("read flows lock")
            .insert(id, flow.clone());
        (
            NetTask {
                id,
                fetches: Arc::clone(&self.fetches),
                sockets: Arc::clone(&self.sockets),
                read_flows: Arc::clone(&self.read_flows),
                flow,
            },
            registration,
        )
    }

    /// Stops a request. Unknown ids are fine: the request may have finished.
    pub fn cancel_fetch(&self, id: u64) {
        if let Some(handle) = self.fetches.lock().expect("fetches lock").remove(&id) {
            handle.abort();
        }
    }

    pub fn acknowledge_fetch(&self, id: u64) {
        if let Some(flow) = self.read_flows.lock().expect("read flows lock").get(&id) {
            if flow.available_permits() < FETCH_WINDOW_CHUNKS {
                flow.add_permits(1);
            }
        }
    }

    pub fn socket_command(&self, id: u64, command: SocketCommand) -> Result<(), AppError> {
        let sockets = self.sockets.lock().expect("sockets lock");
        let sender = sockets
            .get(&id)
            .ok_or_else(|| AppError::Message(format!("Socket {id} is closed")))?;
        let size = match &command {
            SocketCommand::Text(text) => text.len(),
            SocketCommand::Binary(bytes) => bytes.len(),
            SocketCommand::Close(payload) => payload.as_ref().map_or(0, String::len),
        };
        if size > socket::MAX_FRAME_BYTES {
            return Err(AppError::ResourceLimit(
                "WebSocket frame is too large".into(),
            ));
        }
        sender.try_send(command).map_err(|error| match error {
            tokio::sync::mpsc::error::TrySendError::Full(_) => {
                AppError::ResourceLimit("WebSocket send queue is full".into())
            }
            tokio::sync::mpsc::error::TrySendError::Closed(_) => {
                AppError::Message(format!("Socket {id} is closed"))
            }
        })
    }

    /// Closes all active sockets and aborts in-flight fetches on shutdown.
    pub fn close_all(&self) {
        let sockets = std::mem::take(&mut *self.sockets.lock().expect("sockets lock"));
        for sender in sockets.into_values() {
            let _ = sender.try_send(SocketCommand::Close(None));
        }
        let fetches = std::mem::take(&mut *self.fetches.lock().expect("fetches lock"));
        for handle in fetches.into_values() {
            handle.abort();
        }
    }
}

/// A task lease keeps registry mutation inside the network service.
pub struct NetTask {
    flow: Arc<Semaphore>,
    id: u64,
    fetches: Arc<Mutex<HashMap<u64, AbortHandle>>>,
    sockets: Arc<Mutex<HashMap<u64, Sender<SocketCommand>>>>,
    read_flows: Arc<Mutex<HashMap<u64, Arc<Semaphore>>>>,
}
impl NetTask {
    pub fn id(&self) -> u64 {
        self.id
    }
    pub fn read_flow(&self) -> Arc<Semaphore> {
        self.flow.clone()
    }
    pub fn register_socket(&self, sender: Sender<SocketCommand>) {
        self.sockets
            .lock()
            .expect("sockets lock")
            .insert(self.id, sender);
    }
}
impl Drop for NetTask {
    fn drop(&mut self) {
        self.read_flows
            .lock()
            .expect("read flows lock")
            .remove(&self.id);
        self.sockets.lock().expect("sockets lock").remove(&self.id);
        if let Some(handle) = self.fetches.lock().expect("fetches lock").remove(&self.id) {
            handle.abort();
        }
    }
}

#[cfg(test)]
mod tests {
    use futures_util::future::Abortable;
    use tokio::io::AsyncReadExt;
    use tokio::net::TcpListener;

    use super::*;
    use crate::services::net::request::{prepare, Protocol};
    use crate::services::secrets::Secrets;

    #[test]
    fn task_drop_cleans_both_registries() {
        let net = NetState::new().unwrap();
        let (task, _) = net.register_task();
        let (sender, _) = tokio::sync::mpsc::channel(1);
        task.register_socket(sender);
        assert_eq!(net.fetches.lock().unwrap().len(), 1);
        assert_eq!(net.sockets.lock().unwrap().len(), 1);
        drop(task);
        assert!(net.fetches.lock().unwrap().is_empty());
        assert!(net.sockets.lock().unwrap().is_empty());
    }

    #[test]
    fn outgoing_frames_and_queue_memory_are_bounded() {
        let net = NetState::new().unwrap();
        let (sender, mut receiver) = tokio::sync::mpsc::channel(socket::SOCKET_QUEUE_CAPACITY);
        net.sockets.lock().unwrap().insert(1, sender);
        assert!(matches!(
            net.socket_command(
                1,
                SocketCommand::Binary(vec![0; socket::MAX_FRAME_BYTES + 1])
            ),
            Err(AppError::ResourceLimit(_))
        ));
        for _ in 0..socket::SOCKET_QUEUE_CAPACITY {
            net.socket_command(1, SocketCommand::Text("frame".into()))
                .unwrap();
        }
        assert!(matches!(
            net.socket_command(1, SocketCommand::Text("overflow".into())),
            Err(AppError::ResourceLimit(_))
        ));
        receiver.try_recv().unwrap();
        net.socket_command(1, SocketCommand::Close(None)).unwrap();
    }

    #[tokio::test]
    async fn integration_cancellation_drops_an_unfinished_socket_handshake() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let prepared = prepare(
            Protocol::WebSocket,
            &format!("ws://{address}/"),
            &[],
            &Secrets::new(),
        )
        .unwrap();
        let net = NetState::new().unwrap();
        let id = net.next_id();
        let (handle, registration) = AbortHandle::new_pair();
        net.fetches.lock().unwrap().insert(id, handle);
        let connecting = tokio::spawn(async move {
            Abortable::new(socket::connect(&prepared, &[]), registration).await
        });
        let (mut peer, _) = listener.accept().await.unwrap();
        let mut bytes = [0; 4096];
        assert!(peer.read(&mut bytes).await.unwrap() > 0);

        net.cancel_fetch(id);
        assert!(connecting.await.unwrap().is_err());
        let remaining = tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                if peer.read(&mut bytes).await.unwrap() == 0 {
                    break;
                }
            }
        })
        .await;
        assert!(remaining.is_ok(), "cancel closes the pending connection");
        assert!(net.fetches.lock().unwrap().is_empty());
        net.cancel_fetch(id);
    }
}
