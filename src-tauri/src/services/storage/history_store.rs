//! Storage owns synchronization; IPC callers never take history locks.
use crate::locks::MutexExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use tauri::{AppHandle, Manager};

use super::session_files::SessionFiles;
use super::session_history::{self as session, SessionChats, SessionDialogs};
use super::{chat_history as chats, dialog_history as dialogs, editor_history as editor};
use crate::errors::AppError;
use crate::models::{
    Chat, ChatSummary, Dialog, DialogSummary, EditorHistoryEntry, EditorHistoryFailure,
    EditorHistoryItem,
};
use crate::services::chat_images::ChatImages;
use crate::state::AppState;

/// Typed history policies are parsed once at the serialized config boundary.
#[derive(Clone, PartialEq)]
pub struct HistorySettings {
    pub editor: editor::EditorHistoryPolicy,
    pub dialog: dialogs::DialogHistoryPolicy,
    pub chat: chats::ChatHistoryPolicy,
}

impl HistorySettings {
    pub fn from_config(config: &serde_json::Value) -> Self {
        Self {
            editor: editor::EditorHistoryPolicy::from_config(config),
            dialog: dialogs::DialogHistoryPolicy::from_config(config),
            chat: chats::ChatHistoryPolicy::from_config(config),
        }
    }
}

#[derive(Default)]
pub struct HistoryStorageCoordinator {
    editor_history: Mutex<Vec<EditorHistoryItem>>,
    dialog_history_lock: Mutex<()>,
    dialog_search: dialogs::DialogSearchCache,
    chat_history_lock: Mutex<()>,
    chat_search: chats::ChatSearchCache,
    /// The chats of the scopes kept in memory only, by scope key.
    session_chats: Mutex<SessionChats>,
    /// The dialogs kept in memory only.
    session_dialogs: Mutex<SessionDialogs>,
    /// The editor history file still holds what the committed policy drops.
    editor_cleanup_pending: AtomicBool,
    /// The dialog history still holds what the committed policy drops.
    dialog_cleanup_pending: AtomicBool,
    /// Some chat history still holds what the committed policies drop.
    chat_cleanup_pending: AtomicBool,
}

impl HistoryStorageCoordinator {
    pub(crate) fn invalidate_chat_search(&self, path: &Path) {
        let _chats = self.lock_chat_history();
        self.chat_search.invalidate(path);
    }

    pub(crate) fn invalidate_dialog_search(&self, path: &Path) {
        let _dialogs = self.lock_dialog_history();
        self.dialog_search.invalidate(path);
    }

    fn lock_editor_history(&self) -> MutexGuard<'_, Vec<EditorHistoryItem>> {
        self.editor_history.locked()
    }

    fn lock_dialog_history(&self) -> MutexGuard<'_, ()> {
        self.dialog_history_lock.locked()
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
        let _dialogs = self.lock_dialog_history();
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
        let dialog_settings_changed = before.dialog != after.dialog;
        if dialog_settings_changed || self.dialog_cleanup_pending.load(Ordering::SeqCst) {
            let dialog_cleanup = enforce_dialog_history_policy(app, after.dialog);
            self.dialog_cleanup_pending
                .store(dialog_cleanup.is_err(), Ordering::SeqCst);
            if let Err(error) = dialog_cleanup {
                log::warn!("Settings committed; dialog history cleanup will be retried: {error}");
            }
        }
        let chat_settings_changed = before.chat != after.chat;
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
        let _dialogs = self.lock_dialog_history();
        let _chats = self.lock_chat_history();
        operation()
    }

    /// The editor history file may hold what the policy drops, e.g. after a
    /// failed cleanup at startup.
    pub fn mark_editor_cleanup_pending(&self) {
        self.editor_cleanup_pending.store(true, Ordering::SeqCst);
    }

    /// The dialog history is brought in line with its policy in the background.
    pub fn mark_dialog_cleanup_pending(&self) {
        self.dialog_cleanup_pending.store(true, Ordering::SeqCst);
    }

    /// The chat histories are brought in line with the policies in the
    /// background, e.g. at startup, without holding up the first window.
    pub fn mark_chat_cleanup_pending(&self) {
        self.chat_cleanup_pending.store(true, Ordering::SeqCst);
    }

    fn is_cleanup_pending(&self) -> bool {
        self.editor_cleanup_pending.load(Ordering::SeqCst)
            || self.dialog_cleanup_pending.load(Ordering::SeqCst)
            || self.chat_cleanup_pending.load(Ordering::SeqCst)
    }

    /// The maintenance worker retries using current settings under the save
    /// lock. Returns `None` when nothing was pending; a failure is logged.
    fn retry_cleanup(&self, app: &AppHandle, state: &AppState) -> Option<Result<(), AppError>> {
        if !self.is_cleanup_pending() {
            return None;
        }
        let _workspace = state.read_workspace();
        let _settings = state.lock_settings_update();
        let _editor = self.lock_editor_history();
        let _dialogs = self.lock_dialog_history();
        let _chats = self.lock_chat_history();
        let config = state.user_config();
        let policy = HistorySettings::from_config(&config);
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
        if self.dialog_cleanup_pending.load(Ordering::SeqCst) {
            match enforce_dialog_history_policy(app, policy.dialog) {
                Ok(()) => self.dialog_cleanup_pending.store(false, Ordering::SeqCst),
                Err(error) => {
                    log::warn!("Dialog history cleanup failed; it will be retried: {error}");
                    result = result.and(Err(error));
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
    // what the session of a run that crashed left goes
    clear_session_files(app);
    // no recording runs yet: what a previous run left joins the history first
    if let Err(error) = super::recordings::RecordingDirs::of_app(app)
        .and_then(|dirs| super::recordings::settle_leftovers(&dirs))
    {
        log::warn!("Call recordings of a previous run wait for the next start: {error}");
    }
    editor::enforce_editor_history_policy(app, &HistorySettings::from_config(user_config).editor)
}

/// Brings the chats of "Ask AI" and of every profile in line with their
/// settings. Each history is tried; the first failure is returned.
fn enforce_chat_history_policies(
    app: &AppHandle,
    settings: &HistorySettings,
) -> Result<(), AppError> {
    super::user_data::user_dir(app)?;
    let stored = store_session_chats(app);
    let ask_ai = chats::app_chat_dirs(app)
        .and_then(|dirs| chats::enforce_chat_history_policy(&dirs, settings.chat))
        .map(|removed| notify_chats_removed(app, &ChatScope::AskAi, removed));
    // an unavailable workspace has no chats to clean up now; they are trimmed once
    // a profile chat is saved there again
    let mut profiles = Ok(());
    for (workspace_ref, workspace) in crate::services::ai_workspace::connected_workspaces(app) {
        let policy = chats::ChatHistoryPolicy::for_workspace(
            &crate::services::ai_workspace::settings::read_chat_history(&workspace.root),
        );
        profiles = profiles.and(enforce_profile_chat_history_policy(
            app,
            &workspace_ref,
            &workspace,
            policy,
        ));
    }
    stored.and(ask_ai).and(profiles)
}

/// Hands the session chats of the profile `from`, a reference `[workspaceId:]id`,
/// to `to` when the profile moves, or drops them when it is deleted: they
/// must not bring back the folder of a profile that is gone.
pub fn move_session_chats(app: &AppHandle, from: &str, to: Option<&str>) {
    let state = app.state::<AppState>();
    let mut session = state.history.session_chats.locked();
    session.rekey(from, to);
    prune_session_files(app, &session);
}

/// Stores on disk the session chats of the scopes that keep their chats there
/// now; a chat that cannot be stored stays in memory.
fn store_session_chats(app: &AppHandle) -> Result<(), AppError> {
    let state = app.state::<AppState>();
    let config = state.user_config();
    let mut session = state.history.session_chats.locked();
    let mut result = Ok(());
    for key in session.scopes() {
        let scope = ChatScope::from_key(&key);
        // a workspace not attached now keeps its session chats until it is
        let Ok(policy) = scope_policy(app, &scope, &config) else {
            continue;
        };
        let stored = (|| {
            if policy.is_session {
                return Ok(false);
            }
            let dirs = scope_chat_dirs(app, &scope, ChatAccess::Write)?;
            let folders = [session_chat_folders(app)];
            for chat in session.take(&key) {
                load_chat_files(&app.state::<ChatImages>(), &chat, &folders);
                let saved = chats::save_chat(
                    &dirs,
                    policy,
                    app.state::<ChatImages>().store(),
                    chat.clone(),
                );
                if let Err(error) = saved {
                    session.save(&key, chat);
                    return Err(error);
                }
            }
            Ok(true)
        })();
        match stored {
            Ok(true) => notify_chats_changed(app, &scope, Vec::new(), false),
            Ok(false) => {}
            Err(error) => result = result.and(Err(error)),
        }
    }
    prune_session_files(app, &session);
    result
}

/// Applies the policy of a workspace to the chats of each of its profiles.
fn enforce_profile_chat_history_policy(
    app: &AppHandle,
    workspace_ref: &str,
    workspace: &crate::services::ai_workspace::Workspace,
    policy: chats::ChatHistoryPolicy,
) -> Result<(), AppError> {
    let mut result = Ok(());
    for chats_dir in crate::services::ai_workspace::all_profile_chats_dirs(&workspace.root)? {
        // the profile folder is named by the profile id
        let Some(profile_id) = chats_dir
            .parent()
            .and_then(Path::file_name)
            .and_then(|name| name.to_str())
            .map(str::to_owned)
        else {
            continue;
        };
        let dirs = chats::profile_chat_dirs(app, &workspace.id, &profile_id, chats_dir.clone())?;
        match chats::enforce_chat_history_policy(&dirs, policy) {
            Ok(removed) => {
                let key = crate::services::ai_workspace::join_ref(workspace_ref, &profile_id);
                notify_chats_removed(app, &ChatScope::Profile(key), removed);
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

/// Brings the dialog history in line with its policy and collects orphan
/// recording folders.
fn enforce_dialog_history_policy(
    app: &AppHandle,
    policy: dialogs::DialogHistoryPolicy,
) -> Result<(), AppError> {
    super::user_data::user_dir(app)?;
    let dirs = dialogs::app_dialog_dirs(app)?;
    if !policy.is_session {
        // kept on disk from now on: the dialogs of this run go there too
        let state = app.state::<AppState>();
        let mut session = state.history.session_dialogs.locked();
        let session_recordings = SessionFiles::of_app(app).recordings();
        for dialog in session.take() {
            let stored = dialogs::store_session_dialog(&dirs, &session_recordings, policy, &dialog);
            if let Err(error) = stored {
                session.save(dialog);
                return Err(error);
            }
        }
    }
    let removed = dialogs::enforce_dialog_history_policy(&dirs, policy)?;
    if !removed.is_empty() {
        notify_dialogs_changed(app, removed, false);
    }
    Ok(())
}

/// Tells every window that the dialog history changed.
fn notify_dialogs_changed(app: &AppHandle, removed_dialog_ids: Vec<String>, is_cleared: bool) {
    let payload = crate::models::DialogsChangedEvent {
        removed_dialog_ids,
        is_cleared,
    };
    if let Err(error) = crate::events::emit::<crate::events::DialogsChanged, _>(app, payload) {
        log::warn!("Could not announce a dialog history change: {error}");
    }
}

/// Tells every window that the editor history changed; a failure is only
/// logged, as for the chats.
pub(super) fn notify_editor_history_changed(app: &AppHandle) {
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
/// profile's own, kept in the profile folder of the AI workspace.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChatScope {
    AskAi,
    Profile(String),
}

impl ChatScope {
    pub fn from_profile_id(profile_id: Option<String>) -> Self {
        profile_id.map_or(Self::AskAi, Self::Profile)
    }

    /// The key of the scope among the session chats.
    fn key(&self) -> &str {
        match self {
            Self::AskAi => "",
            Self::Profile(key) => key,
        }
    }

    fn from_key(key: &str) -> Self {
        if key.is_empty() {
            Self::AskAi
        } else {
            Self::Profile(key.to_string())
        }
    }
}

/// Removes the files of the session no session chat refers to any more.
fn prune_session_files(app: &AppHandle, session: &SessionChats) {
    let kept = session.file_ids().into_iter().collect();
    if let Err(error) = SessionFiles::of_app(app).prune_chat_files(&kept) {
        log::warn!("Could not remove the unused files of the session chats: {error}");
    }
}

/// Reads into the image store the images and attachments of `chat` that are
/// in `sources`, (images, attachments) folders, so that a save to another
/// folder carries them along. One that is nowhere is left out by the save.
fn load_chat_files(images: &ChatImages, chat: &Chat, sources: &[(PathBuf, PathBuf)]) {
    let mut images = images.lock();
    let ids = crate::services::chat_images::ChatFileIds::of(chat);
    for id in &ids.images {
        for (dir, _) in sources {
            if images.get(dir, id).is_ok() {
                break;
            }
        }
    }
    for id in &ids.files {
        for (_, dir) in sources {
            if images.get_file(dir, id).is_ok() {
                break;
            }
        }
    }
}

/// The (images, attachments) folders of the session chats.
fn session_chat_folders(app: &AppHandle) -> (PathBuf, PathBuf) {
    let files = SessionFiles::of_app(app);
    (files.chat_images(), files.chat_attachments())
}

/// Where a new recording of a dialog goes: the folder of this run while new
/// dialogs are kept until the app quits, the data folder otherwise.
pub fn recording_dirs_for_new(
    app: &AppHandle,
    is_session: bool,
) -> Result<super::recordings::RecordingDirs, AppError> {
    if is_session {
        Ok(SessionFiles::of_app(app).recordings())
    } else {
        super::recordings::RecordingDirs::of_app(app)
    }
}

/// Removes the files of the memory-only histories, at the start (what a run
/// that crashed left) and at quit.
pub fn clear_session_files(app: &AppHandle) {
    if let Err(error) = SessionFiles::of_app(app).clear() {
        log::warn!("Could not remove the files of the session: {error}");
    }
}

/// The dialog folders with the recordings of the session dialogs.
fn session_dialog_dirs(app: &AppHandle, dirs: &dialogs::DialogDirs) -> dialogs::DialogDirs {
    dialogs::DialogDirs {
        recordings: SessionFiles::of_app(app).recordings(),
        ..dirs.clone()
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
    scope: &ChatScope,
    access: ChatAccess,
) -> Result<chats::ChatDirs, AppError> {
    match scope {
        ChatScope::AskAi => chats::app_chat_dirs(app),
        // the scope names the profile by its reference `[workspaceId:]id`
        ChatScope::Profile(key) => {
            let (workspace_ref, profile_id) = crate::services::ai_workspace::split_ref(key);
            let workspace = crate::services::ai_workspace::resolve_workspace(app, workspace_ref)?;
            let chats_dir = match access {
                ChatAccess::Read => crate::services::ai_workspace::existing_profile_chats_path(
                    &workspace.root,
                    profile_id,
                ),
                ChatAccess::Write => {
                    crate::services::ai_workspace::profile_chats_dir(&workspace.root, profile_id)
                }
            }?;
            chats::profile_chat_dirs(app, &workspace.id, profile_id, chats_dir)
        }
    }
}

/// The policy the chats of `scope` follow: a profile's chats follow the
/// settings of its workspace over the default of the app.
fn scope_policy(
    app: &AppHandle,
    scope: &ChatScope,
    config: &serde_json::Value,
) -> Result<chats::ChatHistoryPolicy, AppError> {
    match scope {
        ChatScope::AskAi => Ok(chats::ChatHistoryPolicy::from_config(config)),
        ChatScope::Profile(key) => {
            let (workspace_ref, _) = crate::services::ai_workspace::split_ref(key);
            let workspace = crate::services::ai_workspace::resolve_workspace(app, workspace_ref)?;
            Ok(chats::ChatHistoryPolicy::for_workspace(
                &crate::services::ai_workspace::settings::read_chat_history(&workspace.root),
            ))
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
    let _workspace = state.read_workspace();
    with_chats_in_workspace(app, scope, access, operation)
}

fn with_chats_in_workspace<T>(
    app: &AppHandle,
    scope: &ChatScope,
    access: ChatAccess,
    operation: impl FnOnce(&AppState, &chats::ChatDirs) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let state = app.state::<AppState>();
    let _guard = state.history.lock_chat_history();
    let dirs = scope_chat_dirs(app, scope, access)?;
    if access == ChatAccess::Write {
        super::user_data::ensure_write_allowed(&dirs.chats)?;
    }
    operation(&state, &dirs)
}

/// Runs `operation` while no chat history is written, e.g. to remove a profile
/// together with its chats.
pub fn while_chats_locked_in_workspace<T>(
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

pub fn add_command_run_history(
    app: &AppHandle,
    entry: EditorHistoryEntry,
    command_name: String,
    outcome: Result<Option<String>, EditorHistoryFailure>,
) -> Result<Option<String>, AppError> {
    change_editor(app, |config, memory| {
        editor::add_command_run_history(app, config, memory, entry, command_name, outcome)
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

pub fn set_editor_history_failure(
    app: &AppHandle,
    id: String,
    failure: EditorHistoryFailure,
) -> Result<(), AppError> {
    change_editor(app, |config, memory| {
        editor::set_editor_history_failure(app, config, memory, id, failure)
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

/// Removes the recording `file` of `dialog_id` unless the saved dialog still
/// names it.
pub fn discard_dialog_recording(
    app: &AppHandle,
    dialog_id: String,
    file: String,
) -> Result<(), AppError> {
    with_dialogs(app, ChatAccess::Write, |state, dirs| {
        let session_dirs = session_dialog_dirs(app, dirs);
        if super::recordings::exist(
            &session_dirs.recordings,
            &dialog_id,
            std::slice::from_ref(&file),
        ) == [true]
        {
            let is_named = state
                .history
                .session_dialogs
                .locked()
                .get(&dialog_id)
                .is_some_and(|dialog| dialog.recording_files.contains(&file));
            if is_named {
                return Ok(());
            }
            return super::recordings::discard(&session_dirs.recordings, &dialog_id, &file);
        }
        dialogs::discard_recording(dirs, &dialog_id, &file)
    })
}

fn with_dialogs<T>(
    app: &AppHandle,
    access: ChatAccess,
    operation: impl FnOnce(&AppState, &dialogs::DialogDirs) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let state = app.state::<AppState>();
    let _guard = state.history.lock_dialog_history();
    let dirs = dialogs::app_dialog_dirs(app)?;
    if access == ChatAccess::Write {
        super::user_data::ensure_write_allowed(&dirs.dialogs)?;
    }
    operation(&state, &dirs)
}

pub fn list_dialogs(app: &AppHandle) -> Result<Vec<DialogSummary>, AppError> {
    with_dialogs(app, ChatAccess::Read, |state, dirs| {
        let stored = dialogs::list_dialogs(dirs)?;
        let session = state.history.session_dialogs.locked();
        Ok(session::merge_dialog_summaries(stored, session.list()))
    })
}

pub fn read_dialog(app: &AppHandle, id: String) -> Result<Option<Dialog>, AppError> {
    with_dialogs(app, ChatAccess::Read, |state, dirs| {
        if let Some(dialog) = state.history.session_dialogs.locked().get(&id) {
            return Ok(Some(dialog.clone()));
        }
        dialogs::open_dialog(dirs, &id)
    })
}

pub fn save_dialog(app: &AppHandle, dialog: Dialog) -> Result<(), AppError> {
    let removed = with_dialogs(app, ChatAccess::Write, |state, dirs| {
        let config = state.user_config();
        let policy = dialogs::DialogHistoryPolicy::from_config(&config);
        let mut session = state.history.session_dialogs.locked();
        // a dialog goes where its recordings are: one recorded into the data
        // folder stays there, one recorded in this run stays in it
        let names = &dialog.recording_files;
        let has_stored_recordings = super::recordings::exist(&dirs.recordings, &dialog.id, names)
            .into_iter()
            .any(|exists| exists);
        let has_session_recordings =
            super::recordings::exist(&SessionFiles::of_app(app).recordings(), &dialog.id, names)
                .into_iter()
                .any(|exists| exists);
        if (policy.is_session && !has_stored_recordings) || has_session_recordings {
            session.save(dialog);
            return Ok(Vec::new());
        }
        session.remove(&dialog.id);
        dialogs::save_dialog(dirs, policy_on_disk(policy), dialog)
    })?;
    notify_dialogs_changed(app, removed, false);
    Ok(())
}

/// `policy` as a dialog kept on disk follows it.
fn policy_on_disk(policy: dialogs::DialogHistoryPolicy) -> dialogs::DialogHistoryPolicy {
    dialogs::DialogHistoryPolicy {
        is_session: false,
        ..policy
    }
}

pub fn rename_dialog(app: &AppHandle, id: String, title: String) -> Result<(), AppError> {
    with_dialogs(app, ChatAccess::Write, |state, dirs| {
        let title = dialogs::validate_dialog_title(&title)?;
        if state
            .history
            .session_dialogs
            .locked()
            .rename(&id, title.clone())
        {
            return Ok(());
        }
        dialogs::rename_dialog(dirs, &id, &title)
    })?;
    notify_dialogs_changed(app, Vec::new(), false);
    Ok(())
}

pub fn search_dialogs(app: &AppHandle, query: String) -> Result<Vec<String>, AppError> {
    let state = app.state::<AppState>();
    let (dialogs_dir, stored, session_found, merged) =
        with_dialogs(app, ChatAccess::Read, |state, dirs| {
            let stored = dialogs::list_dialogs(dirs)?;
            let session = state.history.session_dialogs.locked();
            let found =
                session::search_session_dialogs(session.list(), &query.trim().to_lowercase());
            let merged = session::merge_dialog_summaries(stored.clone(), session.list());
            Ok((dirs.dialogs.clone(), stored, found, merged))
        })?;
    let stored_found: std::collections::HashSet<String> = dialogs::search_dialogs(
        &dialogs_dir,
        stored,
        query.clone(),
        &state.history.dialog_search,
    )?
    .into_iter()
    .collect();
    let is_blank = query.trim().is_empty();
    Ok(merged
        .into_iter()
        .map(|item| item.id)
        .filter(|id| is_blank || session_found.contains(id) || stored_found.contains(id))
        .collect())
}

pub fn delete_dialog(app: &AppHandle, id: String) -> Result<Option<Dialog>, AppError> {
    let id_for_event = id.clone();
    with_dialogs(app, ChatAccess::Write, |state, dirs| {
        let in_session = state.history.session_dialogs.locked().remove(&id);
        if in_session.is_some() {
            dialogs::delete_dialog(&session_dialog_dirs(app, dirs), &id)?;
        }
        // a stored copy the session one hid goes too
        let stored = dialogs::delete_dialog(dirs, &id)?;
        Ok(in_session.or(stored))
    })
    .inspect(|_| notify_dialogs_changed(app, vec![id_for_event], false))
}

pub fn release_dialog_recordings(app: &AppHandle, id: String) -> Result<(), AppError> {
    with_dialogs(app, ChatAccess::Write, |state, dirs| {
        if state.history.session_dialogs.locked().get(&id).is_none() {
            dialogs::release_dialog_recordings(&session_dialog_dirs(app, dirs), &id)?;
        }
        dialogs::release_dialog_recordings(dirs, &id)
    })
}

pub fn clear_dialogs(app: &AppHandle) -> Result<(), AppError> {
    with_dialogs(app, ChatAccess::Write, |state, dirs| {
        state.history.session_dialogs.locked().take();
        super::recordings::clear(&SessionFiles::of_app(app).recordings())?;
        dialogs::clear_dialogs(dirs)
    })?;
    notify_dialogs_changed(app, Vec::new(), true);
    Ok(())
}

pub fn clear_editor_history(app: &AppHandle) -> Result<(), AppError> {
    change_editor(app, |config, memory| {
        editor::clear_editor_history(app, config, memory)
    })
}

pub fn list_chats(app: &AppHandle, scope: &ChatScope) -> Result<Vec<ChatSummary>, AppError> {
    with_chats(app, scope, ChatAccess::Read, |state, dirs| {
        let stored = chats::list_chats(dirs)?;
        let session = state.history.session_chats.locked();
        Ok(session::merge_chat_summaries(
            stored,
            session.list(scope.key()),
        ))
    })
}

pub fn list_recent_quick_request_prompts(
    app: &AppHandle,
    scope: &ChatScope,
    limit: usize,
) -> Result<Vec<String>, AppError> {
    with_chats(app, scope, ChatAccess::Read, |state, dirs| {
        let config = state.user_config();
        let policy = scope_policy(app, scope, &config)?;
        let mut prompts = session::recent_session_prompts(
            state.history.session_chats.locked().list(scope.key()),
            if policy.saves_quick_requests {
                limit
            } else {
                0
            },
        );
        for prompt in chats::list_recent_quick_request_prompts(dirs, policy, limit)? {
            if prompts.len() >= limit {
                break;
            }
            if !prompts.contains(&prompt) {
                prompts.push(prompt);
            }
        }
        Ok(prompts)
    })
}

/// Import leases and image loading are protected against concurrent cleanup.
pub fn read_chat(
    app: &AppHandle,
    scope: &ChatScope,
    id: String,
    owner: Option<String>,
) -> Result<Option<Chat>, AppError> {
    with_chats(app, scope, ChatAccess::Read, |state, dirs| {
        let in_session = state
            .history
            .session_chats
            .locked()
            .get(scope.key(), &id)
            .cloned();
        let chat = match in_session {
            Some(chat) => Some(chat),
            None => chats::open_chat(dirs, id)?,
        };
        // without an import lease nothing holds the images: they are read
        // when shown, e.g. not at all for a Markdown copy
        if let (Some(chat), Some(_)) = (&chat, &owner) {
            load_chat_files(
                &app.state::<ChatImages>(),
                chat,
                &[session_chat_folders(app)],
            );
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
        let policy = scope_policy(app, scope, &config)?;
        let mut session = state.history.session_chats.locked();
        let images = app.state::<ChatImages>();
        let (session_images, session_attachments) = session_chat_folders(app);
        if policy.is_session {
            if policy.saves(&item) {
                // a stored chat continued now carries its files along
                load_chat_files(&images, &item, &[(dirs.images(), dirs.attachments())]);
                {
                    let mut store = images.lock();
                    store.persist(&session_images, &item)?;
                    store.persist_files(&session_attachments, &item)?;
                }
                session.save(scope.key(), item);
                prune_session_files(app, &session);
            }
            return Ok(Vec::new());
        }
        load_chat_files(&images, &item, &[(session_images, session_attachments)]);
        let removed = chats::save_chat(
            dirs,
            policy,
            app.state::<ChatImages>().store(),
            item.clone(),
        )?;
        if session.remove(scope.key(), &item.id).is_some() {
            prune_session_files(app, &session);
        }
        Ok(removed)
    })?;
    notify_chats_changed(app, scope, removed, false);
    Ok(())
}

pub fn rename_chat(
    app: &AppHandle,
    scope: &ChatScope,
    id: String,
    title: String,
) -> Result<(), AppError> {
    with_chats(app, scope, ChatAccess::Write, |state, dirs| {
        let checked = chats::validate_chat_title(&title)?;
        if state
            .history
            .session_chats
            .locked()
            .rename(scope.key(), &id, checked)
        {
            return Ok(());
        }
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
    let _workspace = state.read_workspace();
    let (chats_dir, stored, session_found, merged) =
        with_chats_in_workspace(app, scope, ChatAccess::Read, |state, dirs| {
            let stored = chats::list_chats(dirs)?;
            let session = state.history.session_chats.locked();
            let list = session.list(scope.key());
            let found = session::search_session_chats(list, &query.trim().to_lowercase());
            let merged = session::merge_chat_summaries(stored.clone(), list);
            Ok((dirs.chats.clone(), stored, found, merged))
        })?;
    let stored_found: std::collections::HashSet<String> = chats::search_chats(
        &chats_dir,
        stored,
        query.clone(),
        &state.history.chat_search,
    )?
    .into_iter()
    .collect();
    let is_blank = query.trim().is_empty();
    Ok(merged
        .into_iter()
        .map(|item| item.id)
        .filter(|id| is_blank || session_found.contains(id) || stored_found.contains(id))
        .collect())
}

pub fn delete_chat(
    app: &AppHandle,
    scope: &ChatScope,
    id: String,
    owner: String,
) -> Result<Option<Chat>, AppError> {
    let id_for_event = id.clone();
    with_chats(app, scope, ChatAccess::Write, |state, dirs| {
        let in_session = state
            .history
            .session_chats
            .locked()
            .remove(scope.key(), &id);
        let stored = match chats::read_chat(&dirs.chats, id.clone()) {
            Ok(chat) => chat,
            Err(error) => {
                log::warn!("Removing chat {id}, which cannot be read: {error}");
                None
            }
        };
        let removed = in_session.or(stored);
        if let Some(chat) = &removed {
            load_chat_files(
                &app.state::<ChatImages>(),
                chat,
                &[session_chat_folders(app)],
            );
            load_chat_images(
                &app.state::<ChatImages>(),
                &dirs.chats,
                chat,
                ImageRetention::Undo(&owner),
            )?;
        }
        prune_session_files(app, &state.history.session_chats.locked());
        // a stored copy the session one hid goes too
        chats::delete_chat(dirs, id.clone())?;
        Ok(removed)
    })
    .inspect(|_| notify_chats_changed(app, scope, vec![id_for_event], false))
}

pub fn clear_chats(app: &AppHandle, scope: &ChatScope) -> Result<(), AppError> {
    with_chats(app, scope, ChatAccess::Write, |state, dirs| {
        let mut session = state.history.session_chats.locked();
        session.take(scope.key());
        prune_session_files(app, &session);
        drop(session);
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
    let files_dir = chats::chat_file_directory(chats_dir);
    let mut images = images.lock();
    // originals are read when a tool or an export needs them; the undo keeps
    // them in memory, as the saved history may lose them meanwhile
    let files = chat
        .messages
        .iter()
        .flat_map(|message| &message.attachments)
        .filter_map(|attachment| attachment.file.as_ref());
    for file in files {
        match retention {
            ImageRetention::Active(Some(owner)) => images.hold(owner, &file.id),
            ImageRetention::Active(None) => {}
            ImageRetention::Undo(owner) => {
                images.hold_undo(owner, &file.id);
                if let Err(error) = images.get_file(&files_dir, &file.id) {
                    log::warn!("Could not preserve chat file {} for undo: {error}", file.id);
                }
            }
        }
    }
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
        let store = app.state::<ChatImages>();
        let mut images = store.lock();
        images
            .get(&dirs.images(), id)
            .or_else(|_| images.get(&session_chat_folders(app).0, id))
    })
}

/// The folders of the attachment originals of the conversations of `scope`:
/// the stored ones and those of the session chats.
pub fn chat_files_dirs(app: &AppHandle, scope: &ChatScope) -> Result<[PathBuf; 2], AppError> {
    with_chats(app, scope, ChatAccess::Read, |_, dirs| {
        Ok([dirs.attachments(), session_chat_folders(app).1])
    })
}

/// The original of an attached file of a conversation of `scope`.
pub fn read_chat_file(app: &AppHandle, scope: &ChatScope, id: &str) -> Result<Vec<u8>, AppError> {
    with_chats(app, scope, ChatAccess::Read, |_, dirs| {
        let store = app.state::<ChatImages>();
        let mut images = store.lock();
        images
            .get_file(&dirs.attachments(), id)
            .or_else(|_| images.get_file(&session_chat_folders(app).1, id))
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
                        origin: None,
                        instruction: None,
                        profile_id: None,
                        command_name: None,
                        created_at_ms: 1,
                        result: None,
                        is_result_applied: false,
                        failure: None,
                    });
                });
            }
        });
        assert_eq!(storage.lock_editor_history().len(), 16);
    }
}
