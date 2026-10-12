use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use crate::models::DesktopSnapshot;
use crate::services::external_commands::ToolCatalog;
use crate::services::voice_session::VoiceSessionState;

pub struct AppState {
    snapshot: Mutex<DesktopSnapshot>,
    pub(crate) history: crate::services::storage::HistoryStorage,
    config_storage: Mutex<()>,
    pub chat_images: Mutex<crate::services::chat_images::ChatImageStore>,
    quitting: AtomicBool,
    pub(crate) voice_session: VoiceSessionState,
    /// `None` until the quick window sends it, see `set_tool_catalog`.
    tool_catalog: Mutex<Option<ToolCatalog>>,
}

impl AppState {
    pub fn new(params: DesktopSnapshot) -> Self {
        Self {
            snapshot: Mutex::new(params),
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

    pub fn snapshot(&self) -> DesktopSnapshot {
        self.snapshot
            .lock()
            .expect("desktop state lock poisoned")
            .clone()
    }

    pub fn update_state<F>(&self, update: F) -> DesktopSnapshot
    where
        F: FnOnce(&mut DesktopSnapshot),
    {
        let mut params = self.snapshot.lock().expect("desktop state lock poisoned");
        update(&mut params);
        params.revision = params
            .revision
            .checked_add(1)
            .expect("state revision exhausted");
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{default_desktop_state, LocalState};

    #[test]
    fn snapshots_order_settings_and_activation_changes_with_the_same_revision() {
        let state = AppState::new(default_desktop_state(
            serde_json::json!({}),
            LocalState::default(),
        ));
        state.update_state(|params| {
            params.settings.user_config = serde_json::json!({ "theme": "dark" })
        });
        assert_eq!(state.snapshot().revision, 1);
        state.update_state(|params| params.activation.selected_text = Some("New selection".into()));
        let snapshot = state.snapshot();
        assert_eq!(snapshot.revision, 2);
        assert_eq!(snapshot.settings.user_config["theme"], "dark");
        assert_eq!(
            snapshot.activation.selected_text.as_deref(),
            Some("New selection")
        );
    }

    #[test]
    fn concurrent_updates_get_unique_coherent_revisions() {
        let state = AppState::new(default_desktop_state(
            serde_json::json!({}),
            LocalState::default(),
        ));
        let revisions = std::sync::Mutex::new(Vec::new());
        std::thread::scope(|scope| {
            for _ in 0..16 {
                let state = &state;
                let revisions = &revisions;
                scope.spawn(move || {
                    let snapshot =
                        state.update_state(|params| params.activation.activation_id += 1);
                    assert_eq!(snapshot.revision, snapshot.activation.activation_id);
                    revisions.lock().unwrap().push(snapshot.revision);
                });
            }
        });
        let mut revisions = revisions.into_inner().unwrap();
        revisions.sort_unstable();
        assert_eq!(revisions, (1..=16).collect::<Vec<_>>());
    }
}
