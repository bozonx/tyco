//! Storage owns synchronization; IPC callers never take history locks.
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};

use tauri::{AppHandle, Manager};

use super::{chat_history as chats, editor_history as editor};
use crate::errors::AppError;
use crate::models::{Chat, ChatSummary, CreateEditorHistoryRequest, EditorHistoryRecord};
use crate::state::AppState;

/// Typed history policies are parsed once at the serialized config boundary.
#[derive(Clone, Copy)]
pub struct HistorySettings {
    pub editor: editor::EditorHistoryPolicy,
    pub chat: chats::ChatHistoryPolicy,
}

impl HistorySettings {
    pub fn from_config(config: &serde_json::Value) -> Self {
        Self {
            editor: editor::EditorHistoryPolicy::from_config(config),
            chat: chats::ChatHistoryPolicy::from_config(config),
        }
    }
}

#[derive(Default)]
pub struct HistoryStorageCoordinator {
    editor_history: Mutex<Vec<EditorHistoryRecord>>,
    chat_history_lock: Mutex<()>,
    cleanup_pending: AtomicBool,
}

impl HistoryStorageCoordinator {
    fn lock_editor_history(&self) -> MutexGuard<'_, Vec<EditorHistoryRecord>> {
        self.editor_history
            .lock()
            .expect("editor history lock poisoned")
    }

    fn lock_chat_history(&self) -> MutexGuard<'_, ()> {
        self.chat_history_lock
            .lock()
            .expect("chat history lock poisoned")
    }

    /// Hold repository locks through the single config publication, then run
    /// destructive cleanup under the committed policy without rolling it back.
    pub fn commit_settings<T>(
        &self,
        app: &AppHandle,
        before: HistorySettings,
        after: HistorySettings,
        commit: impl FnOnce() -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        let mut memory = self.lock_editor_history();
        let _chats = self.lock_chat_history();
        if self.cleanup_pending.load(Ordering::SeqCst) {
            // Complete the already committed cleanup before accepting another
            // policy; turning history on must not resurrect data pending deletion.
            editor::retry_history_cleanup(app, &before.editor, before.chat)?;
            self.cleanup_pending.store(false, Ordering::SeqCst);
        }
        let result = editor::commit_history_settings(
            app,
            &before.editor,
            &after.editor,
            &mut memory,
            commit,
        )?;
        // Retry on every settings save, even if the policy itself is unchanged.
        // A previous cleanup may have failed after its config was committed.
        let chat_cleanup = chats::app_chats_dir(app)
            .and_then(|chats_dir| chats::enforce_chat_history_policy(&chats_dir, after.chat));
        self.cleanup_pending.store(
            result.is_cleanup_pending || chat_cleanup.is_err(),
            Ordering::SeqCst,
        );
        if let Err(error) = chat_cleanup {
            log::warn!("Settings committed; chat history cleanup will be retried: {error}");
        }
        Ok(result.value)
    }
    pub fn mark_cleanup_pending(&self) {
        self.cleanup_pending.store(true, Ordering::SeqCst);
    }
    /// The maintenance worker retries using current settings under the save lock.
    pub fn retry_cleanup(&self, app: &AppHandle, state: &AppState) {
        if !self.cleanup_pending.load(Ordering::SeqCst) {
            return;
        }
        let _settings = state.lock_settings_update();
        let _editor = self.lock_editor_history();
        let _chats = self.lock_chat_history();
        let policy = HistorySettings::from_config(&state.snapshot().settings.user_config);
        if editor::retry_history_cleanup(app, &policy.editor, policy.chat).is_ok() {
            self.cleanup_pending.store(false, Ordering::SeqCst);
        }
    }
}

fn with_editor<T>(
    app: &AppHandle,
    operation: impl FnOnce(&serde_json::Value, &mut Vec<EditorHistoryRecord>) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let state = app.state::<AppState>();
    let mut memory = state.history.lock_editor_history();
    operation(&state.snapshot().settings.user_config, &mut memory)
}

/// Whose chat history an operation works on: the chats of "Ask AI" or a
/// profile's own, kept in the profile folder of the AI vault.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChatScope {
    AskAi,
    Profile(String),
}

impl ChatScope {
    pub fn from_profile_id(profile_id: Option<String>) -> Self {
        profile_id.map_or(Self::AskAi, Self::Profile)
    }
}

fn scope_chats_dir(
    app: &AppHandle,
    state: &AppState,
    scope: &ChatScope,
) -> Result<std::path::PathBuf, AppError> {
    match scope {
        ChatScope::AskAi => chats::app_chats_dir(app),
        ChatScope::Profile(profile_id) => {
            let vault_root = crate::services::ai_vault::resolve_vault_path(
                app,
                &state.snapshot().settings.user_config,
            )?;
            crate::services::ai_vault::profile_chats_dir(&vault_root, profile_id)
        }
    }
}

/// Every chat history shares one lock: chat images are shared by them all.
fn with_chats<T>(
    app: &AppHandle,
    scope: &ChatScope,
    operation: impl FnOnce(&AppState, &Path) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let state = app.state::<AppState>();
    let _guard = state.history.lock_chat_history();
    let chats_dir = scope_chats_dir(app, &state, scope)?;
    operation(&state, &chats_dir)
}

/// Runs `operation` while no chat history is written, e.g. to remove a profile
/// together with its chats.
pub fn while_chats_locked<T>(
    app: &AppHandle,
    operation: impl FnOnce() -> Result<T, AppError>,
) -> Result<T, AppError> {
    let state = app.state::<AppState>();
    let _guard = state.history.lock_chat_history();
    operation()
}

pub fn read_editor_history(app: &AppHandle) -> Result<Vec<EditorHistoryRecord>, AppError> {
    with_editor(app, |config, memory| {
        editor::read_editor_history(app, config, memory)
    })
}

pub fn save_editor_history(
    app: &AppHandle,
    entry: CreateEditorHistoryRequest,
) -> Result<Option<String>, AppError> {
    with_editor(app, |config, memory| {
        editor::save_editor_history(app, config, memory, entry)
    })
}

pub fn set_editor_history_result(
    app: &AppHandle,
    id: String,
    result: String,
) -> Result<(), AppError> {
    with_editor(app, |config, memory| {
        editor::set_editor_history_result(app, config, memory, id, result)
    })
}

pub fn restore_editor_history_item(
    app: &AppHandle,
    item: EditorHistoryRecord,
) -> Result<(), AppError> {
    with_editor(app, |config, memory| {
        editor::restore_editor_history_item(app, config, memory, item)
    })
}

pub fn remove_from_editor_history(app: &AppHandle, id: String) -> Result<(), AppError> {
    with_editor(app, |config, memory| {
        editor::remove_from_editor_history(app, config, memory, id)
    })
}

pub fn clear_editor_history(app: &AppHandle) -> Result<(), AppError> {
    with_editor(app, |_, memory| editor::clear_editor_history(app, memory))
}

pub fn list_chats(app: &AppHandle, scope: &ChatScope) -> Result<Vec<ChatSummary>, AppError> {
    with_chats(app, scope, |_, chats_dir| chats::list_chats(chats_dir))
}

/// Import leases and image loading are protected against concurrent cleanup.
pub fn read_chat(
    app: &AppHandle,
    scope: &ChatScope,
    id: String,
    owner: Option<String>,
) -> Result<Option<Chat>, AppError> {
    with_chats(app, scope, |state, chats_dir| {
        chats::recover_chat_transaction(chats_dir)?;
        let chat = chats::read_chat(chats_dir, id)?;
        if let Some(chat) = &chat {
            load_chat_images(
                state,
                chats_dir,
                chat,
                ImageRetention::Active(owner.as_deref()),
            )?;
        }
        Ok(chat)
    })
}

pub fn save_chat(app: &AppHandle, scope: &ChatScope, item: Chat) -> Result<(), AppError> {
    with_chats(app, scope, |state, chats_dir| {
        let policy = chats::ChatHistoryPolicy::from_config(&state.snapshot().settings.user_config);
        chats::save_chat(chats_dir, policy, &state.chat_images, item)
    })
}

pub fn rename_chat(
    app: &AppHandle,
    scope: &ChatScope,
    id: String,
    title: String,
) -> Result<(), AppError> {
    with_chats(app, scope, |_, chats_dir| {
        chats::rename_chat(chats_dir, id, title)
    })
}

pub fn search_chats(
    app: &AppHandle,
    scope: &ChatScope,
    query: String,
) -> Result<Vec<String>, AppError> {
    // The index is a snapshot. Atomic file replacements allow searching each
    // chat without holding up unrelated saves or editor history operations.
    let (chats_dir, history) = with_chats(app, scope, |_, chats_dir| {
        Ok((chats_dir.to_path_buf(), chats::list_chats(chats_dir)?))
    })?;
    chats::search_chats(&chats_dir, history, query)
}

pub fn delete_chat(
    app: &AppHandle,
    scope: &ChatScope,
    id: String,
    owner: String,
) -> Result<(), AppError> {
    with_chats(app, scope, |state, chats_dir| {
        chats::recover_chat_transaction(chats_dir)?;
        match chats::read_chat(chats_dir, id.clone()) {
            Ok(Some(chat)) => {
                load_chat_images(state, chats_dir, &chat, ImageRetention::Undo(&owner))?;
            }
            Ok(None) => {}
            Err(error) => log::warn!("Removing chat {id}, which cannot be read: {error}"),
        }
        chats::delete_chat(chats_dir, id)
    })
}

pub fn clear_chats(app: &AppHandle, scope: &ChatScope) -> Result<(), AppError> {
    with_chats(app, scope, |_, chats_dir| chats::clear_chats(chats_dir))
}

enum ImageRetention<'a> {
    Active(Option<&'a str>),
    Undo(&'a str),
}

fn load_chat_images(
    state: &AppState,
    chats_dir: &Path,
    chat: &Chat,
    retention: ImageRetention<'_>,
) -> Result<(), AppError> {
    let directory = chats::chat_image_directory(chats_dir);
    let mut images = state.chat_images.lock().expect("chat image lock poisoned");
    for image in chat.messages.iter().flat_map(|message| &message.images) {
        match retention {
            ImageRetention::Active(Some(owner)) => images.hold(owner, &image.id),
            ImageRetention::Active(None) => {}
            ImageRetention::Undo(owner) => images.hold_undo(owner, &image.id),
        }
        let result = images.get(&directory, &image.id);
        if let ImageRetention::Undo(_) = retention {
            if let Err(error) = result {
                log::warn!("Could not preserve chat image for undo: {error}");
            }
        }
    }
    Ok(())
}

pub fn read_chat_image(app: &AppHandle, scope: &ChatScope, id: &str) -> Result<Vec<u8>, AppError> {
    with_chats(app, scope, |state, chats_dir| {
        state
            .chat_images
            .lock()
            .expect("chat image lock poisoned")
            .get(&chats::chat_image_directory(chats_dir), id)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_operations_do_not_lock_editor_history() {
        let storage = HistoryStorageCoordinator::default();
        let _chats = storage.lock_chat_history();
        assert!(storage.editor_history.try_lock().is_ok());
    }

    #[test]
    fn editor_operations_do_not_lock_chat_history() {
        let storage = HistoryStorageCoordinator::default();
        let _editor = storage.lock_editor_history();
        assert!(storage.chat_history_lock.try_lock().is_ok());
    }

    #[test]
    fn concurrent_editor_updates_are_serialized() {
        let storage = HistoryStorageCoordinator::default();
        std::thread::scope(|scope| {
            for index in 0..16 {
                let storage = &storage;
                scope.spawn(move || {
                    storage.lock_editor_history().push(EditorHistoryRecord {
                        id: index.to_string(),
                        text: String::new(),
                        kind: crate::models::EditorHistoryKind::Draft,
                        operation: None,
                        created_at_ms: 1,
                        result: None,
                        is_result_applied: false,
                    });
                });
            }
        });
        assert_eq!(storage.lock_editor_history().len(), 16);
    }
}
