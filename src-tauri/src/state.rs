use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use crate::models::{EditorHistoryItem, InitParams};
use crate::services::external_commands::ToolCatalog;

pub struct VoiceCaptureSession {
    /// Lets a stop request name the capture it belongs to, see
    /// `take_voice_capture_session`.
    pub id: u64,
    pub stop_flag: Arc<AtomicBool>,
    pub thread: std::thread::JoinHandle<()>,
}

pub struct AppState {
    params: Mutex<InitParams>,
    history_storage: Mutex<Vec<EditorHistoryItem>>,
    config_storage: Mutex<()>,
    pub chat_images: Mutex<crate::services::chat_images::ChatImageStore>,
    quitting: AtomicBool,
    voice_capture_session: Mutex<Option<VoiceCaptureSession>>,
    voice_capture_operation: tokio::sync::Mutex<()>,
    next_voice_capture_id: AtomicU64,
    /// `None` until the quick window sends it, see `set_tool_catalog`.
    tool_catalog: Mutex<Option<ToolCatalog>>,
}

impl AppState {
    pub fn new(params: InitParams) -> Self {
        Self {
            params: Mutex::new(params),
            history_storage: Mutex::new(Vec::new()),
            config_storage: Mutex::new(()),
            chat_images: Mutex::new(crate::services::chat_images::ChatImageStore::default()),
            quitting: AtomicBool::new(false),
            voice_capture_session: Mutex::new(None),
            voice_capture_operation: tokio::sync::Mutex::new(()),
            next_voice_capture_id: AtomicU64::new(1),
            tool_catalog: Mutex::new(None),
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

    pub fn tool_catalog(&self) -> Option<ToolCatalog> {
        self.tool_catalog
            .lock()
            .expect("tool catalog lock poisoned")
            .clone()
    }

    pub fn set_tool_catalog(&self, catalog: ToolCatalog) {
        *self
            .tool_catalog
            .lock()
            .expect("tool catalog lock poisoned") = Some(catalog);
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

    /// Takes the running capture if it is the one `id` names; `None` takes any.
    /// A late stop from a dictation that is over must not end the next one.
    pub fn take_voice_capture_session(&self, id: Option<u64>) -> Option<VoiceCaptureSession> {
        let mut guard = self
            .voice_capture_session
            .lock()
            .expect("voice capture session lock poisoned");
        match (id, guard.as_ref()) {
            (Some(id), Some(session)) if session.id != id => None,
            _ => guard.take(),
        }
    }

    pub fn next_voice_capture_id(&self) -> u64 {
        self.next_voice_capture_id.fetch_add(1, Ordering::SeqCst)
    }

    pub async fn lock_voice_capture(&self) -> tokio::sync::MutexGuard<'_, ()> {
        self.voice_capture_operation.lock().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(id: u64) -> VoiceCaptureSession {
        VoiceCaptureSession {
            id,
            stop_flag: Arc::new(AtomicBool::new(false)),
            thread: std::thread::spawn(|| {}),
        }
    }

    #[test]
    fn a_stop_for_another_capture_leaves_the_running_one() {
        let state = AppState::new(crate::models::default_init_params(
            serde_json::Value::Null,
            Default::default(),
        ));
        state.replace_voice_capture_session(Some(session(2)));

        assert!(state.take_voice_capture_session(Some(1)).is_none());
        let taken = state.take_voice_capture_session(Some(2)).unwrap();
        assert_eq!(taken.id, 2);
        assert!(state.take_voice_capture_session(None).is_none());
    }

    #[test]
    fn a_stop_without_an_id_takes_any_capture() {
        let state = AppState::new(crate::models::default_init_params(
            serde_json::Value::Null,
            Default::default(),
        ));
        state.replace_voice_capture_session(Some(session(5)));

        assert_eq!(state.take_voice_capture_session(None).unwrap().id, 5);
    }

    #[test]
    fn capture_ids_are_unique() {
        let state = AppState::new(crate::models::default_init_params(
            serde_json::Value::Null,
            Default::default(),
        ));
        assert_ne!(state.next_voice_capture_id(), state.next_voice_capture_id());
    }
}
