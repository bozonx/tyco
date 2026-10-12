use super::*;

const CHAT_INDEX_FILE: &str = "index.json";
const CHAT_TRANSACTION_FILE: &str = "chat-transaction.pending";

/// The index and optional chat replacement are committed together. The journal
/// remains until cleanup finishes, so interrupted saves and deletes are replayed.
#[derive(Serialize, Deserialize)]
struct ChatTransaction {
    history: Vec<ChatSummary>,
    chat: Option<Chat>,
}

fn commit_chat_transaction(chats_dir: &Path, transaction: ChatTransaction) -> Result<(), AppError> {
    validate_chat_transaction(&transaction)?;
    write_json(&chats_dir.join(CHAT_TRANSACTION_FILE), &transaction)?;
    recover_chat_transaction(chats_dir)
}

fn validate_chat_transaction(transaction: &ChatTransaction) -> Result<(), AppError> {
    for item in &transaction.history {
        sanitize_chat_id(&item.id)?;
    }
    if let Some(chat) = &transaction.chat {
        sanitize_chat_id(&chat.id)?;
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
    let transaction: ChatTransaction = serde_json::from_slice(&raw)?;
    validate_chat_transaction(&transaction)?;
    if let Some(chat) = transaction.chat {
        let id = sanitize_chat_id(&chat.id)?;
        write_json(&chats_dir.join(format!("{id}.json")), &chat)?;
    }
    write_json(&chats_dir.join(CHAT_INDEX_FILE), &transaction.history)?;
    remove_orphan_chat_files(chats_dir, &transaction.history)?;
    remove_file_if_exists(&journal)?;
    crate::services::atomic_file::sync_parent(&journal)
}

pub fn list_chats(app: &AppHandle) -> Result<Vec<ChatSummary>, AppError> {
    load_chat_index(&app_data_sub_dir(app, "chats")?)
}

/// The index of the chats in `chats_dir`. An index that is missing or cannot
/// be read is built anew from the chat files: the chats are all there, and
/// an empty index would have the next save remove them as orphans.
fn load_chat_index(chats_dir: &Path) -> Result<Vec<ChatSummary>, AppError> {
    recover_chat_transaction(chats_dir)?;
    let index_path = chats_dir.join(CHAT_INDEX_FILE);
    if let Some(history) = read_or_quarantine(&index_path, |raw| Ok(serde_json::from_str(raw)?))? {
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
        let parsed = fs::read_to_string(&path)
            .map_err(AppError::from)
            .and_then(|raw| Ok(serde_json::from_str::<Chat>(&raw)?));
        match parsed {
            Ok(chat) => {
                history.push(ChatSummary::from(&chat));
            }
            Err(error) => {
                log::warn!("Chat file {} is unreadable: {error}", path.display());
                if let Err(error) = crate::services::atomic_file::quarantine(&path) {
                    log::warn!("Could not set {} aside: {error}", path.display());
                }
            }
        }
    }
    history.sort_by(|left, right| right.last_msg_date.cmp(&left.last_msg_date));
    Ok(history)
}

/// The chat id of a chat file: `<id>.json` with a valid id.
fn chat_file_id(path: &Path) -> Option<&str> {
    let name = path.file_name()?.to_str()?;
    let id = name.strip_suffix(".json")?;
    sanitize_chat_id(id).ok().map(|_| id)
}

pub fn chat_image_directory(app: &AppHandle) -> Result<PathBuf, AppError> {
    Ok(app_data_sub_dir(app, "chats")?.join("images"))
}

pub fn save_chat(app: &AppHandle, user_config: &Value, chat: Chat) -> Result<(), AppError> {
    let policy = ChatHistoryPolicy::from_config(user_config);

    if !policy.enabled {
        return Ok(());
    }

    sanitize_chat_id(&chat.id)?;
    let chats_dir = app_data_sub_dir(app, "chats")?;
    let mut history = list_chats(app)?;

    app.state::<crate::state::AppState>()
        .chat_images
        .lock()
        .expect("chat image lock poisoned")
        .persist(&chats_dir.join("images"), &chat)?;

    upsert_chat_index(&mut history, &chat);
    policy.drop_expired(&mut history, now_ms());
    commit_chat_transaction(
        &chats_dir,
        ChatTransaction {
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

pub fn get_chat(app: &AppHandle, id: String) -> Result<Option<Chat>, AppError> {
    let chats_dir = app_data_sub_dir(app, "chats")?;
    let chat_file_path = chats_dir.join(format!("{}.json", sanitize_chat_id(&id)?));

    if !chat_file_path.exists() {
        return Ok(None);
    }

    Ok(Some(read_json(
        &chat_file_path,
        Chat {
            id,
            title: String::new(),
            last_msg_date: String::new(),
            messages: Vec::new(),
        },
    )?))
}

/// Gives a stored chat another title. Neither its messages nor its place in
/// the index change: a rename is not activity in the chat.
pub fn rename_chat(app: &AppHandle, id: String, title: String) -> Result<(), AppError> {
    let chats_dir = app_data_sub_dir(app, "chats")?;
    let mut history = list_chats(app)?;
    let Some(mut chat) = get_chat(app, id.clone())? else {
        return Err(AppError::Message(String::from("Chat not found")));
    };
    chat.title = title;
    rename_in_chat_index(&mut history, &id, &chat.title);
    commit_chat_transaction(
        &chats_dir,
        ChatTransaction {
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
    app: &AppHandle,
    history: Vec<ChatSummary>,
    query: String,
) -> Result<Vec<String>, AppError> {
    let mut found = Vec::new();

    for item in history {
        let matches = match get_chat(app, item.id.clone()) {
            Ok(Some(chat)) => chat_matches(&chat, &query),
            _ => item
                .title
                .to_lowercase()
                .contains(&query.trim().to_lowercase()),
        };
        if matches {
            found.push(item.id);
        }
    }

    Ok(found)
}

fn chat_matches(chat: &Chat, query: &str) -> bool {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return true;
    }

    chat.title.to_lowercase().contains(&query)
        || chat
            .messages
            .iter()
            .any(|message| message.content.to_lowercase().contains(&query))
}

pub fn delete_chat(app: &AppHandle, id: String) -> Result<(), AppError> {
    sanitize_chat_id(&id)?;
    let chats_dir = app_data_sub_dir(app, "chats")?;
    let mut history = list_chats(app)?;
    history.retain(|item| item.id != id);
    commit_chat_transaction(
        &chats_dir,
        ChatTransaction {
            history,
            chat: None,
        },
    )
}

/// What the settings say about the chat history.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChatHistoryPolicy {
    /// Chats are saved at all.
    pub enabled: bool,
    /// Chats without a message for this many days are dropped; 0 keeps them
    /// forever.
    pub retention_days: u64,
}

impl ChatHistoryPolicy {
    pub fn from_config(user_config: &Value) -> Self {
        Self {
            enabled: user_config
                .get("chatHistoryEnabled")
                .and_then(Value::as_bool)
                .unwrap_or(true),
            retention_days: user_config
                .get("chatHistoryRetentionDays")
                .and_then(Value::as_u64)
                .unwrap_or(0),
        }
    }

    /// Drops the chats whose last message is older than the retention period.
    /// A chat with a date that cannot be read is kept: nothing says it is old.
    fn drop_expired(&self, history: &mut Vec<ChatSummary>, now_ms: u64) {
        if self.retention_days == 0 {
            return;
        }
        let cutoff = now_ms.saturating_sub(self.retention_days.saturating_mul(DAY_MS));
        history.retain(|item| parse_iso_utc_ms(&item.last_msg_date).is_none_or(|ms| ms >= cutoff));
    }
}

/// Milliseconds since the epoch of an ISO 8601 UTC date as
/// `Date.toISOString()` writes it: `2026-10-09T12:30:00.000Z`. Fractions of a
/// second are optional.
fn parse_iso_utc_ms(value: &str) -> Option<u64> {
    let value = value.trim().strip_suffix('Z')?;
    let (date, time) = value.split_once('T')?;
    let mut date_parts = date.splitn(3, '-').map(str::parse::<i64>);
    let (year, month, day) = (
        date_parts.next()?.ok()?,
        date_parts.next()?.ok()?,
        date_parts.next()?.ok()?,
    );
    let (time, fraction) = time.split_once('.').unwrap_or((time, ""));
    let mut time_parts = time.splitn(3, ':').map(str::parse::<i64>);
    let (hour, minute, second) = (
        time_parts.next()?.ok()?,
        time_parts.next()?.ok()?,
        time_parts.next()?.ok()?,
    );
    let valid = (1..=12).contains(&month)
        && (1..=31).contains(&day)
        && (0..24).contains(&hour)
        && (0..60).contains(&minute)
        && (0..=60).contains(&second);
    if !valid {
        return None;
    }
    let millis = if fraction.is_empty() {
        0
    } else {
        if !fraction.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        format!("{fraction:0<3}")[..3].parse::<i64>().ok()?
    };

    // days from the civil date, after Howard Hinnant's algorithm
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let month_index = (month + 9) % 12;
    let day_of_year = (153 * month_index + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    let days = era * 146_097 + day_of_era - 719_468;

    let seconds = days * 86_400 + hour * 3_600 + minute * 60 + second;
    u64::try_from(seconds * 1_000 + millis).ok()
}

/// Brings the stored chats in line with the settings: all of them go when the
/// history is off, the expired ones otherwise.
pub(super) fn enforce_chat_history_policy(
    app: &AppHandle,
    policy: ChatHistoryPolicy,
) -> Result<(), AppError> {
    if !policy.enabled {
        return clear_chats(app);
    }

    let mut history = list_chats(app)?;
    let count = history.len();
    policy.drop_expired(&mut history, now_ms());
    if history.len() == count {
        return Ok(());
    }

    let chats_dir = app_data_sub_dir(app, "chats")?;
    commit_chat_transaction(
        &chats_dir,
        ChatTransaction {
            history,
            chat: None,
        },
    )
}

/// Removes the index, chat files, and persisted image bytes.
pub fn clear_chats(app: &AppHandle) -> Result<(), AppError> {
    let chats_dir = app_data_sub_dir(app, "chats")?;
    recover_chat_transaction(&chats_dir)?;
    commit_chat_transaction(
        &chats_dir,
        ChatTransaction {
            history: Vec::new(),
            chat: None,
        },
    )?;
    let images_dir = chats_dir.join("images");
    if images_dir.exists() {
        fs::remove_dir_all(images_dir)?;
    }

    for entry in fs::read_dir(&chats_dir)?.flatten() {
        let path = entry.path();
        if path.is_file() {
            remove_file_if_exists(&path)?;
        }
    }

    Ok(())
}

fn sanitize_chat_id(id: &str) -> Result<String, AppError> {
    // "index" would name the index file
    let is_safe = !id.is_empty()
        && id != "index"
        && id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_');

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

    crate::services::chat_images::collect_orphans(chats_dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    fn temp_dir(label: &str) -> PathBuf {
        static COUNTER: AtomicU32 = AtomicU32::new(0);

        let unique = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "tyco-storage-test-{}-{}-{}",
            label,
            std::process::id(),
            unique
        ));

        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("failed to create the temp dir");

        dir
    }

    fn chat_item(id: &str) -> Chat {
        Chat {
            id: id.to_string(),
            title: String::from("chat"),
            last_msg_date: String::from("0"),
            messages: Vec::new(),
        }
    }

    #[test]
    fn an_interrupted_save_replays_before_orphan_cleanup() {
        let dir = temp_dir("interrupted-save");
        let old = chat_item("old");
        let new = chat_item("new");
        write_json(&dir.join(CHAT_INDEX_FILE), &vec![old.clone()]).unwrap();
        write_json(&dir.join("old.json"), &old).unwrap();
        let journal = ChatTransaction {
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
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn an_interrupted_delete_is_not_resurrected_by_index_recovery() {
        let dir = temp_dir("interrupted-delete");
        let chat = chat_item("removed");
        write_json(&dir.join("removed.json"), &chat).unwrap();
        write_json(
            &dir.join(CHAT_TRANSACTION_FILE),
            &ChatTransaction {
                history: Vec::new(),
                chat: None,
            },
        )
        .unwrap();
        assert!(load_chat_index(&dir).unwrap().is_empty());
        assert!(!dir.join("removed.json").exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn an_invalid_save_cannot_leave_a_journal_that_blocks_other_chats() {
        let dir = temp_dir("invalid-save");
        let transaction = ChatTransaction {
            history: vec![ChatSummary::from(&chat_item("../invalid"))],
            chat: None,
        };
        assert!(commit_chat_transaction(&dir, transaction).is_err());
        assert!(!dir.join(CHAT_TRANSACTION_FILE).exists());
        assert!(load_chat_index(&dir).unwrap().is_empty());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_journal_replays_even_if_no_chat_file_was_written_yet() {
        let dir = temp_dir("journal-only");
        let chat = chat_item("new");
        write_json(
            &dir.join(CHAT_TRANSACTION_FILE),
            &ChatTransaction {
                history: vec![ChatSummary::from(&chat)],
                chat: Some(chat),
            },
        )
        .unwrap();
        assert_eq!(load_chat_index(&dir).unwrap()[0].id, "new");
        assert!(dir.join("new.json").exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_broken_transaction_never_runs_orphan_cleanup() {
        let dir = temp_dir("broken-transaction");
        write_json(&dir.join("kept.json"), &chat_item("kept")).unwrap();
        fs::write(dir.join(CHAT_TRANSACTION_FILE), "{").unwrap();
        assert!(load_chat_index(&dir).is_err());
        assert!(dir.join("kept.json").exists());
        fs::remove_dir_all(dir).unwrap();
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
            status: None,
        }];

        assert!(chat_matches(&chat, "trip"));
        assert!(chat_matches(&chat, " билеты "));
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
    fn parse_iso_utc_ms_reads_the_dates_the_webview_writes() {
        assert_eq!(parse_iso_utc_ms("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(
            parse_iso_utc_ms("2026-10-09T12:30:15.250Z"),
            Some(1_791_549_015_250)
        );
        assert_eq!(
            parse_iso_utc_ms("2000-02-29T00:00:00Z"),
            Some(951_782_400_000)
        );
        assert_eq!(
            parse_iso_utc_ms("2026-10-09T12:30:15.5Z"),
            Some(1_791_549_015_500)
        );
        assert_eq!(parse_iso_utc_ms("0"), None);
        assert_eq!(parse_iso_utc_ms("2026-13-01T00:00:00Z"), None);
        assert_eq!(parse_iso_utc_ms("2026-10-09T12:30:15+03:00"), None);
    }

    #[test]
    fn chat_history_policy_reads_the_settings() {
        assert_eq!(
            ChatHistoryPolicy::from_config(&json!({})),
            ChatHistoryPolicy {
                enabled: true,
                retention_days: 0,
            }
        );
        assert_eq!(
            ChatHistoryPolicy::from_config(&json!({
                "chatHistoryEnabled": false,
                "chatHistoryRetentionDays": 30,
            })),
            ChatHistoryPolicy {
                enabled: false,
                retention_days: 30,
            }
        );
    }

    #[test]
    fn chat_history_policy_drops_the_chats_past_the_retention_period() {
        let dated = |id: &str, date: &str| {
            let mut chat = chat_item(id);
            chat.last_msg_date = date.to_string();
            chat
        };
        let mut history = vec![
            ChatSummary::from(&dated("fresh", "2026-10-08T00:00:00.000Z")),
            ChatSummary::from(&dated("old", "2026-09-01T00:00:00.000Z")),
            ChatSummary::from(&dated("undated", "unknown")),
        ];
        let now = parse_iso_utc_ms("2026-10-09T00:00:00.000Z").unwrap();
        let policy = |retention_days| ChatHistoryPolicy {
            enabled: true,
            retention_days,
        };

        policy(0).drop_expired(&mut history, now);
        assert_eq!(history.len(), 3);

        policy(30).drop_expired(&mut history, now);
        let ids: Vec<_> = history.iter().map(|item| item.id.as_str()).collect();
        assert_eq!(ids, ["fresh", "undated"]);
    }

    #[test]
    fn a_lost_or_broken_index_is_rebuilt_from_the_chat_files() {
        let dir = temp_dir("rebuild");
        let mut older = chat_item("older");
        older.last_msg_date = String::from("2026-01-01T00:00:00.000Z");
        let mut newer = chat_item("newer");
        newer.last_msg_date = String::from("2026-02-01T00:00:00.000Z");
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

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn sanitize_chat_id_rejects_path_traversal() {
        assert!(sanitize_chat_id("../../etc/passwd").is_err());
        assert!(sanitize_chat_id("chat/id").is_err());
        assert!(sanitize_chat_id("").is_err());
        assert!(sanitize_chat_id("index").is_err());
        assert_eq!(sanitize_chat_id("chat-1_A").unwrap(), "chat-1_A");
    }

    #[test]
    fn remove_orphan_chat_files_keeps_active_chats_and_the_index() {
        let dir = temp_dir("orphans");
        fs::write(dir.join("index.json"), "[]").unwrap();
        fs::write(dir.join("kept.json"), "{}").unwrap();
        fs::write(dir.join("orphan.json"), "{}").unwrap();
        fs::write(dir.join("index.json.broken-1"), "[").unwrap();

        remove_orphan_chat_files(&dir, &[ChatSummary::from(&chat_item("kept"))]).unwrap();

        assert!(dir.join("index.json").exists());
        assert!(dir.join("kept.json").exists());
        assert!(!dir.join("orphan.json").exists());
        assert!(dir.join("index.json.broken-1").exists());

        fs::remove_dir_all(&dir).unwrap();
    }
}
