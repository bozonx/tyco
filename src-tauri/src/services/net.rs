//! The network, on behalf of the webview.
//!
//! The frontend runs the AI logic, but its requests leave from here: no CORS,
//! and provider keys filled in from `services::secrets` on the way out, so the
//! webview never holds one. Responses and socket frames go back through a
//! Tauri channel — JSON events for control, raw bytes for bodies.

use crate::locks::MutexExt;
pub mod authorization;
pub mod gateway;
pub mod http;
pub mod image;
pub mod request;
pub mod socket;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use futures_util::future::{AbortHandle, AbortRegistration};
use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};
use tokio::sync::{mpsc::Sender, OwnedSemaphorePermit, Semaphore};

pub const FETCH_WINDOW_CHUNKS: usize = 8;
pub const HTTP_CHUNK_SIZE: usize = 64 * 1024;
const MAX_ACTIVE_OPERATIONS: usize = 32;

use crate::errors::AppError;
use socket::SocketCommand;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
/// Silence on an open response longer than this is a dead connection. Long
/// enough for a reasoning model that thinks before its first token.
pub const READ_TIMEOUT: Duration = Duration::from_secs(180);

/// A reqwest builder with the process TLS crypto provider in place: reqwest
/// is built without a bundled one and panics if none is installed.
pub fn client_builder() -> reqwest::ClientBuilder {
    // Fails only when a provider is already installed, which is fine.
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
}

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

#[derive(Default)]
struct TaskActivity {
    active_count: Mutex<usize>,
    changed: Condvar,
}

pub struct NetState {
    admission: Arc<Mutex<bool>>,
    activity: Arc<TaskActivity>,
    client: reqwest::Client,
    operation_permits: Arc<Semaphore>,
    next_id: AtomicU64,
    task_abort_handles: Arc<Mutex<HashMap<u64, AbortHandle>>>,
    /// The window that started each task; only it may steer the task.
    task_owners: Arc<Mutex<HashMap<u64, String>>>,
    sockets: Arc<Mutex<HashMap<u64, Sender<SocketCommand>>>>,
    response_chunk_permits: Arc<Mutex<HashMap<u64, Arc<Semaphore>>>>,
}

impl NetState {
    pub fn new() -> Result<Self, AppError> {
        let client = client_builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .read_timeout(READ_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| AppError::Failed(format!("HTTP client: {error}")))?;

        Ok(Self {
            admission: Arc::default(),
            activity: Arc::default(),
            client,
            operation_permits: Arc::new(Semaphore::new(MAX_ACTIVE_OPERATIONS)),
            next_id: AtomicU64::new(1),
            task_abort_handles: Arc::default(),
            task_owners: Arc::default(),
            sockets: Arc::default(),
            response_chunk_permits: Arc::default(),
        })
    }

    pub fn client(&self) -> &reqwest::Client {
        &self.client
    }

    fn next_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }

    /// Registration owns cleanup even when a task is cancelled or panics.
    /// `owner` names the window that started the task.
    pub fn register_task(
        &self,
        owner: &str,
    ) -> Result<(NetTaskRegistration, AbortRegistration), AppError> {
        let operation_permit =
            self.operation_permits
                .clone()
                .try_acquire_owned()
                .map_err(|error| match error {
                    tokio::sync::TryAcquireError::Closed => {
                        AppError::ServiceUnavailable("Network service is stopping".into())
                    }
                    tokio::sync::TryAcquireError::NoPermits => {
                        AppError::ResourceLimit("Too many active network operations".into())
                    }
                })?;
        let id = self.next_id();
        let (handle, registration) = AbortHandle::new_pair();
        self.task_abort_handles.locked().insert(id, handle);
        self.task_owners.locked().insert(id, owner.to_owned());
        let chunk_permits = Arc::new(Semaphore::new(FETCH_WINDOW_CHUNKS));
        self.response_chunk_permits
            .locked()
            .insert(id, chunk_permits.clone());
        *self.activity.active_count.locked() += 1;
        Ok((
            NetTaskRegistration {
                admission: self.admission.clone(),
                activity: self.activity.clone(),
                _operation_permit: operation_permit,
                id,
                task_abort_handles: Arc::clone(&self.task_abort_handles),
                task_owners: Arc::clone(&self.task_owners),
                sockets: Arc::clone(&self.sockets),
                response_chunk_permits: Arc::clone(&self.response_chunk_permits),
                chunk_permits,
            },
            registration,
        ))
    }

    fn is_owned_by(&self, id: u64, owner: &str) -> bool {
        self.task_owners
            .locked()
            .get(&id)
            .is_some_and(|task_owner| task_owner == owner)
    }

    /// Stops a request. Unknown ids are fine: the request may have finished.
    pub fn cancel_task(&self, owner: &str, id: u64) {
        if !self.is_owned_by(id, owner) {
            return;
        }
        if let Some(handle) = self.task_abort_handles.locked().remove(&id) {
            handle.abort();
        }
    }

    /// Lets a response send one more chunk: the webview took one.
    pub fn acknowledge_fetch_chunk(&self, owner: &str, id: u64) {
        if !self.is_owned_by(id, owner) {
            return;
        }
        if let Some(chunk_permits) = self.response_chunk_permits.locked().get(&id) {
            if chunk_permits.available_permits() < FETCH_WINDOW_CHUNKS {
                chunk_permits.add_permits(1);
            }
        }
    }

    pub fn socket_command(
        &self,
        owner: &str,
        id: u64,
        command: SocketCommand,
    ) -> Result<(), AppError> {
        if !self.is_owned_by(id, owner) {
            return Err(AppError::Stale(format!("Socket {id} is closed")));
        }
        let sockets = self.sockets.locked();
        let sender = sockets
            .get(&id)
            .ok_or_else(|| AppError::Stale(format!("Socket {id} is closed")))?;
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
                AppError::Stale(format!("Socket {id} is closed"))
            }
        })
    }
}

impl crate::services::background::StoppableService for NetState {
    /// Closes all active sockets and aborts in-flight fetches on shutdown.
    fn stop(&self) {
        let mut is_stopping = self.admission.locked();
        *is_stopping = true;
        self.operation_permits.close();
        let sockets = std::mem::take(&mut *self.sockets.locked());
        for sender in sockets.into_values() {
            let _ = sender.try_send(SocketCommand::Close(None));
        }
        let task_abort_handles = std::mem::take(&mut *self.task_abort_handles.locked());
        for handle in task_abort_handles.into_values() {
            handle.abort();
        }
    }
    fn wait_until(&self, deadline: Instant) -> bool {
        let count = self.activity.active_count.locked();
        *self
            .activity
            .changed
            .wait_timeout_while(
                count,
                deadline.saturating_duration_since(Instant::now()),
                |count| *count != 0,
            )
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .0
            == 0
    }
}

/// A task lease keeps registry mutation inside the network service.
pub struct NetTaskRegistration {
    admission: Arc<Mutex<bool>>,
    activity: Arc<TaskActivity>,
    _operation_permit: OwnedSemaphorePermit,
    chunk_permits: Arc<Semaphore>,
    id: u64,
    task_abort_handles: Arc<Mutex<HashMap<u64, AbortHandle>>>,
    task_owners: Arc<Mutex<HashMap<u64, String>>>,
    sockets: Arc<Mutex<HashMap<u64, Sender<SocketCommand>>>>,
    response_chunk_permits: Arc<Mutex<HashMap<u64, Arc<Semaphore>>>>,
}
impl NetTaskRegistration {
    pub fn id(&self) -> u64 {
        self.id
    }
    pub fn response_chunk_permits(&self) -> Arc<Semaphore> {
        self.chunk_permits.clone()
    }
    pub fn register_socket(&self, sender: Sender<SocketCommand>) -> bool {
        let is_stopping = self.admission.locked();
        if *is_stopping {
            return false;
        }
        self.sockets.locked().insert(self.id, sender);
        true
    }
}
impl Drop for NetTaskRegistration {
    fn drop(&mut self) {
        self.response_chunk_permits.locked().remove(&self.id);
        self.sockets.locked().remove(&self.id);
        self.task_owners.locked().remove(&self.id);
        if let Some(handle) = self.task_abort_handles.locked().remove(&self.id) {
            handle.abort();
        }
        *self.activity.active_count.locked() -= 1;
        self.activity.changed.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use crate::services::background::StoppableService;
    use futures_util::future::Abortable;
    use tokio::io::AsyncReadExt;
    use tokio::net::TcpListener;

    use super::*;
    use crate::services::runtime::{MAIN_WINDOW_LABEL, QUICK_WINDOW_LABEL};

    const OWNER: &str = MAIN_WINDOW_LABEL;
    use crate::services::net::request::{prepare, Protocol};
    use crate::services::secrets::Secrets;

    #[test]
    fn active_operations_are_bounded_and_release_capacity_only_on_drop() {
        let net = NetState::new().unwrap();
        let mut tasks = (0..MAX_ACTIVE_OPERATIONS)
            .map(|_| net.register_task(OWNER).unwrap().0)
            .collect::<Vec<_>>();
        assert!(matches!(
            net.register_task(OWNER),
            Err(AppError::ResourceLimit(_))
        ));
        net.cancel_task(OWNER, tasks[0].id());
        assert!(matches!(
            net.register_task(OWNER),
            Err(AppError::ResourceLimit(_))
        ));
        tasks.pop();
        let (replacement, _) = net.register_task(OWNER).unwrap();
        drop(tasks);
        drop(replacement);
        assert!(net.wait_until(Instant::now()));
    }

    #[test]
    fn shutdown_rejects_new_tasks_and_late_socket_registration() {
        let net = NetState::new().unwrap();
        let (task, _) = net.register_task(OWNER).unwrap();
        net.stop();
        assert!(matches!(
            net.register_task(OWNER),
            Err(AppError::ServiceUnavailable(_))
        ));
        let (sender, _) = tokio::sync::mpsc::channel(1);
        assert!(!task.register_socket(sender));
        assert!(!net.wait_until(Instant::now()));
        drop(task);
        assert!(net.wait_until(Instant::now()));
        assert!(net.sockets.lock().unwrap().is_empty());
    }

    #[test]
    fn concurrent_registration_never_exceeds_the_global_limit() {
        let net = NetState::new().unwrap();
        let gate = std::sync::Barrier::new(MAX_ACTIVE_OPERATIONS * 2);
        let accepted = std::sync::atomic::AtomicUsize::new(0);
        std::thread::scope(|scope| {
            for _ in 0..MAX_ACTIVE_OPERATIONS * 2 {
                scope.spawn(|| {
                    let lease = net.register_task(OWNER);
                    if lease.is_ok() {
                        accepted.fetch_add(1, Ordering::SeqCst);
                    }
                    gate.wait();
                    drop(lease);
                });
            }
        });
        assert_eq!(accepted.load(Ordering::SeqCst), MAX_ACTIVE_OPERATIONS);
        assert!(net.wait_until(Instant::now()));
    }

    #[test]
    fn task_registration_drop_cleans_all_registries() {
        let net = NetState::new().unwrap();
        let (task, _) = net.register_task(OWNER).unwrap();
        let (sender, _) = tokio::sync::mpsc::channel(1);
        task.register_socket(sender);
        assert_eq!(net.task_abort_handles.lock().unwrap().len(), 1);
        assert_eq!(net.sockets.lock().unwrap().len(), 1);
        assert_eq!(net.response_chunk_permits.lock().unwrap().len(), 1);
        drop(task);
        assert!(net.task_abort_handles.lock().unwrap().is_empty());
        assert!(net.task_owners.lock().unwrap().is_empty());
        assert!(net.sockets.lock().unwrap().is_empty());
        assert!(net.response_chunk_permits.lock().unwrap().is_empty());
    }

    #[test]
    fn only_the_window_that_started_a_task_steers_it() {
        let net = NetState::new().unwrap();
        let (task, _) = net.register_task(OWNER).unwrap();
        let (sender, _receiver) = tokio::sync::mpsc::channel(1);
        task.register_socket(sender);
        assert!(matches!(
            net.socket_command(QUICK_WINDOW_LABEL, task.id(), SocketCommand::Close(None)),
            Err(AppError::Stale(_))
        ));
        net.cancel_task(QUICK_WINDOW_LABEL, task.id());
        assert_eq!(net.task_abort_handles.lock().unwrap().len(), 1);
        net.cancel_task(OWNER, task.id());
        assert!(net.task_abort_handles.lock().unwrap().is_empty());
    }

    #[test]
    fn outgoing_frames_and_queue_memory_are_bounded() {
        let net = NetState::new().unwrap();
        let (sender, mut receiver) = tokio::sync::mpsc::channel(socket::SOCKET_QUEUE_CAPACITY);
        net.sockets.lock().unwrap().insert(1, sender);
        net.task_owners.lock().unwrap().insert(1, OWNER.into());
        assert!(matches!(
            net.socket_command(
                OWNER,
                1,
                SocketCommand::Binary(vec![0; socket::MAX_FRAME_BYTES + 1])
            ),
            Err(AppError::ResourceLimit(_))
        ));
        for _ in 0..socket::SOCKET_QUEUE_CAPACITY {
            net.socket_command(OWNER, 1, SocketCommand::Text("frame".into()))
                .unwrap();
        }
        assert!(matches!(
            net.socket_command(OWNER, 1, SocketCommand::Text("overflow".into())),
            Err(AppError::ResourceLimit(_))
        ));
        receiver.try_recv().unwrap();
        net.socket_command(OWNER, 1, SocketCommand::Close(None))
            .unwrap();
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
        net.task_abort_handles.lock().unwrap().insert(id, handle);
        net.task_owners.lock().unwrap().insert(id, OWNER.into());
        let connecting = tokio::spawn(async move {
            Abortable::new(socket::connect(&prepared, &[]), registration).await
        });
        let (mut peer, _) = listener.accept().await.unwrap();
        let mut bytes = [0; 4096];
        assert!(peer.read(&mut bytes).await.unwrap() > 0);

        net.cancel_task(OWNER, id);
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
        assert!(net.task_abort_handles.lock().unwrap().is_empty());
        net.cancel_task(OWNER, id);
    }
}
