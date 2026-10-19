use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Mutex;

use crate::models::DesktopSnapshot;

const PHASE_RUNNING: u8 = 0;
const PHASE_QUITTING: u8 = 1;
const PHASE_SHUTTING_DOWN: u8 = 2;

pub struct AppState {
    snapshot: Mutex<DesktopSnapshot>,
    pub(crate) history: crate::services::storage::HistoryStorageCoordinator,
    settings_update_lock: Mutex<()>,
    phase: AtomicU8,
}

impl AppState {
    pub fn new(initial_snapshot: DesktopSnapshot) -> Self {
        Self {
            snapshot: Mutex::new(initial_snapshot),
            history: crate::services::storage::HistoryStorageCoordinator::default(),
            settings_update_lock: Mutex::new(()),
            phase: AtomicU8::new(PHASE_RUNNING),
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

    /// The user or a caller asked the app to quit: new work is refused from
    /// now on. True for the call that made the change.
    pub fn begin_quitting(&self) -> bool {
        self.phase
            .compare_exchange(
                PHASE_RUNNING,
                PHASE_QUITTING,
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .is_ok()
    }

    /// The services are being stopped; it happens once, whether or not the
    /// app was asked to quit first. True for the call that starts it.
    pub fn begin_shutdown(&self) -> bool {
        self.phase.swap(PHASE_SHUTTING_DOWN, Ordering::SeqCst) != PHASE_SHUTTING_DOWN
    }

    pub fn is_quitting(&self) -> bool {
        self.phase.load(Ordering::SeqCst) != PHASE_RUNNING
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::SessionState;
    use crate::services::settings::defaults::default_desktop_snapshot;

    #[test]
    fn snapshots_order_settings_and_activation_changes_with_the_same_revision() {
        let state = AppState::new(default_desktop_snapshot(
            serde_json::json!({}),
            SessionState::default(),
        ));
        state.update_snapshot(|snapshot| {
            snapshot.settings.user_config = serde_json::json!({"appearance":{"theme":"dark" }})
        });
        assert_eq!(state.snapshot().revision, 1);
        state.update_snapshot(|snapshot| {
            snapshot.activation.selected_text = Some("New selection".into())
        });
        let snapshot = state.snapshot();
        assert_eq!(snapshot.revision, 2);
        assert_eq!(snapshot.settings.user_config["appearance"]["theme"], "dark");
        assert_eq!(
            snapshot.activation.selected_text.as_deref(),
            Some("New selection")
        );
    }

    #[test]
    fn session_preferences_do_not_survive_a_new_app_state() {
        let config = serde_json::json!({"appearance":{"theme":"dark" }});
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
    fn quitting_comes_before_a_single_shutdown() {
        let state = AppState::new(default_desktop_snapshot(
            serde_json::json!({}),
            SessionState::default(),
        ));
        assert!(!state.is_quitting());
        assert!(state.begin_quitting());
        assert!(!state.begin_quitting());
        assert!(state.is_quitting());
        assert!(state.begin_shutdown());
        assert!(!state.begin_shutdown());
        assert!(!state.begin_quitting());
        assert!(state.is_quitting());
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
