//! Storage owns synchronization; IPC callers never take history locks.
use crate::locks::MutexExt;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};

use tauri::{AppHandle, Manager};

use super::{chat_history as chats, editor_history as editor};
use crate::errors::AppError;
use crate::models::{Chat, ChatSummary, EditorHistoryEntry, EditorHistoryItem};
use crate::services::chat_images::ChatImages;
use crate::state::AppState;

/// Typed history policies are parsed once at the serialized config boundary.
#[derive(Clone)]
pub struct HistorySettings {
    pub editor: editor::EditorHistoryPolicy,
    pub chat: chats::ChatHistoryPolicy,
    pub profile_chat: chats::ChatHistoryPolicy,
    pub vault_path: String,
}

impl HistorySettings {
    pub fn from_config(config: &serde_json::Value) -> Self {
        Self {
            editor: editor::EditorHistoryPolicy::from_config(config),
            chat: chats::ChatHistoryPolicy::from_config(config),
            profile_chat: chats::ChatHistoryPolicy::for_profiles(config),
            vault_path: crate::models::user_config::ai_vault(config).path,
        }
    }
}

#[derive(Default)]
pub struct HistoryStorageCoordinator {
    editor_history: Mutex<Vec<EditorHistoryItem>>,
    chat_history_lock: Mutex<()>,
    chat_search: chats::ChatSearchCache,
    cleanup_pending: AtomicBool,
}

impl HistoryStorageCoordinator {
    fn lock_editor_history(&self) -> MutexGuard<'_, Vec<EditorHistoryItem>> {
        self.editor_history.locked()
    }

    fn lock_chat_history(&self) -> MutexGuard<'_, ()> {
        self.chat_history_lock.locked()
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
            enforce_history_policies(app, &before)?;
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
        let chat_cleanup = enforce_chat_history_policies(app, &after);
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
        let _vault = state.read_vault();
        let _settings = state.lock_settings_update();
        let _editor = self.lock_editor_history();
        let _chats = self.lock_chat_history();
        let policy = HistorySettings::from_config(&state.user_config());
        if enforce_history_policies(app, &policy).is_ok() {
            self.cleanup_pending.store(false, Ordering::SeqCst);
        }
    }
}

/// Applies the history settings of the config the app starts with. The
/// caller marks a failed cleanup as pending, see `mark_cleanup_pending`.
pub fn apply_history_settings_on_startup(
    app: &AppHandle,
    user_config: &serde_json::Value,
) -> Result<(), AppError> {
    enforce_history_policies(app, &HistorySettings::from_config(user_config))
}

/// Deletes what the policies no longer keep, from the editor history file and
/// from every chat history.
fn enforce_history_policies(app: &AppHandle, settings: &HistorySettings) -> Result<(), AppError> {
    editor::enforce_editor_history_policy(app, &settings.editor)?;
    enforce_chat_history_policies(app, settings)
}

/// Brings the chats of "Ask AI" and of every profile in line with their
/// settings. Each history is tried; the first failure is returned.
fn enforce_chat_history_policies(
    app: &AppHandle,
    settings: &HistorySettings,
) -> Result<(), AppError> {
    let ask_ai = chats::app_chats_dir(app)
        .and_then(|chats_dir| chats::enforce_chat_history_policy(&chats_dir, settings.chat));
    // an unavailable vault has no chats to clean up now; they are trimmed once
    // a profile chat is saved there again
    let profiles = match crate::services::ai_vault::resolve_vault_path_from_config(
        Some(&settings.vault_path),
        || crate::services::storage::app_data_sub_dir(app, "ai-vault"),
    ) {
        Ok(vault_root) => enforce_profile_chat_history_policy(&vault_root, settings.profile_chat),
        Err(error) => {
            log::warn!("Skipping the profile chat cleanup: {error}");
            Ok(())
        }
    };
    ask_ai.and(profiles)
}

/// Applies the policy all profiles share to the chats of each of them.
fn enforce_profile_chat_history_policy(
    vault_root: &Path,
    policy: chats::ChatHistoryPolicy,
) -> Result<(), AppError> {
    if !policy.is_enabled {
        return Ok(());
    }
    let mut result = Ok(());
    for chats_dir in crate::services::ai_vault::all_profile_chats_dirs(vault_root)? {
        if let Err(error) = chats::enforce_chat_history_policy(&chats_dir, policy) {
            log::warn!(
                "Could not clean up the chats in {}: {error}",
                chats_dir.display()
            );
            result = result.and(Err(error));
        }
    }
    result
}

fn with_editor<T>(
    app: &AppHandle,
    operation: impl FnOnce(&serde_json::Value, &mut Vec<EditorHistoryItem>) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let state = app.state::<AppState>();
    let mut memory = state.history.lock_editor_history();
    operation(&state.user_config(), &mut memory)
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
            let vault_root =
                crate::services::ai_vault::resolve_vault_path(app, &state.user_config())?;
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
    let _vault = state.read_vault();
    with_chats_in_vault(app, scope, operation)
}

fn with_chats_in_vault<T>(
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
pub fn while_chats_locked_in_vault<T>(
    app: &AppHandle,
    operation: impl FnOnce() -> Result<T, AppError>,
) -> Result<T, AppError> {
    let state = app.state::<AppState>();
    let _guard = state.history.lock_chat_history();
    operation()
}

pub fn read_editor_history(app: &AppHandle) -> Result<Vec<EditorHistoryItem>, AppError> {
    with_editor(app, |config, memory| {
        editor::read_editor_history(app, config, memory)
    })
}

pub fn add_editor_history_item(
    app: &AppHandle,
    entry: EditorHistoryEntry,
) -> Result<Option<String>, AppError> {
    with_editor(app, |config, memory| {
        editor::add_editor_history_item(app, config, memory, entry)
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
    item: EditorHistoryItem,
) -> Result<(), AppError> {
    with_editor(app, |config, memory| {
        editor::restore_editor_history_item(app, config, memory, item)
    })
}

pub fn delete_editor_history_item(app: &AppHandle, id: String) -> Result<(), AppError> {
    with_editor(app, |config, memory| {
        editor::delete_editor_history_item(app, config, memory, id)
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
    with_chats(app, scope, |_, chats_dir| {
        chats::recover_chat_transaction(chats_dir)?;
        let chat = chats::open_chat(chats_dir, id)?;
        if let Some(chat) = &chat {
            load_chat_images(
                &app.state::<ChatImages>(),
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
        let config = state.user_config();
        let policy = match scope {
            ChatScope::AskAi => chats::ChatHistoryPolicy::from_config(&config),
            ChatScope::Profile(_) => chats::ChatHistoryPolicy::for_profiles(&config),
        };
        chats::save_chat(chats_dir, policy, app.state::<ChatImages>().store(), item)
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
    let state = app.state::<AppState>();
    let _vault = state.read_vault();
    let (chats_dir, history) = with_chats_in_vault(app, scope, |_, chats_dir| {
        Ok((chats_dir.to_path_buf(), chats::list_chats(chats_dir)?))
    })?;
    chats::search_chats(&chats_dir, history, query, &state.history.chat_search)
}

pub fn delete_chat(
    app: &AppHandle,
    scope: &ChatScope,
    id: String,
    owner: String,
) -> Result<(), AppError> {
    with_chats(app, scope, |_, chats_dir| {
        chats::recover_chat_transaction(chats_dir)?;
        match chats::read_chat(chats_dir, id.clone()) {
            Ok(Some(chat)) => {
                load_chat_images(
                    &app.state::<ChatImages>(),
                    chats_dir,
                    &chat,
                    ImageRetention::Undo(&owner),
                )?;
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
    images: &ChatImages,
    chats_dir: &Path,
    chat: &Chat,
    retention: ImageRetention<'_>,
) -> Result<(), AppError> {
    let directory = chats::chat_image_directory(chats_dir);
    let mut images = images.lock();
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
    with_chats(app, scope, |_, chats_dir| {
        app.state::<ChatImages>()
            .lock()
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
                    storage.lock_editor_history().push(EditorHistoryItem {
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
