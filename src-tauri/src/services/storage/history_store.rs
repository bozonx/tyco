//! Storage owns synchronization; IPC callers never take history locks.
use crate::locks::MutexExt;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use tauri::{AppHandle, Manager};

use super::{chat_history as chats, editor_history as editor};
use crate::errors::AppError;
use crate::models::{Chat, ChatSummary, EditorHistoryEntry, EditorHistoryItem};
use crate::services::chat_images::ChatImages;
use crate::state::AppState;

/// Typed history policies are parsed once at the serialized config boundary.
#[derive(Clone, PartialEq)]
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
    /// The editor history file still holds what the committed policy drops.
    editor_cleanup_pending: AtomicBool,
    /// Some chat history still holds what the committed policies drop.
    chat_cleanup_pending: AtomicBool,
}

impl HistoryStorageCoordinator {
    pub(crate) fn invalidate_chat_search(&self, path: &Path) {
        let _chats = self.lock_chat_history();
        self.chat_search.invalidate(path);
    }

    fn lock_editor_history(&self) -> MutexGuard<'_, Vec<EditorHistoryItem>> {
        self.editor_history.locked()
    }

    fn lock_chat_history(&self) -> MutexGuard<'_, ()> {
        self.chat_history_lock.locked()
    }

    /// Hold repository locks through the single config publication, then run
    /// destructive cleanup under the committed policy without rolling it back.
    ///
    /// A cleanup that keeps failing never blocks a save of other settings:
    /// only a change of the editor history settings waits for the editor
    /// cleanup still pending, so that a looser policy cannot bring back what
    /// the committed one deletes. Chat cleanups simply run under the new
    /// policies, which decide what stays.
    pub fn commit_settings<T>(
        &self,
        app: &AppHandle,
        before: HistorySettings,
        after: HistorySettings,
        commit: impl FnOnce() -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        let mut memory = self.lock_editor_history();
        let _chats = self.lock_chat_history();
        if self.editor_cleanup_pending.load(Ordering::SeqCst) {
            match editor::enforce_editor_history_policy(app, &before.editor) {
                Ok(()) => self.editor_cleanup_pending.store(false, Ordering::SeqCst),
                Err(error) if before.editor != after.editor => return Err(error),
                Err(error) => log::warn!("Editor history cleanup is still pending: {error}"),
            }
        }
        let result = editor::commit_history_settings(
            app,
            &before.editor,
            &after.editor,
            &mut memory,
            commit,
        )?;
        if result.is_cleanup_pending {
            self.editor_cleanup_pending.store(true, Ordering::SeqCst);
        }
        if before.editor != after.editor {
            notify_editor_history_changed(app);
        }
        let chat_settings_changed = before.chat != after.chat
            || before.profile_chat != after.profile_chat
            || before.vault_path != after.vault_path;
        if chat_settings_changed || self.chat_cleanup_pending.load(Ordering::SeqCst) {
            let chat_cleanup = enforce_chat_history_policies(app, &after);
            self.chat_cleanup_pending
                .store(chat_cleanup.is_err(), Ordering::SeqCst);
            if let Err(error) = chat_cleanup {
                log::warn!("Settings committed; chat history cleanup will be retried: {error}");
            }
        }
        Ok(result.value)
    }

    /// Runs `operation` while no history is read or written, e.g. to move the
    /// user data folder.
    pub fn while_locked<T>(&self, operation: impl FnOnce() -> T) -> T {
        let _editor = self.lock_editor_history();
        let _chats = self.lock_chat_history();
        operation()
    }

    /// The editor history file may hold what the policy drops, e.g. after a
    /// failed cleanup at startup.
    pub fn mark_editor_cleanup_pending(&self) {
        self.editor_cleanup_pending.store(true, Ordering::SeqCst);
    }

    /// The chat histories are brought in line with the policies in the
    /// background, e.g. at startup, without holding up the first window.
    pub fn mark_chat_cleanup_pending(&self) {
        self.chat_cleanup_pending.store(true, Ordering::SeqCst);
    }

    fn is_cleanup_pending(&self) -> bool {
        self.editor_cleanup_pending.load(Ordering::SeqCst)
            || self.chat_cleanup_pending.load(Ordering::SeqCst)
    }

    /// The maintenance worker retries using current settings under the save
    /// lock. Returns `None` when nothing was pending; a failure is logged.
    fn retry_cleanup(&self, app: &AppHandle, state: &AppState) -> Option<Result<(), AppError>> {
        if !self.is_cleanup_pending() {
            return None;
        }
        let _vault = state.read_vault();
        let _settings = state.lock_settings_update();
        let _editor = self.lock_editor_history();
        let _chats = self.lock_chat_history();
        let policy = HistorySettings::from_config(&state.user_config());
        let mut result = Ok(());
        if self.editor_cleanup_pending.load(Ordering::SeqCst) {
            match editor::enforce_editor_history_policy(app, &policy.editor) {
                Ok(()) => {
                    self.editor_cleanup_pending.store(false, Ordering::SeqCst);
                    notify_editor_history_changed(app);
                }
                Err(error) => {
                    log::warn!("Editor history cleanup failed; it will be retried: {error}");
                    result = Err(error);
                }
            }
        }
        if self.chat_cleanup_pending.load(Ordering::SeqCst) {
            match enforce_chat_history_policies(app, &policy) {
                Ok(()) => self.chat_cleanup_pending.store(false, Ordering::SeqCst),
                Err(error) => {
                    log::warn!("Chat history cleanup failed; it will be retried: {error}");
                    result = result.and(Err(error));
                }
            }
        }
        Some(result)
    }
}

/// How soon a pending history cleanup is first tried, and how long the wait
/// between failed tries grows to.
const CLEANUP_RETRY_MIN_INTERVAL: Duration = Duration::from_secs(1);
const CLEANUP_RETRY_MAX_INTERVAL: Duration = Duration::from_secs(5 * 60);

/// The wait before the next try: the shortest after a success or while
/// nothing is pending, twice the last one after a failure.
fn next_cleanup_retry_interval(current: Duration, outcome: Option<bool>) -> Duration {
    match outcome {
        Some(false) => (current * 2).min(CLEANUP_RETRY_MAX_INTERVAL),
        _ => CLEANUP_RETRY_MIN_INTERVAL,
    }
}

/// Runs a pending history cleanup in the background, see `retry_cleanup`.
pub fn spawn_cleanup_retry(app: AppHandle) -> Result<(), AppError> {
    let services = app.state::<crate::services::background::BackgroundServices>();
    let handle = app.clone();
    services.spawn_async(async move {
        let app = handle;
        let mut interval = CLEANUP_RETRY_MIN_INTERVAL;
        loop {
            tokio::time::sleep(interval).await;
            if !app.state::<AppState>().history.is_cleanup_pending() {
                interval = CLEANUP_RETRY_MIN_INTERVAL;
                continue;
            }
            let worker_app = app.clone();
            let outcome = app
                .state::<crate::services::background::BackgroundServices>()
                .run_blocking(move || {
                    let state = worker_app.state::<AppState>();
                    state.history.retry_cleanup(&worker_app, &state)
                })
                .await
                .ok()
                .flatten()
                .map(|result| result.is_ok());
            interval = next_cleanup_retry_interval(interval, outcome);
        }
    })
}

/// Applies the editor history settings of the config the app starts with:
/// one file, read before the first window can show it. The chats, which may
/// be many, are left to the background worker, see `mark_chat_cleanup_pending`.
/// The caller marks a failure as pending, see `mark_editor_cleanup_pending`.
pub fn apply_editor_history_settings_on_startup(
    app: &AppHandle,
    user_config: &serde_json::Value,
) -> Result<(), AppError> {
    editor::enforce_editor_history_policy(app, &HistorySettings::from_config(user_config).editor)
}

/// Brings the chats of "Ask AI" and of every profile in line with their
/// settings. Each history is tried; the first failure is returned.
fn enforce_chat_history_policies(
    app: &AppHandle,
    settings: &HistorySettings,
) -> Result<(), AppError> {
    super::user_data::user_dir(app)?;
    let ask_ai = chats::app_chat_dirs(app)
        .and_then(|dirs| chats::enforce_chat_history_policy(&dirs, settings.chat))
        .map(|removed| notify_chats_removed(app, &ChatScope::AskAi, removed));
    // an unavailable vault has no chats to clean up now; they are trimmed once
    // a profile chat is saved there again
    let user_dir = super::user_data::user_dir_for(app, super::UserDirAccess::Read).ok();
    let profiles = match crate::services::ai_vault::open_vault(
        Some(&settings.vault_path),
        user_dir.as_deref(),
        || crate::services::storage::user_sub_dir(app, crate::services::ai_vault::VAULT_DIR_NAME),
    ) {
        Ok(vault) => enforce_profile_chat_history_policy(app, &vault.root, settings.profile_chat),
        Err(error) => {
            log::warn!("Skipping the profile chat cleanup: {error}");
            Ok(())
        }
    };
    ask_ai.and(profiles)
}

/// Applies the policy all profiles share to the chats of each of them.
fn enforce_profile_chat_history_policy(
    app: &AppHandle,
    vault_root: &Path,
    policy: chats::ChatHistoryPolicy,
) -> Result<(), AppError> {
    let mut result = Ok(());
    for chats_dir in crate::services::ai_vault::all_profile_chats_dirs(vault_root)? {
        // the profile folder is named by the profile id
        let Some(profile_id) = chats_dir
            .parent()
            .and_then(Path::file_name)
            .and_then(|name| name.to_str())
            .map(str::to_owned)
        else {
            continue;
        };
        let dirs = chats::profile_chat_dirs(app, vault_root, &profile_id, chats_dir.clone())?;
        match chats::enforce_chat_history_policy(&dirs, policy) {
            Ok(removed) => {
                notify_chats_removed(app, &ChatScope::Profile(profile_id), removed);
            }
            Err(error) => {
                log::warn!(
                    "Could not clean up the chats in {}: {error}",
                    chats_dir.display()
                );
                result = result.and(Err(error));
            }
        }
    }
    result
}

/// Tells every window that a chat history changed. A lost event leaves a list
/// stale until it is read again, so a failure is only logged.
fn notify_chats_changed(
    app: &AppHandle,
    scope: &ChatScope,
    removed_chat_ids: Vec<String>,
    is_cleared: bool,
) {
    let payload = crate::models::ChatsChangedEvent {
        profile_id: match scope {
            ChatScope::AskAi => None,
            ChatScope::Profile(id) => Some(id.clone()),
        },
        removed_chat_ids,
        is_cleared,
    };
    if let Err(error) = crate::events::emit::<crate::events::ChatsChanged, _>(app, payload) {
        log::warn!("Could not announce a chat history change: {error}");
    }
}

/// Tells every window that the editor history changed; a failure is only
/// logged, as for the chats.
fn notify_editor_history_changed(app: &AppHandle) {
    if let Err(error) = crate::events::emit::<crate::events::EditorHistoryChanged, _>(app, ()) {
        log::warn!("Could not announce an editor history change: {error}");
    }
}

fn notify_chats_removed(app: &AppHandle, scope: &ChatScope, removed: Vec<String>) {
    if !removed.is_empty() {
        notify_chats_changed(app, scope, removed, false);
    }
}

fn with_editor<T>(
    app: &AppHandle,
    operation: impl FnOnce(&serde_json::Value, &mut Vec<EditorHistoryItem>) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let state = app.state::<AppState>();
    let mut memory = state.history.lock_editor_history();
    operation(&state.user_config(), &mut memory)
}

/// Changes the editor history and tells every window about it.
fn change_editor<T>(
    app: &AppHandle,
    operation: impl FnOnce(&serde_json::Value, &mut Vec<EditorHistoryItem>) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let value = with_editor(app, operation)?;
    notify_editor_history_changed(app);
    Ok(value)
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

/// Whether an operation only reads a chat history: then a profile folder
/// without chats is not created.
#[derive(Clone, Copy, PartialEq, Eq)]
enum ChatAccess {
    Read,
    Write,
}

fn scope_chat_dirs(
    app: &AppHandle,
    state: &AppState,
    scope: &ChatScope,
    access: ChatAccess,
) -> Result<chats::ChatDirs, AppError> {
    match scope {
        ChatScope::AskAi => chats::app_chat_dirs(app),
        ChatScope::Profile(profile_id) => {
            let vault_root =
                crate::services::ai_vault::resolve_vault_path(app, &state.user_config())?;
            let chats_dir = match access {
                ChatAccess::Read => {
                    crate::services::ai_vault::existing_profile_chats_path(&vault_root, profile_id)
                }
                ChatAccess::Write => {
                    crate::services::ai_vault::profile_chats_dir(&vault_root, profile_id)
                }
            }?;
            chats::profile_chat_dirs(app, &vault_root, profile_id, chats_dir)
        }
    }
}

/// Every chat history shares one lock: chat images are shared by them all.
fn with_chats<T>(
    app: &AppHandle,
    scope: &ChatScope,
    access: ChatAccess,
    operation: impl FnOnce(&AppState, &chats::ChatDirs) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let state = app.state::<AppState>();
    let _vault = state.read_vault();
    with_chats_in_vault(app, scope, access, operation)
}

fn with_chats_in_vault<T>(
    app: &AppHandle,
    scope: &ChatScope,
    access: ChatAccess,
    operation: impl FnOnce(&AppState, &chats::ChatDirs) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let state = app.state::<AppState>();
    let _guard = state.history.lock_chat_history();
    let dirs = scope_chat_dirs(app, &state, scope, access)?;
    if access == ChatAccess::Write {
        super::user_data::ensure_write_allowed(&dirs.chats)?;
    }
    operation(&state, &dirs)
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
    change_editor(app, |config, memory| {
        editor::add_editor_history_item(app, config, memory, entry)
    })
}

pub fn set_editor_history_result(
    app: &AppHandle,
    id: String,
    result: String,
) -> Result<(), AppError> {
    change_editor(app, |config, memory| {
        editor::set_editor_history_result(app, config, memory, id, result)
    })
}

pub fn restore_editor_history_item(
    app: &AppHandle,
    item: EditorHistoryItem,
) -> Result<(), AppError> {
    change_editor(app, |config, memory| {
        editor::restore_editor_history_item(app, config, memory, item)
    })
}

pub fn delete_editor_history_item(app: &AppHandle, id: String) -> Result<(), AppError> {
    change_editor(app, |config, memory| {
        editor::delete_editor_history_item(app, config, memory, id)
    })
}

pub fn clear_editor_history(app: &AppHandle) -> Result<(), AppError> {
    change_editor(app, |config, memory| {
        editor::clear_editor_history(app, config, memory)
    })
}

pub fn list_chats(app: &AppHandle, scope: &ChatScope) -> Result<Vec<ChatSummary>, AppError> {
    with_chats(app, scope, ChatAccess::Read, |_, dirs| {
        chats::list_chats(dirs)
    })
}

/// Import leases and image loading are protected against concurrent cleanup.
pub fn read_chat(
    app: &AppHandle,
    scope: &ChatScope,
    id: String,
    owner: Option<String>,
) -> Result<Option<Chat>, AppError> {
    with_chats(app, scope, ChatAccess::Read, |_, dirs| {
        let chat = chats::open_chat(dirs, id)?;
        // without an import lease nothing holds the images: they are read
        // when shown, e.g. not at all for a Markdown copy
        if let (Some(chat), Some(_)) = (&chat, &owner) {
            load_chat_images(
                &app.state::<ChatImages>(),
                &dirs.chats,
                chat,
                ImageRetention::Active(owner.as_deref()),
            )?;
        }
        Ok(chat)
    })
}

pub fn save_chat(app: &AppHandle, scope: &ChatScope, item: Chat) -> Result<(), AppError> {
    let removed = with_chats(app, scope, ChatAccess::Write, |state, dirs| {
        let config = state.user_config();
        let policy = match scope {
            ChatScope::AskAi => chats::ChatHistoryPolicy::from_config(&config),
            ChatScope::Profile(_) => chats::ChatHistoryPolicy::for_profiles(&config),
        };
        if !policy.is_enabled {
            return Ok(None);
        }
        chats::save_chat(dirs, policy, app.state::<ChatImages>().store(), item).map(Some)
    })?;
    if let Some(removed) = removed {
        notify_chats_changed(app, scope, removed, false);
    }
    Ok(())
}

pub fn rename_chat(
    app: &AppHandle,
    scope: &ChatScope,
    id: String,
    title: String,
) -> Result<(), AppError> {
    with_chats(app, scope, ChatAccess::Write, |_, dirs| {
        chats::rename_chat(dirs, id, title)
    })?;
    notify_chats_changed(app, scope, Vec::new(), false);
    Ok(())
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
    let (chats_dir, history) = with_chats_in_vault(app, scope, ChatAccess::Read, |_, dirs| {
        Ok((dirs.chats.clone(), chats::list_chats(dirs)?))
    })?;
    chats::search_chats(&chats_dir, history, query, &state.history.chat_search)
}

pub fn delete_chat(
    app: &AppHandle,
    scope: &ChatScope,
    id: String,
    owner: String,
) -> Result<Option<Chat>, AppError> {
    let id_for_event = id.clone();
    with_chats(app, scope, ChatAccess::Write, |_, dirs| {
        let removed = match chats::read_chat(&dirs.chats, id.clone()) {
            Ok(Some(chat)) => {
                load_chat_images(
                    &app.state::<ChatImages>(),
                    &dirs.chats,
                    &chat,
                    ImageRetention::Undo(&owner),
                )?;
                Some(chat)
            }
            Ok(None) => None,
            Err(error) => {
                log::warn!("Removing chat {id}, which cannot be read: {error}");
                None
            }
        };
        chats::delete_chat(dirs, id.clone())?;
        Ok(removed)
    })
    .inspect(|_| notify_chats_changed(app, scope, vec![id_for_event], false))
}

pub fn clear_chats(app: &AppHandle, scope: &ChatScope) -> Result<(), AppError> {
    with_chats(app, scope, ChatAccess::Write, |_, dirs| {
        chats::clear_chats(dirs)
    })?;
    notify_chats_changed(app, scope, Vec::new(), true);
    Ok(())
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
        // the chat still opens: a missing image shows as one that failed
        if let Err(error) = images.get(&directory, &image.id) {
            match retention {
                ImageRetention::Undo(_) => {
                    log::warn!(
                        "Could not preserve chat image {} for undo: {error}",
                        image.id
                    )
                }
                ImageRetention::Active(_) => {
                    log::warn!("Could not load chat image {}: {error}", image.id)
                }
            }
        }
    }
    Ok(())
}

pub fn read_chat_image(app: &AppHandle, scope: &ChatScope, id: &str) -> Result<Vec<u8>, AppError> {
    with_chats(app, scope, ChatAccess::Read, |_, dirs| {
        app.state::<ChatImages>().lock().get(&dirs.images(), id)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_failing_cleanup_waits_longer_each_time_up_to_a_limit() {
        let mut interval = CLEANUP_RETRY_MIN_INTERVAL;
        for _ in 0..20 {
            interval = next_cleanup_retry_interval(interval, Some(false));
        }
        assert_eq!(interval, CLEANUP_RETRY_MAX_INTERVAL);
        assert_eq!(
            next_cleanup_retry_interval(interval, Some(true)),
            CLEANUP_RETRY_MIN_INTERVAL
        );
        assert_eq!(
            next_cleanup_retry_interval(interval, None),
            CLEANUP_RETRY_MIN_INTERVAL
        );
        assert_eq!(
            next_cleanup_retry_interval(CLEANUP_RETRY_MIN_INTERVAL, Some(false)),
            CLEANUP_RETRY_MIN_INTERVAL * 2
        );
    }

    #[test]
    fn pending_cleanups_are_tracked_apart() {
        let storage = HistoryStorageCoordinator::default();
        assert!(!storage.is_cleanup_pending());
        storage.mark_chat_cleanup_pending();
        assert!(storage.is_cleanup_pending());
        assert!(!storage.editor_cleanup_pending.load(Ordering::SeqCst));
    }

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
