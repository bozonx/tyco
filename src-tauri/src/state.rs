use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use crate::models::InitParams;
use crate::services::external_commands::ToolCatalog;
use crate::services::voice_session::VoiceSessionState;

pub struct AppState {
    params: Mutex<InitParams>,
    pub(crate) history: crate::services::storage::HistoryStorage,
    config_storage: Mutex<()>,
    pub chat_images: Mutex<crate::services::chat_images::ChatImageStore>,
    quitting: AtomicBool,
    pub(crate) voice_session: VoiceSessionState,
    /// `None` until the quick window sends it, see `set_tool_catalog`.
    tool_catalog: Mutex<Option<ToolCatalog>>,
}

impl AppState {
    pub fn new(params: InitParams) -> Self {
        Self {
            params: Mutex::new(params),
            history: crate::services::storage::HistoryStorage::default(),
            config_storage: Mutex::new(()),
            chat_images: Mutex::new(crate::services::chat_images::ChatImageStore::default()),
            quitting: AtomicBool::new(false),
            voice_session: VoiceSessionState::default(),
            tool_catalog: Mutex::new(None),
        }
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
}
