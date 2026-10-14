use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use crate::models::DesktopSnapshot;
use crate::services::external_commands::ToolCatalog;
use crate::services::voice_session::VoiceSessionState;

pub struct AppState {
    snapshot: Mutex<DesktopSnapshot>,
    pub(crate) history: crate::services::storage::HistoryStorageCoordinator,
    settings_update_lock: Mutex<()>,
    pub chat_images: Mutex<crate::services::chat_images::ChatImageStore>,
    is_quitting: AtomicBool,
    pub(crate) voice_session: VoiceSessionState,
    /// `None` until the quick window sends it, see `set_tool_catalog`.
    tool_catalog: Mutex<Option<ToolCatalog>>,
}

impl AppState {
    pub fn new(initial_snapshot: DesktopSnapshot) -> Self {
        Self {
            snapshot: Mutex::new(initial_snapshot),
            history: crate::services::storage::HistoryStorageCoordinator::default(),
            settings_update_lock: Mutex::new(()),
            chat_images: Mutex::new(crate::services::chat_images::ChatImageStore::default()),
            is_quitting: AtomicBool::new(false),
            voice_session: VoiceSessionState::default(),
            tool_catalog: Mutex::new(None),
        }
    }

    /// Serializes config writes and session updates to keep snapshots coherent.
    pub fn lock_settings_update(&self) -> std::sync::MutexGuard<'_, ()> {
        self.settings_update_lock
            .lock()
            .expect("config storage lock poisoned")
    }

    pub fn snapshot(&self) -> DesktopSnapshot {
        self.snapshot
            .lock()
            .expect("desktop state lock poisoned")
            .clone()
    }

    pub fn update_snapshot<F>(&self, update: F) -> DesktopSnapshot
    where
        F: FnOnce(&mut DesktopSnapshot),
    {
        let mut snapshot = self.snapshot.lock().expect("desktop state lock poisoned");
        update(&mut snapshot);
        snapshot.revision = snapshot
            .revision
            .checked_add(1)
            .expect("state revision exhausted");
        snapshot.clone()
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
        self.is_quitting.store(quitting, Ordering::SeqCst);
    }

    pub fn is_quitting(&self) -> bool {
        self.is_quitting.load(Ordering::SeqCst)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{default_desktop_snapshot, SessionState};

    #[test]
    fn snapshots_order_settings_and_activation_changes_with_the_same_revision() {
        let state = AppState::new(default_desktop_snapshot(
            serde_json::json!({}),
            SessionState::default(),
        ));
        state.update_snapshot(|snapshot| {
            snapshot.settings.user_config = serde_json::json!({ "theme": "dark" })
        });
        assert_eq!(state.snapshot().revision, 1);
        state.update_snapshot(|snapshot| {
            snapshot.activation.selected_text = Some("New selection".into())
        });
        let snapshot = state.snapshot();
        assert_eq!(snapshot.revision, 2);
        assert_eq!(snapshot.settings.user_config["theme"], "dark");
        assert_eq!(
            snapshot.activation.selected_text.as_deref(),
            Some("New selection")
        );
    }

    #[test]
    fn session_preferences_do_not_survive_a_new_app_state() {
        let config = serde_json::json!({ "theme": "dark" });
        let create_state = || {
            AppState::new(default_desktop_snapshot(
                config.clone(),
                SessionState::default(),
            ))
        };
        let state = create_state();
        state.update_snapshot(|snapshot| {
            snapshot.settings.session_state.last_chat_id = Some("chat".into());
            snapshot.settings.session_state.recent_ai_prompts = vec!["Private prompt".into()];
        });
        assert_eq!(
            state
                .snapshot()
                .settings
                .session_state
                .last_chat_id
                .as_deref(),
            Some("chat")
        );

        let restarted = create_state().snapshot();
        assert!(restarted.settings.session_state.last_chat_id.is_none());
        assert!(restarted
            .settings
            .session_state
            .recent_ai_prompts
            .is_empty());
        assert_eq!(restarted.settings.user_config, config);
    }

    #[test]
    fn concurrent_updates_get_unique_coherent_revisions() {
        let state = AppState::new(default_desktop_snapshot(
            serde_json::json!({}),
            SessionState::default(),
        ));
        let revisions = std::sync::Mutex::new(Vec::new());
        std::thread::scope(|scope| {
            for _ in 0..16 {
                let state = &state;
                let revisions = &revisions;
                scope.spawn(move || {
                    let snapshot =
                        state.update_snapshot(|snapshot| snapshot.activation.activation_id += 1);
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
