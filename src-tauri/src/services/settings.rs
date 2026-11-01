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
    /// `config` with the changes another device synced meanwhile; nothing is
    /// written.
    fn with_disk_changes(&self, config: &Value) -> Result<Value, AppError>;
    /// Writes the config and returns it as saved: with the changes another
    /// device synced meanwhile. A failed write leaves the files as they were.
    fn write_config(
        &self,
        config: &Value,
    ) -> Result<persist::SavedUserConfig, persist::SaveFailure>;
    /// `commit` gets `next` with the shortcuts the system refused put back.
    fn with_hotkeys<T>(
        &self,
        previous: &Value,
        next: &mut Value,
        commit: impl FnOnce(&Value) -> Result<T, AppError>,
    ) -> Result<T, AppError>;
    fn with_history<T>(
        &self,
        before: HistorySettings,
        after: HistorySettings,
        commit: impl FnOnce() -> Result<T, AppError>,
    ) -> Result<T, AppError>;
    fn publish(&self, state: &AppState);
    /// Tells the windows which fields another device changed too.
    fn report_conflicts(&self, conflicts: &[String]);
}

struct AppSettingsHost<'a> {
    app: &'a AppHandle,
    secrets: &'a SecretStore,
    history: &'a storage::HistoryStorageCoordinator,
}

impl<'a> SettingsHost for AppSettingsHost<'a> {
    type Secrets = webhook::PendingHeaderSecrets<'a>;
    fn protect(&self, config: &mut Value) -> Result<Self::Secrets, AppError> {
        // the origin of a key comes from the URL as it is on this device
        let variables = storage::variable_values(self.app, config);
        webhook::protect_for_save(self.secrets, config, &variables)
    }
    fn with_disk_changes(&self, config: &Value) -> Result<Value, AppError> {
        let files = self.app.state::<persist::ConfigFiles>();
        let device = self.app.state::<storage::device::DeviceStore>();
        let plugins = self.app.state::<super::plugins::PluginStore>();
        let notes = |id: &str| plugins.notes_directory_field(id).ok();
        Ok(files.with_disk_changes(&device, &notes, config)?.value)
    }
    fn write_config(
        &self,
        config: &Value,
    ) -> Result<persist::SavedUserConfig, persist::SaveFailure> {
        let files = self.app.state::<persist::ConfigFiles>();
        let device = self.app.state::<storage::device::DeviceStore>();
        let plugins = self.app.state::<super::plugins::PluginStore>();
        let notes = |id: &str| plugins.notes_directory_field(id).ok();
        files.save(&device, &notes, config)
    }
    fn with_hotkeys<T>(
        &self,
        previous: &Value,
        next: &mut Value,
        commit: impl FnOnce(&Value) -> Result<T, AppError>,
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
    fn report_conflicts(&self, conflicts: &[String]) {
        let payload = crate::models::SettingsConflictEvent {
            paths: conflicts.to_vec(),
        };
        if let Err(error) =
            crate::events::emit::<crate::events::SettingsConflict, _>(self.app, payload)
        {
            log::warn!("Could not announce a settings conflict: {error}");
        }
    }
}

/// Resolve runtime dependencies once, at the application boundary.
pub fn save_user_config(
    app: &AppHandle,
    next: Value,
    base: Value,
) -> Result<DesktopSnapshot, AppError> {
    let state = app.state::<AppState>();
    let _vault = state.read_vault();
    save_user_config_in_vault(app, next, base)
}

/// The caller holds vault access, including when relocation owns it exclusively.
pub(crate) fn save_user_config_in_vault(
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
    schema::prune_device_references(&mut next);
    schema::validate_user_config(&next)?;
    // what another device synced comes first: the history settings, among
    // others, are committed as merged
    let mut next = host.with_disk_changes(&next)?;
    let mut pending = Some(host.protect(&mut next)?);
    let before = HistorySettings::from_config(&previous);
    let after = HistorySettings::from_config(&next);
    let mut conflicts = Vec::new();
    let snapshot = host.with_hotkeys(&previous, &mut next, |next| {
        host.with_history(before, after, || {
            let saved = match host.write_config(next) {
                Ok(saved) => saved,
                Err(failure) => {
                    // the files may hold the new references or the old ones
                    if failure.is_uncertain {
                        pending.take().expect("pending header secrets").retain();
                    }
                    return Err(failure.error);
                }
            };
            conflicts = saved.conflicts;
            // Exactly one publication, while the history repositories are locked.
            Ok(state.update_snapshot(|snapshot| {
                snapshot.settings.user_config = std::sync::Arc::new(saved.value)
            }))
        })
    })?;
    pending
        .expect("pending header secrets")
        .commit(&previous, &snapshot.settings.user_config);
    host.publish(state);
    if !conflicts.is_empty() {
        host.report_conflicts(&conflicts);
    }
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
        conflict: bool,
        fail_history: bool,
        /// What another device saved meanwhile, by JSON pointer.
        disk_changes: Vec<(&'static str, Value)>,
        conflicts: Vec<String>,
        /// The editor history retention the save committed.
        committed_retention_days: RefCell<Option<u64>>,
    }
    impl SettingsHost for Host {
        type Secrets = FakeSecrets;
        fn protect(&self, _: &mut Value) -> Result<FakeSecrets, AppError> {
            Ok(FakeSecrets)
        }
        fn with_disk_changes(&self, config: &Value) -> Result<Value, AppError> {
            let mut value = config.clone();
            for (pointer, change) in &self.disk_changes {
                *value.pointer_mut(pointer).expect("changed field") = change.clone();
            }
            Ok(value)
        }
        fn write_config(
            &self,
            config: &Value,
        ) -> Result<persist::SavedUserConfig, persist::SaveFailure> {
            self.calls.borrow_mut().push("write");
            if self.fail_save {
                return Err(AppError::Io(std::io::Error::other("Disk unavailable")).into());
            }
            let value = config.clone();
            *self.disk.borrow_mut() = value.clone();
            Ok(persist::SavedUserConfig {
                value,
                conflicts: self.conflicts.clone(),
            })
        }
        fn with_hotkeys<T>(
            &self,
            _: &Value,
            next: &mut Value,
            commit: impl FnOnce(&Value) -> Result<T, AppError>,
        ) -> Result<T, AppError> {
            if self.conflict {
                return Err(AppError::InvalidInput("Shortcut conflict".into()));
            }
            commit(next)
        }
        fn with_history<T>(
            &self,
            _: HistorySettings,
            after: HistorySettings,
            commit: impl FnOnce() -> Result<T, AppError>,
        ) -> Result<T, AppError> {
            *self.committed_retention_days.borrow_mut() = Some(after.editor.retention_days);
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
        fn report_conflicts(&self, _: &[String]) {
            self.calls.borrow_mut().push("conflicts");
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
    fn a_failed_save_neither_cleans_up_nor_publishes() {
        let state = state();
        let base = Value::clone(&state.user_config());
        let host = Host {
            fail_save: true,
            ..Host::default()
        };
        assert!(save_with(&state, &host, changed(&base), base.clone()).is_err());
        assert_eq!(state.snapshot().revision, 0);
        assert_eq!(*host.calls.borrow(), ["prepare", "write"]);
    }

    #[test]
    fn a_change_of_another_device_is_published_with_the_save() {
        let state = state();
        let base = Value::clone(&state.user_config());
        let host = Host {
            disk_changes: vec![
                ("/appearance/theme", serde_json::json!("dark")),
                ("/editor/history/retentionDays", serde_json::json!(7)),
            ],
            conflicts: vec![String::from("userConfig.appearance.theme")],
            ..Host::default()
        };
        let saved = save_with(&state, &host, changed(&base), base).unwrap();
        assert_eq!(saved.settings.user_config["appearance"]["theme"], "dark");
        assert_eq!(saved.settings.user_config["language"]["ui"], "ru-RU");
        assert_eq!(state.user_config()["appearance"]["theme"], "dark");
        // the history follows the merged settings at once
        assert_eq!(*host.committed_retention_days.borrow(), Some(7));
        assert_eq!(
            *host.calls.borrow(),
            ["prepare", "write", "cleanup", "publish", "conflicts"]
        );
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
