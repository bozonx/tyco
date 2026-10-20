use crate::locks::MutexExt;
use std::sync::Mutex;

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use super::json_files::{read_json, remove_file_if_exists, write_json};
use super::paths::app_data_sub_dir;
use super::DAY_MS;
use crate::errors::AppError;
use crate::models::{Chat, ChatSummary};
use crate::services::atomic_file::read_or_quarantine;
use crate::services::clock::now_ms;

use crate::services::chat_images::ChatImageStore;

const CHAT_INDEX_FILE: &str = "index.json";
const CHAT_TRANSACTION_FILE: &str = "chat-transaction.pending";

/// The index and optional chat replacement are committed together. The journal
/// remains until cleanup finishes, so interrupted saves and deletes are replayed.
#[derive(Serialize, Deserialize)]
struct PendingChatTransaction {
    history: Vec<ChatSummary>,
    chat: Option<Chat>,
}

fn commit_chat_transaction(
    chats_dir: &Path,
    transaction: PendingChatTransaction,
) -> Result<(), AppError> {
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
    Ok(())
}

pub(super) fn recover_chat_transaction(chats_dir: &Path) -> Result<(), AppError> {
    let journal = chats_dir.join(CHAT_TRANSACTION_FILE);
    let raw = match fs::read(&journal) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    // A damaged journal is an error, never permission to delete stored chats.
    let transaction: PendingChatTransaction = serde_json::from_slice(&raw)?;
    validate_chat_transaction(&transaction)?;
    if let Some(chat) = transaction.chat {
        let id = validate_chat_id(&chat.id)?;
        write_json(&chats_dir.join(format!("{id}.json")), &chat)?;
    }
    write_json(&chats_dir.join(CHAT_INDEX_FILE), &transaction.history)?;
    remove_orphan_chat_files(chats_dir, &transaction.history)?;
    remove_file_if_exists(&journal)?;
    crate::services::atomic_file::sync_parent(&journal)
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
    for entry in fs::read_dir(chats_dir)? {
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
    chat: Chat,
) -> Result<(), AppError> {
    if !policy.is_enabled {
        return Ok(());
    }

    validate_chat_id(&chat.id)?;
    let mut history = list_chats(chats_dir)?;

    images
        .locked()
        .persist(&chat_image_directory(chats_dir), &chat)?;

    upsert_chat_index(&mut history, &chat);
    policy.drop_expired(&mut history, now_ms());
    commit_chat_transaction(
        chats_dir,
        PendingChatTransaction {
            history,
            chat: Some(chat),
        },
    )
}

/// Puts the chat on top of the index, without its messages to keep the index
/// small. The chat just written is the most recent one, also when it existed
/// before.
fn upsert_chat_index(history: &mut Vec<ChatSummary>, chat: &Chat) {
    let index_item = ChatSummary::from(chat);
    history.retain(|item| item.id != index_item.id);
    history.insert(0, index_item);
}

pub fn read_chat(chats_dir: &Path, id: String) -> Result<Option<Chat>, AppError> {
    let chat_file_path = chats_dir.join(format!("{}.json", validate_chat_id(&id)?));

    if !chat_file_path.exists() {
        return Ok(None);
    }

    let chat = read_json(
        &chat_file_path,
        Chat {
            id,
            title: String::new(),
            last_message_at_ms: 0,
            messages: Vec::new(),
        },
    )?;
    validate_stored_chat_id(&chat_file_path, &chat)?;
    Ok(Some(chat))
}

/// Gives a stored chat another title. Neither its messages nor its place in
/// the index change: a rename is not activity in the chat.
pub fn rename_chat(chats_dir: &Path, id: String, title: String) -> Result<(), AppError> {
    let mut history = list_chats(chats_dir)?;
    let Some(mut chat) = read_chat(chats_dir, id.clone())? else {
        return Err(AppError::NotFound(String::from("Chat not found")));
    };
    chat.title = title;
    rename_in_chat_index(&mut history, &id, &chat.title);
    commit_chat_transaction(
        chats_dir,
        PendingChatTransaction {
            history,
            chat: Some(chat),
        },
    )
}

fn rename_in_chat_index(history: &mut [ChatSummary], id: &str, title: &str) {
    if let Some(item) = history.iter_mut().find(|item| item.id == id) {
        item.title = title.to_string();
    }
}

/// Ids of the chats whose title or messages contain `query`, in index order.
/// The index holds no messages, so each chat file is read.
pub(super) fn search_chats(
    chats_dir: &Path,
    history: Vec<ChatSummary>,
    query: String,
) -> Result<Vec<String>, AppError> {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return Ok(history.into_iter().map(|item| item.id).collect());
    }
    let mut found = Vec::new();
    for item in history {
        let matches = match read_chat(chats_dir, item.id.clone()) {
            Ok(Some(chat)) => chat_matches(&chat, &query),
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

/// `query` is trimmed, lowercase and not empty.
fn chat_matches(chat: &Chat, query: &str) -> bool {
    chat.title.to_lowercase().contains(query)
        || chat
            .messages
            .iter()
            .any(|message| message.content.to_lowercase().contains(query))
}

pub fn delete_chat(chats_dir: &Path, id: String) -> Result<(), AppError> {
    validate_chat_id(&id)?;
    let mut history = list_chats(chats_dir)?;
    history.retain(|item| item.id != id);
    commit_chat_transaction(
        chats_dir,
        PendingChatTransaction {
            history,
            chat: None,
        },
    )
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
    pub fn from_config(user_config: &Value) -> Self {
        Self {
            is_enabled: user_config
                .pointer("/chat/history/storage")
                .and_then(Value::as_str)
                != Some("off"),
            retention_days: user_config
                .pointer("/chat/history/retentionDays")
                .and_then(Value::as_u64)
                .unwrap_or(0),
        }
    }

    /// Drops the chats whose last message is older than the retention period.
    fn drop_expired(&self, history: &mut Vec<ChatSummary>, now_ms: u64) {
        if self.retention_days == 0 {
            return;
        }
        let cutoff = now_ms.saturating_sub(self.retention_days.saturating_mul(DAY_MS));
        history.retain(|item| item.last_message_at_ms >= cutoff);
    }
}

/// Brings the stored chats in line with the settings: all of them go when the
/// history is off, the expired ones otherwise.
pub(super) fn enforce_chat_history_policy(
    chats_dir: &Path,
    policy: ChatHistoryPolicy,
) -> Result<(), AppError> {
    if !policy.is_enabled {
        return clear_chats(chats_dir);
    }

    let mut history = list_chats(chats_dir)?;
    let count = history.len();
    policy.drop_expired(&mut history, now_ms());
    if history.len() == count {
        return Ok(());
    }

    commit_chat_transaction(
        chats_dir,
        PendingChatTransaction {
            history,
            chat: None,
        },
    )
}

/// Removes the index, chat files, and persisted image bytes.
pub fn clear_chats(chats_dir: &Path) -> Result<(), AppError> {
    recover_chat_transaction(chats_dir)?;
    commit_chat_transaction(
        chats_dir,
        PendingChatTransaction {
            history: Vec::new(),
            chat: None,
        },
    )?;
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
        let orphan = chat_file_id(&path).is_some_and(|id| !active_ids.contains(id));
        if orphan && path.is_file() {
            fs::remove_file(&path)?;
        }
    }
    crate::services::atomic_file::sync_parent(&chats_dir.join(CHAT_INDEX_FILE))?;

    crate::services::chat_images::remove_orphan_images(chats_dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::storage::test_support::TestDir;
    use serde_json::json;

    fn chat_item(id: &str) -> Chat {
        Chat {
            id: id.to_string(),
            title: String::from("chat"),
            last_message_at_ms: 0,
            messages: Vec::new(),
        }
    }

    fn enabled_policy() -> ChatHistoryPolicy {
        ChatHistoryPolicy {
            is_enabled: true,
            retention_days: 0,
        }
    }

    #[test]
    fn any_folder_keeps_its_own_chat_history() {
        let dir = TestDir::new("chat-history-folder");
        let ask_dir = dir.join("chats");
        let profile_dir = dir.join("profile-chats");
        fs::create_dir_all(&ask_dir).unwrap();
        fs::create_dir_all(&profile_dir).unwrap();
        let images = Mutex::new(ChatImageStore::default());

        save_chat(
            &profile_dir,
            enabled_policy(),
            &images,
            chat_item("profile"),
        )
        .unwrap();

        assert!(list_chats(&ask_dir).unwrap().is_empty());
        let history = list_chats(&profile_dir).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].id, "profile");

        rename_chat(&profile_dir, "profile".into(), "Renamed".into()).unwrap();
        let chat = read_chat(&profile_dir, "profile".into()).unwrap().unwrap();
        assert_eq!(chat.title, "Renamed");
        assert_eq!(
            search_chats(
                &profile_dir,
                list_chats(&profile_dir).unwrap(),
                "renamed".into()
            )
            .unwrap(),
            vec!["profile"]
        );

        delete_chat(&profile_dir, "profile".into()).unwrap();
        assert!(list_chats(&profile_dir).unwrap().is_empty());
        assert!(!profile_dir.join("profile.json").exists());
    }

    #[test]
    fn search_normalizes_the_query_once_and_an_empty_one_lists_every_chat() {
        let dir = TestDir::new("chat-search");
        let images = Mutex::new(ChatImageStore::default());
        let mut trip = chat_item("trip");
        trip.title = String::from("Trip plan");
        save_chat(&dir, enabled_policy(), &images, trip).unwrap();
        save_chat(&dir, enabled_policy(), &images, chat_item("other")).unwrap();
        let search = |query: &str| {
            let mut found = search_chats(&dir, list_chats(&dir).unwrap(), query.into()).unwrap();
            found.sort();
            found
        };

        assert_eq!(search("  TRIP "), vec!["trip"]);
        assert_eq!(search("   "), vec!["other", "trip"]);
    }

    #[test]
    fn a_disabled_history_stores_no_chat_in_any_folder() {
        let dir = TestDir::new("chat-history-disabled");
        let images = Mutex::new(ChatImageStore::default());
        let policy = ChatHistoryPolicy {
            is_enabled: false,
            retention_days: 0,
        };

        save_chat(&dir, policy, &images, chat_item("chat")).unwrap();

        assert!(list_chats(&dir).unwrap().is_empty());
        assert!(!dir.join("chat.json").exists());
    }

    #[test]
    fn an_interrupted_save_replays_before_orphan_cleanup() {
        let dir = TestDir::new("interrupted-save");
        let old = chat_item("old");
        let new = chat_item("new");
        write_json(&dir.join(CHAT_INDEX_FILE), &vec![old.clone()]).unwrap();
        write_json(&dir.join("old.json"), &old).unwrap();
        let journal = PendingChatTransaction {
            history: vec![ChatSummary::from(&new), ChatSummary::from(&old)],
            chat: Some(new.clone()),
        };
        write_json(&dir.join(CHAT_TRANSACTION_FILE), &journal).unwrap();
        // The process stopped after the chat was written but before the index.
        write_json(&dir.join("new.json"), &new).unwrap();
        let history = load_chat_index(&dir).unwrap();
        assert_eq!(
            history
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            ["new", "old"]
        );
        remove_orphan_chat_files(&dir, &history).unwrap();
        assert!(dir.join("new.json").exists());
        assert!(!dir.join(CHAT_TRANSACTION_FILE).exists());
    }

    #[test]
    fn cleanup_failure_after_index_commit_replays_without_resurrecting_chats() {
        let dir = TestDir::new("failed-chat-cleanup");
        let chat = chat_item("removed");
        write_json(&dir.join("removed.json"), &chat).unwrap();
        write_json(&dir.join(CHAT_INDEX_FILE), &vec![ChatSummary::from(&chat)]).unwrap();
        // An invalid image directory fails cleanup after the new index is durable.
        fs::write(dir.join("images"), "blocked").unwrap();
        assert!(commit_chat_transaction(
            &dir,
            PendingChatTransaction {
                history: Vec::new(),
                chat: None
            }
        )
        .is_err());
        assert!(!dir.join("removed.json").exists());
        assert!(dir.join(CHAT_TRANSACTION_FILE).exists());
        let index: Vec<ChatSummary> =
            serde_json::from_slice(&fs::read(dir.join(CHAT_INDEX_FILE)).unwrap()).unwrap();
        assert!(index.is_empty());
        fs::remove_file(dir.join("images")).unwrap();
        assert!(load_chat_index(&dir).unwrap().is_empty());
        assert!(!dir.join(CHAT_TRANSACTION_FILE).exists());
    }

    #[test]
    fn an_interrupted_delete_is_not_resurrected_by_index_recovery() {
        let dir = TestDir::new("interrupted-delete");
        let chat = chat_item("removed");
        write_json(&dir.join("removed.json"), &chat).unwrap();
        write_json(
            &dir.join(CHAT_TRANSACTION_FILE),
            &PendingChatTransaction {
                history: Vec::new(),
                chat: None,
            },
        )
        .unwrap();
        assert!(load_chat_index(&dir).unwrap().is_empty());
        assert!(!dir.join("removed.json").exists());
    }

    #[test]
    fn an_invalid_save_cannot_leave_a_journal_that_blocks_other_chats() {
        let dir = TestDir::new("invalid-save");
        let transaction = PendingChatTransaction {
            history: vec![ChatSummary::from(&chat_item("../invalid"))],
            chat: None,
        };
        assert!(commit_chat_transaction(&dir, transaction).is_err());
        assert!(!dir.join(CHAT_TRANSACTION_FILE).exists());
        assert!(load_chat_index(&dir).unwrap().is_empty());
    }

    #[test]
    fn a_journal_replays_even_if_no_chat_file_was_written_yet() {
        let dir = TestDir::new("journal-only");
        let chat = chat_item("new");
        write_json(
            &dir.join(CHAT_TRANSACTION_FILE),
            &PendingChatTransaction {
                history: vec![ChatSummary::from(&chat)],
                chat: Some(chat),
            },
        )
        .unwrap();
        assert_eq!(load_chat_index(&dir).unwrap()[0].id, "new");
        assert!(dir.join("new.json").exists());
    }

    #[test]
    fn a_broken_transaction_never_runs_orphan_cleanup() {
        let dir = TestDir::new("broken-transaction");
        write_json(&dir.join("kept.json"), &chat_item("kept")).unwrap();
        fs::write(dir.join(CHAT_TRANSACTION_FILE), "{").unwrap();
        assert!(load_chat_index(&dir).is_err());
        assert!(dir.join("kept.json").exists());
    }

    #[test]
    fn rename_in_chat_index_keeps_the_order() {
        let mut history = vec![
            ChatSummary::from(&chat_item("a")),
            ChatSummary::from(&chat_item("b")),
        ];

        rename_in_chat_index(&mut history, "b", "renamed");

        assert_eq!(history[0].id, "a");
        assert_eq!(history[1].id, "b");
        assert_eq!(history[1].title, "renamed");
    }

    #[test]
    fn chat_matches_the_title_and_the_messages_ignoring_case() {
        let mut chat = chat_item("a");
        chat.title = String::from("Trip plan");
        chat.messages = vec![crate::models::ChatMessage {
            role: crate::models::ChatRole::User,
            content: String::from("Где купить БИЛЕТЫ?"),
            attachments: Vec::new(),
            images: Vec::new(),
            parts: vec![],
            status: None,
        }];

        assert!(chat_matches(&chat, "trip"));
        assert!(chat_matches(&chat, "билеты"));
        assert!(!chat_matches(&chat, "hotel"));
    }

    #[test]
    fn upsert_chat_index_moves_an_updated_chat_to_the_top() {
        let mut history = vec![
            ChatSummary::from(&chat_item("a")),
            ChatSummary::from(&chat_item("b")),
            ChatSummary::from(&chat_item("c")),
        ];
        let mut updated = chat_item("c");
        updated.title = String::from("updated");

        upsert_chat_index(&mut history, &updated);

        let ids: Vec<_> = history.iter().map(|item| item.id.as_str()).collect();
        assert_eq!(ids, ["c", "a", "b"]);
        assert_eq!(history[0].title, "updated");
        assert!(serde_json::to_value(&history[0])
            .unwrap()
            .get("messages")
            .is_none());
    }

    #[test]
    fn chat_history_policy_reads_the_settings() {
        assert_eq!(
            ChatHistoryPolicy::from_config(&json!({})),
            ChatHistoryPolicy {
                is_enabled: true,
                retention_days: 0,
            }
        );
        assert_eq!(
            ChatHistoryPolicy::from_config(
                &json!({"chat":{"history":{"storage":"off","retentionDays":30}}})
            ),
            ChatHistoryPolicy {
                is_enabled: false,
                retention_days: 30,
            }
        );
    }

    #[test]
    fn chat_history_policy_drops_the_chats_past_the_retention_period() {
        let now = 1_791_504_000_000;
        let dated = |id: &str, days_ago: u64| {
            let mut chat = chat_item(id);
            chat.last_message_at_ms = now - days_ago * DAY_MS;
            chat
        };
        let mut history = vec![
            ChatSummary::from(&dated("fresh", 1)),
            ChatSummary::from(&dated("old", 38)),
            ChatSummary::from(&dated("recent", 29)),
        ];
        let policy = |retention_days| ChatHistoryPolicy {
            is_enabled: true,
            retention_days,
        };

        policy(0).drop_expired(&mut history, now);
        assert_eq!(history.len(), 3);

        policy(30).drop_expired(&mut history, now);
        let ids: Vec<_> = history.iter().map(|item| item.id.as_str()).collect();
        assert_eq!(ids, ["fresh", "recent"]);
    }

    #[cfg(unix)]
    #[test]
    fn rebuilding_does_not_quarantine_a_chat_that_cannot_be_read() {
        use std::os::unix::fs::PermissionsExt;
        let dir = TestDir::new("rebuild-permission-denied");
        let path = dir.join("unreadable.json");
        let chat = chat_item("unreadable");
        write_json(&path, &chat).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).unwrap();
        let result = load_chat_index(&dir);
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        assert!(
            matches!(result, Err(AppError::Io(error)) if error.kind() == std::io::ErrorKind::PermissionDenied)
        );
        assert_eq!(
            read_chat(&dir, "unreadable".into()).unwrap().unwrap().id,
            "unreadable"
        );
        assert!(!dir.join(CHAT_INDEX_FILE).exists());
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
    }

    #[test]
    fn a_lost_or_broken_index_is_rebuilt_from_the_chat_files() {
        let dir = TestDir::new("rebuild");
        let mut older = chat_item("older");
        older.last_message_at_ms = 1_767_225_600_000;
        let mut newer = chat_item("newer");
        newer.last_message_at_ms = 1_769_904_000_000;
        for chat in [&older, &newer] {
            write_json(&dir.join(format!("{}.json", chat.id)), chat).unwrap();
        }
        fs::write(dir.join("broken.json"), "{").unwrap();

        let ids =
            |history: Vec<ChatSummary>| history.into_iter().map(|item| item.id).collect::<Vec<_>>();
        assert_eq!(ids(load_chat_index(&dir).unwrap()), ["newer", "older"]);
        assert!(
            !dir.join("broken.json").exists(),
            "set aside, not left as an orphan"
        );

        fs::write(dir.join(CHAT_INDEX_FILE), "[{").unwrap();
        assert_eq!(ids(load_chat_index(&dir).unwrap()), ["newer", "older"]);
        assert_eq!(ids(load_chat_index(&dir).unwrap()), ["newer", "older"]);
    }

    #[test]
    fn rebuilding_quarantines_mismatched_ids_without_losing_their_bytes() {
        let dir = TestDir::new("mismatched-ids");
        let chat = chat_item("different-id");
        write_json(&dir.join("original-id.json"), &chat).unwrap();
        let original_bytes = fs::read(dir.join("original-id.json")).unwrap();
        assert!(load_chat_index(&dir).unwrap().is_empty());
        assert!(!dir.join("original-id.json").exists());
        let quarantined = fs::read_dir(&dir)
            .unwrap()
            .find_map(|entry| {
                let path = entry.unwrap().path();
                path.file_name()
                    .unwrap()
                    .to_str()
                    .unwrap()
                    .starts_with("original-id.json.broken-")
                    .then_some(path)
            })
            .unwrap();
        assert_eq!(fs::read(&quarantined).unwrap(), original_bytes);
        let valid = chat_item("valid");
        write_json(&dir.join("valid.json"), &valid).unwrap();
        let history = load_chat_index(&dir).unwrap();
        remove_orphan_chat_files(&dir, &history).unwrap();
        assert_eq!(fs::read(quarantined).unwrap(), original_bytes);
        assert_eq!(history[0].id, "valid");
    }

    #[test]
    fn invalid_index_ids_trigger_recovery_from_valid_chat_files() {
        let dir = TestDir::new("invalid-index-ids");
        write_json(&dir.join("valid.json"), &chat_item("valid")).unwrap();
        write_json(
            &dir.join(CHAT_INDEX_FILE),
            &vec![ChatSummary::from(&chat_item("../invalid"))],
        )
        .unwrap();
        assert_eq!(load_chat_index(&dir).unwrap()[0].id, "valid");
    }

    #[test]
    fn stored_chat_ids_must_match_their_filename() {
        assert!(
            validate_stored_chat_id(Path::new("original.json"), &chat_item("different")).is_err()
        );
        assert!(
            validate_stored_chat_id(Path::new("original.json"), &chat_item("../invalid")).is_err()
        );
        assert!(
            validate_stored_chat_id(Path::new("original.json"), &chat_item("original")).is_ok()
        );
    }

    #[test]
    fn validate_chat_id_rejects_path_traversal() {
        assert!(validate_chat_id("../../etc/passwd").is_err());
        assert!(validate_chat_id("chat/id").is_err());
        assert!(validate_chat_id("").is_err());
        assert!(validate_chat_id("index").is_err());
        assert_eq!(validate_chat_id("chat-1_A").unwrap(), "chat-1_A");
    }

    #[test]
    fn remove_orphan_chat_files_keeps_active_chats_and_the_index() {
        let dir = TestDir::new("orphans");
        fs::write(dir.join("index.json"), "[]").unwrap();
        fs::write(dir.join("kept.json"), "{}").unwrap();
        fs::write(dir.join("orphan.json"), "{}").unwrap();
        fs::write(dir.join("index.json.broken-1"), "[").unwrap();

        remove_orphan_chat_files(&dir, &[ChatSummary::from(&chat_item("kept"))]).unwrap();

        assert!(dir.join("index.json").exists());
        assert!(dir.join("kept.json").exists());
        assert!(!dir.join("orphan.json").exists());
        assert!(dir.join("index.json.broken-1").exists());
    }
}
