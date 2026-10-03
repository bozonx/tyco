use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use crate::models::{EditorHistoryItem, InitParams};

pub struct VoiceCaptureSession {
    pub stop_flag: Arc<AtomicBool>,
    pub thread: std::thread::JoinHandle<()>,
}

pub struct AppState {
    params: Mutex<InitParams>,
    history_storage: Mutex<Vec<EditorHistoryItem>>,
    config_storage: Mutex<()>,
    quitting: AtomicBool,
    voice_capture_session: Mutex<Option<VoiceCaptureSession>>,
    voice_capture_operation: tokio::sync::Mutex<()>,
}

impl AppState {
    pub fn new(params: InitParams) -> Self {
        Self {
            params: Mutex::new(params),
            history_storage: Mutex::new(Vec::new()),
            config_storage: Mutex::new(()),
            quitting: AtomicBool::new(false),
            voice_capture_session: Mutex::new(None),
            voice_capture_operation: tokio::sync::Mutex::new(()),
        }
    }

    /// Serializes read-modify-write operations on the history. Holds the
    /// editor history itself while the settings keep it in memory only.
    pub fn lock_history_storage(&self) -> std::sync::MutexGuard<'_, Vec<EditorHistoryItem>> {
        self.history_storage
            .lock()
            .expect("history storage lock poisoned")
    }

    /// Serializes writes of the user config and the local state, so that the
    /// file and `params` always end up with the same, latest value.
    pub fn lock_config_storage(&self) -> std::sync::MutexGuard<'_, ()> {
        self.config_storage
            .lock()
            .expect("config storage lock poisoned")
    }

    pub fn params(&self) -> InitParams {
        self.params.lock().expect("params lock poisoned").clone()
    }

    pub fn update_params<F>(&self, update: F) -> InitParams
    where
        F: FnOnce(&mut InitParams),
    {
        let mut params = self.params.lock().expect("params lock poisoned");
        update(&mut params);
        params.clone()
    }

    pub fn set_quitting(&self, quitting: bool) {
        self.quitting.store(quitting, Ordering::SeqCst);
    }

    pub fn is_quitting(&self) -> bool {
        self.quitting.load(Ordering::SeqCst)
    }

    pub fn replace_voice_capture_session(
        &self,
        session: Option<VoiceCaptureSession>,
    ) -> Option<VoiceCaptureSession> {
        let mut guard = self
            .voice_capture_session
            .lock()
            .expect("voice capture session lock poisoned");
        std::mem::replace(&mut *guard, session)
    }

    pub async fn lock_voice_capture(&self) -> tokio::sync::MutexGuard<'_, ()> {
        self.voice_capture_operation.lock().await
    }
}
