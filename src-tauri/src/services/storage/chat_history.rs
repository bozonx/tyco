//! The chats of a history: one file per chat, `<id>.json`, the only record
//! of it. The list of the chats is an index derived from those files and
//! kept in the state folder, apart from the user data folder, which may be
//! synced: it is rebuilt when the chat files change, telling them by their
//! size and modification time together, as either alone may be kept by a
//! sync tool or rounded by a file system.
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
use super::DAY_MS;
use crate::errors::AppError;
use crate::models::user_config::{self, ChatHistoryConfig, HistoryStorage};
use crate::models::{Chat, ChatSummary};
use crate::services::clock::now_ms;

use crate::services::chat_images::ChatImageStore;

/// The folders and files of one chat history.
#[derive(Clone, Debug)]
pub struct ChatDirs {
    /// The chat files and their `images` folder.
    pub chats: PathBuf,
    /// The derived index of the state folder.
    pub index: PathBuf,
    /// When each unreferenced image was first seen, see
    /// `chat_images::remove_orphan_images`.
    pub orphans: PathBuf,
}

impl ChatDirs {
    pub fn images(&self) -> PathBuf {
        chat_image_directory(&self.chats)
    }
}

/// The folder of the indexes in the state folder.
const INDEX_DIR: &str = "index";
const CHAT_INDEX_FILE: &str = "chats.json";
const ORPHAN_IMAGES_FILE: &str = "orphan-images.json";

/// The chats of "Ask AI": `chats` of the user data folder.
pub fn app_chat_dirs(app: &AppHandle) -> Result<ChatDirs, AppError> {
    let index_dir = super::paths::state_sub_dir(app, INDEX_DIR)?;
    Ok(ChatDirs {
        chats: super::user_data::user_sub_dir(app, "chats")?,
        index: index_dir.join(CHAT_INDEX_FILE),
        orphans: index_dir.join(ORPHAN_IMAGES_FILE),
    })
}

/// The chats of a profile of the vault at `vault_root`. The indexes of each
/// vault have a folder of their own, named by the digest of its path, so that
/// two vaults never share one.
pub fn profile_chat_dirs(
    app: &AppHandle,
    vault_root: &Path,
    profile_id: &str,
    chats_dir: PathBuf,
) -> Result<ChatDirs, AppError> {
    let index_dir = super::paths::state_sub_dir(app, INDEX_DIR)?;
    Ok(ChatDirs {
        chats: chats_dir,
        index: vault_index_dir(&index_dir, vault_root)
            .join(profile_id)
            .join(CHAT_INDEX_FILE),
        orphans: index_dir.join(ORPHAN_IMAGES_FILE),
    })
}

pub(super) fn vault_index_dir(index_dir: &Path, vault_root: &Path) -> PathBuf {
    let canonical = fs::canonicalize(vault_root).unwrap_or_else(|_| vault_root.to_path_buf());
    let digest = crate::services::sha256::sha256_hex(canonical.to_string_lossy().as_bytes());
    index_dir.join("ai-vault").join(&digest[..16])
}

/// A chat file as the index last saw it.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexedFile {
    name: String,
    size: u64,
    /// Nanoseconds since the Unix epoch; 0 when the system cannot tell.
    modified_ns: u128,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatIndex {
    files: Vec<IndexedFile>,
    /// The summary of each file of `files`, in the same order.
    chats: Vec<ChatSummary>,
}

/// The chat files of a folder as they are now.
fn chat_files(chats_dir: &Path) -> Result<Vec<(IndexedFile, PathBuf)>, AppError> {
    let mut files = Vec::new();
    for (name, path) in super::user_files::list_own_files(chats_dir, |name| {
        chat_file_id(Path::new(name)).is_some()
    })? {
        let metadata = match fs::metadata(&path) {
            Ok(metadata) => metadata,
            // removed meanwhile, e.g. by a sync
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.into()),
        };
        let modified_ns = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map_or(0, |duration| duration.as_nanos());
        files.push((
            IndexedFile {
                name,
                size: metadata.len(),
                modified_ns,
            },
            path,
        ));
    }
    Ok(files)
}

fn read_index(path: &Path) -> Option<ChatIndex> {
    let raw = fs::read(path).ok()?;
    let index: ChatIndex = serde_json::from_slice(&raw).ok()?;
    (index.files.len() == index.chats.len()).then_some(index)
}

pub fn list_chats(dirs: &ChatDirs) -> Result<Vec<ChatSummary>, AppError> {
    load_chat_index(dirs)
}

/// The summaries of the chats, the most recent first. A file the index saw
/// as it is now keeps its summary; any other is read again. A file that
/// cannot be parsed, or holds another chat, is set aside rather than listed
/// as a chat that never opens.
fn load_chat_index(dirs: &ChatDirs) -> Result<Vec<ChatSummary>, AppError> {
    let files = chat_files(&dirs.chats)?;
    let stored = read_index(&dirs.index).unwrap_or_default();
    if stored.files.len() == files.len()
        && stored
            .files
            .iter()
            .zip(&files)
            .all(|(indexed, (file, _))| indexed == file)
    {
        return Ok(sorted(stored.chats));
    }
    let known: HashMap<&IndexedFile, &ChatSummary> =
        stored.files.iter().zip(&stored.chats).collect();
    let mut index = ChatIndex::default();
    for (file, path) in files {
        if let Some(summary) = known.get(&file) {
            index.chats.push((*summary).clone());
            index.files.push(file);
            continue;
        }
        // I/O failures do not establish corruption: leave the file untouched
        // and abort rebuilding instead of publishing an incomplete index.
        let raw = match fs::read(&path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.into()),
        };
        match parse_stored_chat(&path, &raw) {
            Ok(chat) => {
                index.chats.push(ChatSummary::from(&chat));
                index.files.push(file);
            }
            Err(error) => {
                log::warn!("Chat file {} is unreadable: {error}", path.display());
                crate::services::atomic_file::quarantine(&path)?;
            }
        }
    }
    // the index is derived: a failure costs a rebuild next time
    if let Err(error) = write_index(&dirs.index, &index) {
        log::warn!("Could not save the chat index: {error}");
    }
    Ok(sorted(index.chats))
}

fn write_index(path: &Path, index: &ChatIndex) -> Result<(), AppError> {
    if let Some(dir) = path.parent() {
        crate::services::atomic_file::create_private_dir(dir)?;
    }
    write_json(path, index)
}

/// Newest first by the last message; a tie keeps a fixed order.
fn sorted(mut chats: Vec<ChatSummary>) -> Vec<ChatSummary> {
    chats.sort_by(|a, b| {
        b.last_message_at_ms
            .cmp(&a.last_message_at_ms)
            .then_with(|| a.id.cmp(&b.id))
    });
    chats
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

fn chat_path(chats_dir: &Path, id: &str) -> Result<PathBuf, AppError> {
    Ok(chats_dir.join(format!("{}.json", validate_chat_id(id)?)))
}

pub fn save_chat(
    dirs: &ChatDirs,
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

    let path = chat_path(&dirs.chats, &chat.id)?;
    let mut history = list_chats(dirs)?;

    images.locked().persist(&dirs.images(), &chat)?;

    // the chat being saved stays, whatever date its last message has
    let mut removed = policy.drop_expired(&mut history, now_ms());
    removed.retain(|id| *id != chat.id);
    let drops_images = !removed.is_empty() || drops_images(&dirs.chats, &chat);
    write_json(&path, &chat)?;
    remove_chat_files(&dirs.chats, &removed)?;
    if drops_images {
        clean_images(dirs);
    }
    Ok(removed)
}

/// Removes the files of the chats `ids`.
fn remove_chat_files(chats_dir: &Path, ids: &[String]) -> Result<(), AppError> {
    for id in ids {
        remove_file_if_exists(&chat_path(chats_dir, id)?)?;
    }
    if !ids.is_empty() {
        crate::services::atomic_file::sync_parent(&chats_dir.join("."))?;
    }
    Ok(())
}

/// Collects the images no chat refers to any more. Collection is the last
/// step of a change: a failure only delays it.
fn clean_images(dirs: &ChatDirs) {
    if let Err(error) =
        crate::services::chat_images::remove_orphan_images(&dirs.chats, &dirs.orphans, now_ms())
    {
        log::warn!("Could not collect unused chat images: {error}");
    }
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

pub fn read_chat(chats_dir: &Path, id: String) -> Result<Option<Chat>, AppError> {
    let path = chat_path(chats_dir, &id)?;
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
/// chat, is set aside the way a rebuild of the index sets it aside, and so
/// leaves the list: it would otherwise stay listed without ever opening.
pub(super) fn open_chat(dirs: &ChatDirs, id: String) -> Result<Option<Chat>, AppError> {
    let path = chat_path(&dirs.chats, &id)?;
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
            clean_images(dirs);
            Ok(None)
        }
    }
}

/// Gives a stored chat another title. Neither its messages nor its place in
/// the list change: a rename is not activity in the chat.
pub fn rename_chat(dirs: &ChatDirs, id: String, title: String) -> Result<(), AppError> {
    let title = validate_chat_title(&title)?;
    // an unreadable chat is set aside and leaves the list, as on opening
    let Some(mut chat) = open_chat(dirs, id.clone())? else {
        return Err(AppError::NotFound(String::from("Chat not found")));
    };
    chat.title = title;
    write_json(&chat_path(&dirs.chats, &id)?, &chat)
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

    /// Drops the chats of `chats_dir` the list no longer has.
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

pub fn delete_chat(dirs: &ChatDirs, id: String) -> Result<(), AppError> {
    remove_chat_files(&dirs.chats, &[id])?;
    clean_images(dirs);
    Ok(())
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
    dirs: &ChatDirs,
    policy: ChatHistoryPolicy,
) -> Result<Vec<String>, AppError> {
    let mut history = list_chats(dirs)?;
    let removed = policy.drop_expired(&mut history, now_ms());
    if removed.is_empty() {
        return Ok(removed);
    }
    remove_chat_files(&dirs.chats, &removed)?;
    clean_images(dirs);
    Ok(removed)
}

/// Removes the chat files, the images and the index.
pub fn clear_chats(dirs: &ChatDirs) -> Result<(), AppError> {
    let images_dir = dirs.images();
    if images_dir.exists() {
        fs::remove_dir_all(images_dir)?;
    }
    for (_, path) in super::user_files::list_own_files(&dirs.chats, |name| {
        chat_file_id(Path::new(name)).is_some()
    })? {
        remove_file_if_exists(&path)?;
    }
    remove_file_if_exists(&dirs.index)
}

fn validate_chat_id(id: &str) -> Result<String, AppError> {
    // `index.json` is the index an earlier version kept among the chats
    let is_safe = crate::services::file_ids::is_file_id(id) && id != "index";

    if !is_safe {
        return Err(AppError::InvalidInput(String::from("Invalid chat id")));
    }

    Ok(id.to_string())
}

#[cfg(test)]
mod tests;
