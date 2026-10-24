//! Settings transactions are independent of IPC; adapters supply native effects.
pub mod defaults;
pub mod merge;
pub mod persist;
pub mod schema;
pub mod session_state;
pub mod version;

use serde_json::Value;
use tauri::{AppHandle, Manager};

use super::secrets::SecretStore;
use super::storage::HistorySettings;
use super::{hotkeys, runtime, secrets::webhook, storage};
use crate::{errors::AppError, models::DesktopSnapshot, state::AppState};

trait HeaderSecrets {
    fn retain(self);
    fn commit(self, previous: &Value, next: &Value);
}

impl HeaderSecrets for webhook::PendingHeaderSecrets<'_> {
    fn retain(self) {
        self.retain();
    }
    fn commit(self, previous: &Value, next: &Value) {
        self.commit(previous, next);
    }
}

trait SettingsHost {
    type Secrets: HeaderSecrets;
    fn protect(&self, config: &mut Value) -> Result<Self::Secrets, AppError>;
    fn write_config(&self, config: &Value) -> Result<(), AppError>;
    fn with_hotkeys<T>(
        &self,
        previous: &Value,
        next: &Value,
        commit: impl FnOnce() -> Result<T, AppError>,
    ) -> Result<T, AppError>;
    fn with_history<T>(
        &self,
        before: HistorySettings,
        after: HistorySettings,
        commit: impl FnOnce() -> Result<T, AppError>,
    ) -> Result<T, AppError>;
    fn publish(&self, state: &AppState);
}

struct AppSettingsHost<'a> {
    app: &'a AppHandle,
    secrets: &'a SecretStore,
    history: &'a storage::HistoryStorageCoordinator,
}

impl<'a> SettingsHost for AppSettingsHost<'a> {
    type Secrets = webhook::PendingHeaderSecrets<'a>;
    fn protect(&self, config: &mut Value) -> Result<Self::Secrets, AppError> {
        webhook::protect_for_save(self.secrets, config)
    }
    fn write_config(&self, config: &Value) -> Result<(), AppError> {
        persist::save_user_config(self.app, config)
    }
    fn with_hotkeys<T>(
        &self,
        previous: &Value,
        next: &Value,
        commit: impl FnOnce() -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        hotkeys::with_config_changes(self.app, previous, next, commit)
    }
    fn with_history<T>(
        &self,
        before: HistorySettings,
        after: HistorySettings,
        commit: impl FnOnce() -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        self.history
            .commit_settings(self.app, before, after, commit)
    }
    fn publish(&self, state: &AppState) {
        runtime::publish_state(self.app, state);
    }
}

/// Resolve runtime dependencies once, at the application boundary.
pub fn save_user_config(
    app: &AppHandle,
    next: Value,
    base: Value,
) -> Result<DesktopSnapshot, AppError> {
    let state = app.state::<AppState>();
    let secrets = app.state::<SecretStore>();
    save_with(
        &state,
        &AppSettingsHost {
            app,
            secrets: &secrets,
            history: &state.history,
        },
        next,
        base,
    )
}

/// Changes the config on behalf of the app itself, e.g. for a permission the
/// user granted in a prompt. It is a save like any other: merged with what
/// was saved meanwhile, with the secrets, hotkeys and history kept in step.
pub fn update_user_config(
    app: &AppHandle,
    change: impl FnOnce(&mut Value),
) -> Result<DesktopSnapshot, AppError> {
    let base = Value::clone(&app.state::<AppState>().user_config());
    let mut next = base.clone();
    change(&mut next);
    save_user_config(app, next, base)
}

pub fn patch_session_state(
    app: &AppHandle,
    patch: serde_json::Map<String, Value>,
) -> Result<DesktopSnapshot, AppError> {
    let state = app.state::<AppState>();
    let snapshot = patch_session_state_of(&state, patch)?;
    runtime::publish_state(app, &state);
    Ok(snapshot)
}

fn patch_session_state_of(
    state: &AppState,
    patch: serde_json::Map<String, Value>,
) -> Result<DesktopSnapshot, AppError> {
    let _guard = state.lock_settings_update();
    ensure_running(state)?;
    let session =
        session_state::merge_session_state(&state.snapshot().settings.session_state, patch)?;
    Ok(state.update_snapshot(|snapshot| snapshot.settings.session_state = session))
}

fn ensure_running(state: &AppState) -> Result<(), AppError> {
    if state.is_quitting() {
        return Err(AppError::ServiceUnavailable(
            "Settings service is stopping".into(),
        ));
    }
    Ok(())
}

fn save_with(
    state: &AppState,
    host: &impl SettingsHost,
    next: Value,
    base: Value,
) -> Result<DesktopSnapshot, AppError> {
    let _guard = state.lock_settings_update();
    ensure_running(state)?;
    let previous = Value::clone(&state.user_config());
    if version::is_newer_than_supported(&previous) {
        return Err(persist::newer_config_error());
    }
    let mut next = merge::merge_config(&previous, &base, &next)?;
    schema::validate_user_config(&next)?;
    let mut pending = Some(host.protect(&mut next)?);
    let before = HistorySettings::from_config(&previous);
    let after = HistorySettings::from_config(&next);
    let snapshot = host.with_hotkeys(&previous, &next, || {
        host.with_history(before, after, || {
            if let Err(error) = host.write_config(&next) {
                // A directory sync can fail after rename, so restore the old file.
                if let Err(rollback) = host.write_config(&previous) {
                    pending.take().expect("pending header secrets").retain();
                    return Err(AppError::Failed(format!(
                        "Could not save config: {error}; could not restore config: {rollback}"
                    )));
                }
                return Err(error);
            }
            // Exactly one publication, while the history repositories are locked.
            Ok(state.update_snapshot(|snapshot| {
                snapshot.settings.user_config = std::sync::Arc::new(next.clone())
            }))
        })
    })?;
    pending
        .expect("pending header secrets")
        .commit(&previous, &next);
    host.publish(state);
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::defaults::{default_desktop_snapshot, default_user_config};
    use super::*;
    use crate::models::SessionState;
    use std::cell::RefCell;

    struct FakeSecrets;
    impl HeaderSecrets for FakeSecrets {
        fn retain(self) {}
        fn commit(self, _: &Value, _: &Value) {}
    }
    #[derive(Default)]
    struct Host {
        calls: RefCell<Vec<&'static str>>,
        disk: RefCell<Value>,
        fail_save: bool,
        fail_rollback: bool,
        conflict: bool,
        fail_history: bool,
    }
    impl SettingsHost for Host {
        type Secrets = FakeSecrets;
        fn protect(&self, _: &mut Value) -> Result<FakeSecrets, AppError> {
            Ok(FakeSecrets)
        }
        fn write_config(&self, config: &Value) -> Result<(), AppError> {
            let is_save = !self.calls.borrow().contains(&"write");
            self.calls.borrow_mut().push("write");
            *self.disk.borrow_mut() = config.clone();
            if (is_save && self.fail_save) || (!is_save && self.fail_rollback) {
                Err(AppError::Io(std::io::Error::other("Disk unavailable")))
            } else {
                Ok(())
            }
        }
        fn with_hotkeys<T>(
            &self,
            _: &Value,
            _: &Value,
            commit: impl FnOnce() -> Result<T, AppError>,
        ) -> Result<T, AppError> {
            if self.conflict {
                return Err(AppError::InvalidInput("Shortcut conflict".into()));
            }
            commit()
        }
        fn with_history<T>(
            &self,
            _: HistorySettings,
            _: HistorySettings,
            commit: impl FnOnce() -> Result<T, AppError>,
        ) -> Result<T, AppError> {
            self.calls.borrow_mut().push("prepare");
            if self.fail_history {
                return Err(AppError::Failed("Could not prepare editor history".into()));
            }
            let result = commit()?;
            self.calls.borrow_mut().push("cleanup");
            Ok(result)
        }
        fn publish(&self, _: &AppState) {
            self.calls.borrow_mut().push("publish");
        }
    }
    fn state() -> AppState {
        AppState::new(default_desktop_snapshot(
            default_user_config(),
            SessionState::default(),
        ))
    }
    fn changed(base: &Value) -> Value {
        let mut next = base.clone();
        next["language"]["ui"] = serde_json::json!("ru-RU");
        next
    }
    #[test]
    fn session_patch_preserves_config_and_increments_revision_once() {
        let state = state();
        let config = Value::clone(&state.user_config());
        let patch = serde_json::from_value(serde_json::json!({"lastChatId":"chat-id"})).unwrap();
        let saved = patch_session_state_of(&state, patch).unwrap();
        assert_eq!(saved.revision, 1);
        assert_eq!(
            saved.settings.session_state.last_chat_id.as_deref(),
            Some("chat-id")
        );
        assert_eq!(*saved.settings.user_config, config);
    }

    #[test]
    fn shutdown_rejects_config_and_session_updates_without_effects() {
        let state = state();
        let base = Value::clone(&state.user_config());
        state.begin_quitting();
        let host = Host::default();
        assert!(matches!(
            save_with(&state, &host, changed(&base), base),
            Err(AppError::ServiceUnavailable(_))
        ));
        assert!(matches!(
            patch_session_state_of(&state, serde_json::Map::new()),
            Err(AppError::ServiceUnavailable(_))
        ));
        assert!(host.calls.borrow().is_empty());
        assert_eq!(state.snapshot().revision, 0);
    }

    #[test]
    fn save_commits_once_before_cleanup_and_publication() {
        let state = state();
        let base = Value::clone(&state.user_config());
        let host = Host::default();
        let next = changed(&base);
        let saved = save_with(&state, &host, next.clone(), base).unwrap();
        assert_eq!(saved.revision, 1);
        assert_eq!(*saved.settings.user_config, next);
        assert_eq!(
            *host.calls.borrow(),
            ["prepare", "write", "cleanup", "publish"]
        );
    }
    #[test]
    fn failed_save_restores_disk_without_cleanup_or_publication() {
        let state = state();
        let base = Value::clone(&state.user_config());
        let host = Host {
            fail_save: true,
            ..Host::default()
        };
        assert!(save_with(&state, &host, changed(&base), base.clone()).is_err());
        assert_eq!(*host.disk.borrow(), base);
        assert_eq!(state.snapshot().revision, 0);
        assert_eq!(*host.calls.borrow(), ["prepare", "write", "write"]);
    }
    #[test]
    fn failed_rollback_is_reported_without_publishing_uncertain_state() {
        let state = state();
        let base = Value::clone(&state.user_config());
        let host = Host {
            fail_save: true,
            fail_rollback: true,
            ..Host::default()
        };
        let error = save_with(&state, &host, changed(&base), base).unwrap_err();
        assert!(error.to_string().contains("could not restore config"));
        assert_eq!(state.snapshot().revision, 0);
    }
    #[test]
    fn conflicting_hotkeys_do_not_touch_storage() {
        let state = state();
        let base = Value::clone(&state.user_config());
        let host = Host {
            conflict: true,
            ..Host::default()
        };
        assert!(save_with(&state, &host, changed(&base), base).is_err());
        assert!(host.calls.borrow().is_empty());
    }
    #[test]
    fn a_failed_history_preparation_saves_and_publishes_nothing() {
        let state = state();
        let base = Value::clone(&state.user_config());
        let host = Host {
            fail_history: true,
            ..Host::default()
        };
        assert!(save_with(&state, &host, changed(&base), base.clone()).is_err());
        assert_eq!(*host.calls.borrow(), ["prepare"]);
        assert_eq!(state.snapshot().revision, 0);
        assert_eq!(*state.user_config(), base);
    }

    #[test]
    fn stale_independent_edit_preserves_the_committed_language() {
        let state = state();
        let base = Value::clone(&state.user_config());
        save_with(&state, &Host::default(), changed(&base), base.clone()).unwrap();
        let mut stale = base.clone();
        stale["llm"]["tasks"]["chat"]["rule"] = serde_json::json!("Use concise answers");
        let saved = save_with(&state, &Host::default(), stale, base).unwrap();
        assert_eq!(saved.revision, 2);
        assert_eq!(saved.settings.user_config["language"]["ui"], "ru-RU");
        assert_eq!(
            saved.settings.user_config["llm"]["tasks"]["chat"]["rule"],
            "Use concise answers"
        );
    }
}
