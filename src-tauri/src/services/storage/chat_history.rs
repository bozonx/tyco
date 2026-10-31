use crate::locks::MutexExt;
use std::sync::Mutex;

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use super::json_files::{remove_file_if_exists, write_json};
use super::paths::app_data_sub_dir;
use super::DAY_MS;
use crate::errors::AppError;
use crate::models::user_config::{self, ChatHistoryConfig, HistoryStorage};
use crate::models::{Chat, ChatSummary};
use crate::services::atomic_file::read_or_quarantine;
use crate::services::clock::now_ms;

use crate::services::chat_images::ChatImageStore;

const CHAT_INDEX_FILE: &str = "index.json";
const CHAT_TRANSACTION_FILE: &str = "chat-transaction.pending";

const STAGED_CHAT_SUFFIX: &str = ".json.staged";

/// The index and optional chat replacement are committed together. The journal
/// remains until cleanup finishes, so interrupted saves and deletes are replayed.
///
/// A saved chat is written once, to `<id>.json.staged`, and the journal names
/// it; the replay moves it into place. Journals of older versions carry the
/// whole chat in `chat` and are still replayed.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PendingChatTransaction {
    history: Vec<ChatSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    chat: Option<Chat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    staged_chat_id: Option<String>,
    /// The transaction may leave images no chat refers to. Finding them reads
    /// every chat, so a save that keeps its images skips it. Journals of older
    /// versions do not say and are cleaned.
    #[serde(default = "always_clean_images")]
    clean_images: bool,
}

fn always_clean_images() -> bool {
    true
}

/// Whether a transaction may leave images that no chat refers to.
#[derive(Clone, Copy, PartialEq, Eq)]
enum ImageCleanup {
    Needed,
    Skipped,
}

impl PendingChatTransaction {
    fn index_only(history: Vec<ChatSummary>, cleanup: ImageCleanup) -> Self {
        Self {
            history,
            chat: None,
            staged_chat_id: None,
            clean_images: cleanup == ImageCleanup::Needed,
        }
    }
}

fn staged_chat_path(chats_dir: &Path, id: &str) -> PathBuf {
    chats_dir.join(format!("{id}{STAGED_CHAT_SUFFIX}"))
}

fn commit_chat_transaction(
    chats_dir: &Path,
    history: Vec<ChatSummary>,
    chat: Option<Chat>,
    cleanup: ImageCleanup,
) -> Result<(), AppError> {
    let mut transaction = PendingChatTransaction::index_only(history, cleanup);
    if let Some(chat) = chat {
        let id = validate_chat_id(&chat.id)?;
        write_json(&staged_chat_path(chats_dir, &id), &chat)?;
        transaction.staged_chat_id = Some(id);
    }
    validate_chat_transaction(&transaction)?;
    write_json(&chats_dir.join(CHAT_TRANSACTION_FILE), &transaction)?;
    recover_chat_transaction(chats_dir)
}

fn validate_chat_transaction(transaction: &PendingChatTransaction) -> Result<(), AppError> {
    for item in &transaction.history {
        validate_chat_id(&item.id)?;
    }
    if let Some(chat) = &transaction.chat {
        validate_chat_id(&chat.id)?;
    }
    if let Some(id) = &transaction.staged_chat_id {
        validate_chat_id(id)?;
    }
    Ok(())
}

pub(super) fn recover_chat_transaction(chats_dir: &Path) -> Result<(), AppError> {
    let journal = chats_dir.join(CHAT_TRANSACTION_FILE);
    let raw = match fs::read(&journal) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    let transaction = match serde_json::from_slice::<PendingChatTransaction>(&raw)
        .map_err(AppError::from)
        .and_then(|transaction| {
            validate_chat_transaction(&transaction)?;
            Ok(transaction)
        }) {
        Ok(transaction) => transaction,
        Err(error) => return recover_from_damaged_journal(chats_dir, &journal, error),
    };
    if let Some(chat) = transaction.chat {
        let id = validate_chat_id(&chat.id)?;
        write_json(&chats_dir.join(format!("{id}.json")), &chat)?;
    }
    if let Some(id) = &transaction.staged_chat_id {
        let target = chats_dir.join(format!("{id}.json"));
        match fs::rename(staged_chat_path(chats_dir, id), &target) {
            Ok(()) => crate::services::atomic_file::sync_parent(&target)?,
            // moved already by a replay that stopped later
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    write_json(&chats_dir.join(CHAT_INDEX_FILE), &transaction.history)?;
    remove_orphan_chat_files(chats_dir, &transaction.history)?;
    if transaction.clean_images {
        crate::services::chat_images::remove_orphan_images(chats_dir)?;
    }
    remove_file_if_exists(&journal)?;
    crate::services::atomic_file::sync_parent(&journal)
}

/// A journal that cannot be parsed never permits deleting stored chats, and it
/// must not block the history forever either. It is set aside, the chats it
/// staged are moved into place, and the index is rebuilt from the chat files,
/// so at most the interrupted change is lost: a removed chat may come back.
fn recover_from_damaged_journal(
    chats_dir: &Path,
    journal: &Path,
    error: AppError,
) -> Result<(), AppError> {
    let copy = crate::services::atomic_file::quarantine(journal)?;
    log::warn!(
        "Chat journal {} is unreadable ({error}); moved it to {} and rebuilding the index",
        journal.display(),
        copy.display()
    );
    for entry in fs::read_dir(chats_dir)? {
        let path = entry?.path();
        let Some(id) = path
            .file_name()
            .and_then(|name| name.to_str())
            .and_then(|name| name.strip_suffix(STAGED_CHAT_SUFFIX))
            .and_then(|id| validate_chat_id(id).ok())
        else {
            continue;
        };
        // a staged chat is written just before its journal: it is the newest
        let target = chats_dir.join(format!("{id}.json"));
        fs::rename(&path, &target)?;
    }
    crate::services::atomic_file::sync_parent(journal)?;
    let history = rebuild_chat_index(chats_dir)?;
    write_json(&chats_dir.join(CHAT_INDEX_FILE), &history)
}

/// The directory of the chats of "Ask AI"; a profile keeps its own.
pub fn app_chats_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    app_data_sub_dir(app, "chats")
}

pub fn list_chats(chats_dir: &Path) -> Result<Vec<ChatSummary>, AppError> {
    load_chat_index(chats_dir)
}

/// The index of the chats in `chats_dir`. An index that is missing or cannot
/// be read is built anew from the chat files: the chats are all there, and
/// an empty index would have the next save remove them as orphans.
fn load_chat_index(chats_dir: &Path) -> Result<Vec<ChatSummary>, AppError> {
    recover_chat_transaction(chats_dir)?;
    let index_path = chats_dir.join(CHAT_INDEX_FILE);
    if let Some(history) = read_or_quarantine(&index_path, |raw| {
        let history: Vec<ChatSummary> = serde_json::from_str(raw)?;
        let mut ids = std::collections::HashSet::new();
        for item in &history {
            validate_chat_id(&item.id)?;
            if !ids.insert(&item.id) {
                return Err(AppError::InvalidInput("Duplicate chat id in index".into()));
            }
        }
        Ok(history)
    })? {
        return Ok(history);
    }
    let history = rebuild_chat_index(chats_dir)?;
    if !history.is_empty() {
        log::warn!(
            "Rebuilt the chat index of {} from {} chat files",
            chats_dir.display(),
            history.len()
        );
        write_json(&index_path, &history)?;
    }
    Ok(history)
}

/// The index entries of the chat files in `chats_dir`, the most recent first.
/// A chat file that cannot be read is set aside rather than lost to the
/// orphan cleanup.
fn rebuild_chat_index(chats_dir: &Path) -> Result<Vec<ChatSummary>, AppError> {
    let mut history = Vec::new();
    let entries = match fs::read_dir(chats_dir) {
        Ok(entries) => entries,
        // a profile that never saved a chat has no folder yet
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(history),
        Err(error) => return Err(error.into()),
    };
    for entry in entries {
        let path = entry?.path();
        if chat_file_id(&path).is_none() || !path.is_file() {
            continue;
        }
        // I/O failures do not establish corruption: leave the file untouched
        // and abort rebuilding instead of publishing an incomplete index.
        let raw = fs::read(&path)?;
        let parsed = serde_json::from_slice::<Chat>(&raw)
            .map_err(AppError::from)
            .and_then(|chat| {
                validate_stored_chat_id(&path, &chat)?;
                Ok(chat)
            });
        match parsed {
            Ok(chat) => {
                history.push(ChatSummary::from(&chat));
            }
            Err(error) => {
                log::warn!("Chat file {} is unreadable: {error}", path.display());
                crate::services::atomic_file::quarantine(&path)?;
            }
        }
    }
    history.sort_by_key(|item| std::cmp::Reverse(item.last_message_at_ms));
    Ok(history)
}

/// The chat id of a chat file: `<id>.json` with a valid id.
fn chat_file_id(path: &Path) -> Option<&str> {
    let name = path.file_name()?.to_str()?;
    let id = name.strip_suffix(".json")?;
    validate_chat_id(id).ok().map(|_| id)
}

fn validate_stored_chat_id(path: &Path, chat: &Chat) -> Result<(), AppError> {
    validate_chat_id(&chat.id)?;
    if chat_file_id(path) != Some(chat.id.as_str()) {
        return Err(AppError::InvalidInput(
            "Chat id does not match its filename".into(),
        ));
    }
    Ok(())
}

pub fn chat_image_directory(chats_dir: &Path) -> PathBuf {
    chats_dir.join("images")
}

pub fn save_chat(
    chats_dir: &Path,
    policy: ChatHistoryPolicy,
    images: &Mutex<ChatImageStore>,
    mut chat: Chat,
) -> Result<Vec<String>, AppError> {
    if !policy.is_enabled {
        return Ok(Vec::new());
    }
    // a title made from another one, e.g. of a branch, may outgrow the limit
    // a rename keeps; a stored title is always one a rename could give
    chat.title = clamp_chat_title(&chat.title);

    validate_chat_id(&chat.id)?;
    let mut history = list_chats(chats_dir)?;

    images
        .locked()
        .persist(&chat_image_directory(chats_dir), &chat)?;

    // the chat being saved stays, whatever date its last message has: its
    // file is written either way, and dropping it from the index would
    // have the orphan cleanup delete it right away
    let removed = policy.drop_expired(&mut history, now_ms());
    let cleanup = if !removed.is_empty() || drops_images(chats_dir, &chat) {
        ImageCleanup::Needed
    } else {
        ImageCleanup::Skipped
    };
    let removed = removed.into_iter().filter(|id| *id != chat.id).collect();
    upsert_chat_index(&mut history, &chat);
    commit_chat_transaction(chats_dir, history, Some(chat), cleanup)?;
    Ok(removed)
}

/// Whether the stored version of `chat` refers to images the new one does not.
/// A stored chat that cannot be read counts as one that does.
fn drops_images(chats_dir: &Path, chat: &Chat) -> bool {
    let stored = match read_chat(chats_dir, chat.id.clone()) {
        Ok(Some(stored)) => stored,
        Ok(None) => return false,
        Err(_) => return true,
    };
    let stored_ids = chat_image_ids(&stored);
    !stored_ids.is_subset(&chat_image_ids(chat))
}

fn chat_image_ids(chat: &Chat) -> std::collections::HashSet<&str> {
    chat.messages
        .iter()
        .flat_map(|message| &message.images)
        .map(|image| image.id.as_str())
        .collect()
}

/// Puts the chat into the index by the time of its last message, newest
/// first, without its messages to keep the index small. A chat restored by an
/// undo goes back to its place; one just written goes on top.
fn upsert_chat_index(history: &mut Vec<ChatSummary>, chat: &Chat) {
    let index_item = ChatSummary::from(chat);
    history.retain(|item| item.id != index_item.id);
    let index = history
        .iter()
        .position(|item| item.last_message_at_ms <= index_item.last_message_at_ms)
        .unwrap_or(history.len());
    history.insert(index, index_item);
}

pub fn read_chat(chats_dir: &Path, id: String) -> Result<Option<Chat>, AppError> {
    let path = chats_dir.join(format!("{}.json", validate_chat_id(&id)?));
    let Some(raw) = read_chat_bytes(&path)? else {
        return Ok(None);
    };
    parse_stored_chat(&path, &raw).map(Some)
}

/// The bytes of a chat file; `None` when there is none.
fn read_chat_bytes(path: &Path) -> Result<Option<Vec<u8>>, AppError> {
    match fs::read(path) {
        Ok(raw) => Ok(Some(raw)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn parse_stored_chat(path: &Path, raw: &[u8]) -> Result<Chat, AppError> {
    let chat: Chat = serde_json::from_slice(raw)?;
    validate_stored_chat_id(path, &chat)?;
    Ok(chat)
}

/// Reads a chat to open it. A file that cannot be parsed, or holds another
/// chat, is set aside the way a rebuild of the index sets it aside, and its
/// chat leaves the index: it would otherwise stay listed without ever
/// opening. Changes the index, so it runs under the chat history lock.
pub(super) fn open_chat(chats_dir: &Path, id: String) -> Result<Option<Chat>, AppError> {
    let path = chats_dir.join(format!("{}.json", validate_chat_id(&id)?));
    let Some(raw) = read_chat_bytes(&path)? else {
        return Ok(None);
    };
    match parse_stored_chat(&path, &raw) {
        Ok(chat) => Ok(Some(chat)),
        Err(error) => {
            let copy = crate::services::atomic_file::quarantine(&path)?;
            log::warn!(
                "Chat file {} is unreadable ({error}); moved it to {}",
                path.display(),
                copy.display()
            );
            let mut history = list_chats(chats_dir)?;
            history.retain(|item| item.id != id);
            commit_chat_transaction(chats_dir, history, None, ImageCleanup::Needed)?;
            Ok(None)
        }
    }
}

/// Gives a stored chat another title. Neither its messages nor its place in
/// the index change: a rename is not activity in the chat.
pub fn rename_chat(chats_dir: &Path, id: String, title: String) -> Result<(), AppError> {
    let title = validate_chat_title(&title)?;
    // an unreadable chat is set aside and leaves the index, as on opening
    let Some(mut chat) = open_chat(chats_dir, id.clone())? else {
        return Err(AppError::NotFound(String::from("Chat not found")));
    };
    let mut history = list_chats(chats_dir)?;
    chat.title = title;
    rename_in_chat_index(&mut history, &id, &chat.title);
    // the messages, and so the images, stay as they are
    commit_chat_transaction(chats_dir, history, Some(chat), ImageCleanup::Skipped)
}

/// The longest title a chat can be given, in characters; the sidebar uses the
/// same limit.
const MAX_CHAT_TITLE_CHARS: usize = 120;

/// A title as a rename stores it: trimmed, neither empty nor too long.
fn validate_chat_title(title: &str) -> Result<String, AppError> {
    let title = title.trim();
    if title.is_empty() {
        return Err(AppError::InvalidInput("Chat title is empty".into()));
    }
    if title.chars().count() > MAX_CHAT_TITLE_CHARS {
        return Err(AppError::InvalidInput("Chat title is too long".into()));
    }
    Ok(title.to_string())
}

/// The title cut to `MAX_CHAT_TITLE_CHARS` characters, ending with an ellipsis
/// when cut.
fn clamp_chat_title(title: &str) -> String {
    if title.chars().count() <= MAX_CHAT_TITLE_CHARS {
        return title.to_string();
    }
    let head: String = title.chars().take(MAX_CHAT_TITLE_CHARS - 1).collect();
    format!("{}…", head.trim_end())
}

fn rename_in_chat_index(history: &mut [ChatSummary], id: &str, title: &str) {
    if let Some(item) = history.iter_mut().find(|item| item.id == id) {
        item.title = title.to_string();
    }
}

/// The lowercase searchable text of chat files, reused while a file keeps its
/// modification time and size, so a search does not parse every chat again.
/// It holds at most `MAX_CACHED_SEARCH_BYTES` of text; the chats searched
/// longest ago are dropped first.
pub struct ChatSearchCache {
    state: Mutex<SearchCacheState>,
    max_bytes: usize,
}

impl Default for ChatSearchCache {
    fn default() -> Self {
        Self::with_max_bytes(MAX_CACHED_SEARCH_BYTES)
    }
}

#[derive(Default)]
struct SearchCacheState {
    entries: HashMap<PathBuf, CachedChatText>,
    total_bytes: usize,
    /// Counts the lookups, so the least recently used entry can be found.
    clock: u64,
}

struct CachedChatText {
    modified: SystemTime,
    size_bytes: u64,
    text: String,
    last_used: u64,
}

/// How much chat text the search keeps in memory, across every history.
const MAX_CACHED_SEARCH_BYTES: usize = 32 * 1024 * 1024;

impl SearchCacheState {
    fn remove(&mut self, path: &Path) {
        if let Some(entry) = self.entries.remove(path) {
            self.total_bytes -= entry.text.len();
        }
    }

    fn insert(&mut self, path: PathBuf, text: CachedText, max_bytes: usize) {
        let CachedText {
            modified,
            size_bytes,
            text,
        } = text;
        self.remove(&path);
        if text.len() > max_bytes {
            return;
        }
        while self.total_bytes + text.len() > max_bytes {
            let Some(oldest) = self
                .entries
                .iter()
                .min_by_key(|(_, entry)| entry.last_used)
                .map(|(path, _)| path.clone())
            else {
                break;
            };
            self.remove(&oldest);
        }
        self.clock += 1;
        self.total_bytes += text.len();
        self.entries.insert(
            path,
            CachedChatText {
                modified,
                size_bytes,
                text,
                last_used: self.clock,
            },
        );
    }
}

/// A chat text as read, before it is cached.
struct CachedText {
    modified: SystemTime,
    size_bytes: u64,
    text: String,
}

impl ChatSearchCache {
    fn with_max_bytes(max_bytes: usize) -> Self {
        Self {
            state: Mutex::default(),
            max_bytes,
        }
    }

    /// Whether the text of a chat file contains `query`; `None` when there is
    /// no file.
    fn matches(&self, chats_dir: &Path, id: &str, query: &str) -> Result<Option<bool>, AppError> {
        let path = chats_dir.join(format!("{}.json", validate_chat_id(id)?));
        let metadata = match fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        let modified = metadata.modified()?;
        let size_bytes = metadata.len();
        {
            let mut state = self.state.locked();
            state.clock += 1;
            let now = state.clock;
            if let Some(cached) = state.entries.get_mut(&path) {
                if cached.modified == modified && cached.size_bytes == size_bytes {
                    cached.last_used = now;
                    return Ok(Some(cached.text.contains(query)));
                }
            }
        }
        let Some(chat) = read_chat(chats_dir, id.to_string())? else {
            return Ok(None);
        };
        let text = chat_search_text(&chat);
        let found = text.contains(query);
        self.state.locked().insert(
            path,
            CachedText {
                modified,
                size_bytes,
                text,
            },
            self.max_bytes,
        );
        Ok(Some(found))
    }

    /// Drops the chats of `chats_dir` the index no longer lists.
    fn retain_listed(&self, chats_dir: &Path, history: &[ChatSummary]) {
        let mut state = self.state.locked();
        let gone: Vec<PathBuf> = state
            .entries
            .keys()
            .filter(|path| {
                path.parent() == Some(chats_dir)
                    && !history.iter().any(|item| {
                        path.file_stem().and_then(|stem| stem.to_str()) == Some(&item.id)
                    })
            })
            .cloned()
            .collect();
        for path in gone {
            state.remove(&path);
        }
    }

    #[cfg(test)]
    fn cached_bytes(&self) -> usize {
        self.state.locked().total_bytes
    }
}

/// Ids of the chats whose title or messages contain `query`, in index order.
/// The index holds no messages, so each chat file is read.
pub(super) fn search_chats(
    chats_dir: &Path,
    history: Vec<ChatSummary>,
    query: String,
    cache: &ChatSearchCache,
) -> Result<Vec<String>, AppError> {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return Ok(history.into_iter().map(|item| item.id).collect());
    }
    cache.retain_listed(chats_dir, &history);
    let mut found = Vec::new();
    for item in history {
        let matches = match cache.matches(chats_dir, &item.id, &query) {
            Ok(Some(found)) => found,
            // a chat the index lists without a file can still match by title
            Ok(None) => item.title.to_lowercase().contains(&query),
            Err(error) => {
                log::warn!("Searching chat {} by its title only: {error}", item.id);
                item.title.to_lowercase().contains(&query)
            }
        };
        if matches {
            found.push(item.id);
        }
    }

    Ok(found)
}

/// Everything a search looks in, lowercase: the title, the messages, the text
/// and names of their attachments and the names of their images. Pieces are
/// split by a line break so a query does not match across two of them.
fn chat_search_text(chat: &Chat) -> String {
    let mut pieces = vec![chat.title.as_str()];
    for message in &chat.messages {
        pieces.push(&message.content);
        for attachment in &message.attachments {
            pieces.push(&attachment.text);
            pieces.extend(attachment.name.as_deref());
        }
        pieces.extend(
            message
                .images
                .iter()
                .filter_map(|image| image.name.as_deref()),
        );
    }
    pieces.join("\n").to_lowercase()
}

pub fn delete_chat(chats_dir: &Path, id: String) -> Result<(), AppError> {
    validate_chat_id(&id)?;
    let mut history = list_chats(chats_dir)?;
    history.retain(|item| item.id != id);
    commit_chat_transaction(chats_dir, history, None, ImageCleanup::Needed)
}

/// What the settings say about the chat history.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChatHistoryPolicy {
    /// Chats are saved at all.
    pub is_enabled: bool,
    /// Chats without a message for this many days are dropped; 0 keeps them
    /// forever.
    pub retention_days: u64,
}

impl ChatHistoryPolicy {
    /// The policy of the chats of "Ask AI".
    pub fn from_config(user_config: &Value) -> Self {
        user_config::chat_history(user_config).into()
    }

    /// The policy every profile chat follows.
    pub fn for_profiles(user_config: &Value) -> Self {
        user_config::profile_chat_history(user_config).into()
    }

    /// Drops the chats whose last message is older than the retention period.
    /// Returns the ids of the dropped chats.
    fn drop_expired(&self, history: &mut Vec<ChatSummary>, now_ms: u64) -> Vec<String> {
        if self.retention_days == 0 {
            return Vec::new();
        }
        let cutoff = now_ms.saturating_sub(self.retention_days.saturating_mul(DAY_MS));
        let mut removed = Vec::new();
        history.retain(|item| {
            let keep = item.last_message_at_ms >= cutoff;
            if !keep {
                removed.push(item.id.clone());
            }
            keep
        });
        removed
    }
}

impl From<ChatHistoryConfig> for ChatHistoryPolicy {
    fn from(config: ChatHistoryConfig) -> Self {
        Self {
            is_enabled: config.storage != HistoryStorage::Off,
            retention_days: config.retention_days,
        }
    }
}

/// Brings the stored chats in line with the settings: expired ones are
/// dropped, also while no new chats are saved. Returns the dropped ids.
pub(super) fn enforce_chat_history_policy(
    chats_dir: &Path,
    policy: ChatHistoryPolicy,
) -> Result<Vec<String>, AppError> {
    let mut history = list_chats(chats_dir)?;
    let removed = policy.drop_expired(&mut history, now_ms());
    if removed.is_empty() {
        return Ok(removed);
    }

    commit_chat_transaction(chats_dir, history, None, ImageCleanup::Needed)?;
    Ok(removed)
}

/// Removes the index, chat files, and persisted image bytes.
pub fn clear_chats(chats_dir: &Path) -> Result<(), AppError> {
    recover_chat_transaction(chats_dir)?;
    commit_chat_transaction(chats_dir, Vec::new(), None, ImageCleanup::Needed)?;
    let images_dir = chats_dir.join("images");
    if images_dir.exists() {
        fs::remove_dir_all(images_dir)?;
    }

    for entry in fs::read_dir(chats_dir)?.flatten() {
        let path = entry.path();
        if path.is_file() {
            remove_file_if_exists(&path)?;
        }
    }

    Ok(())
}

fn validate_chat_id(id: &str) -> Result<String, AppError> {
    // "index" would name the index file
    let is_safe = crate::services::file_ids::is_file_id(id) && id != "index";

    if !is_safe {
        return Err(AppError::InvalidInput(String::from("Invalid chat id")));
    }

    Ok(id.to_string())
}

/// Removes the chat files the index no longer lists. Only chat files: the
/// index, a file set aside as unreadable and anything else stay.
fn remove_orphan_chat_files(chats_dir: &Path, history: &[ChatSummary]) -> Result<(), AppError> {
    let active_ids = history
        .iter()
        .map(|item| item.id.as_str())
        .collect::<std::collections::HashSet<_>>();

    for entry in fs::read_dir(chats_dir)? {
        let path = entry?.path();
        // a staged chat left by a save that never wrote its journal
        let staged = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.ends_with(STAGED_CHAT_SUFFIX));
        let orphan = staged || chat_file_id(&path).is_some_and(|id| !active_ids.contains(id));
        if orphan && path.is_file() {
            fs::remove_file(&path)?;
        }
    }
    crate::services::atomic_file::sync_parent(&chats_dir.join(CHAT_INDEX_FILE))
}

#[cfg(test)]
mod tests;
