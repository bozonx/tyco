use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use crate::models::InitParams;

pub struct LocalVoiceRecordingSession {
    pub stop_flag: Arc<AtomicBool>,
    pub thread: std::thread::JoinHandle<()>,
    pub samples: Arc<Mutex<Vec<i16>>>,
    pub stream_error: Arc<Mutex<Option<String>>>,
    pub limit_reached: Arc<AtomicBool>,
    pub sample_rate: u32,
}

pub struct AppState {
    params: Mutex<InitParams>,
    history_storage: Mutex<()>,
    quitting: AtomicBool,
    local_voice_recording_session: Mutex<Option<LocalVoiceRecordingSession>>,
    local_voice_recording_operation: tokio::sync::Mutex<()>,
}

impl AppState {
    pub fn new(params: InitParams) -> Self {
        Self {
            params: Mutex::new(params),
            history_storage: Mutex::new(()),
            quitting: AtomicBool::new(false),
            local_voice_recording_session: Mutex::new(None),
            local_voice_recording_operation: tokio::sync::Mutex::new(()),
        }
    }

    /// Serializes read-modify-write operations on history files.
    pub fn lock_history_storage(&self) -> std::sync::MutexGuard<'_, ()> {
        self.history_storage
            .lock()
            .expect("history storage lock poisoned")
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

    pub fn replace_local_voice_recording_session(
        &self,
        session: Option<LocalVoiceRecordingSession>,
    ) -> Option<LocalVoiceRecordingSession> {
        let mut guard = self
            .local_voice_recording_session
            .lock()
            .expect("local voice recording session lock poisoned");
        std::mem::replace(&mut *guard, session)
    }

    pub async fn lock_local_voice_recording(&self) -> tokio::sync::MutexGuard<'_, ()> {
        self.local_voice_recording_operation.lock().await
    }
}
