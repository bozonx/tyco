use super::*;

pub fn get_chat_history(app: &AppHandle) -> Result<Vec<ChatHistoryItem>, AppError> {
    read_json(
        &app_data_sub_dir(app, "chats")?.join("index.json"),
        Vec::<ChatHistoryItem>::new(),
    )
}

pub fn chat_image_directory(app: &AppHandle) -> Result<PathBuf, AppError> {
    Ok(app_data_sub_dir(app, "chats")?.join("images"))
}

pub fn save_chat_history(
    app: &AppHandle,
    user_config: &Value,
    chat_history_item: ChatHistoryItem,
) -> Result<(), AppError> {
    let policy = ChatHistoryPolicy::from_config(user_config);

    if !policy.enabled {
        return Ok(());
    }

    let chats_dir = app_data_sub_dir(app, "chats")?;
    let mut history = get_chat_history(app)?;

    app.state::<crate::state::AppState>()
        .chat_images
        .lock()
        .expect("chat image lock poisoned")
        .persist(&chats_dir.join("images"), &chat_history_item)?;

    // Save full chat to its own file
    let chat_file_path =
        chats_dir.join(format!("{}.json", sanitize_chat_id(&chat_history_item.id)?));
    write_json(&chat_file_path, &chat_history_item)?;

    upsert_chat_index(&mut history, &chat_history_item);
    policy.drop_expired(&mut history, now_ms());
    write_json(&chats_dir.join("index.json"), &history)?;
    remove_orphan_chat_files(&chats_dir, &history)
}

/// Puts the chat on top of the index, without its messages to keep the index
/// small. The chat just written is the most recent one, also when it existed
/// before.
fn upsert_chat_index(history: &mut Vec<ChatHistoryItem>, chat: &ChatHistoryItem) {
    let mut index_item = chat.clone();
    index_item.messages = Vec::new();
    history.retain(|item| item.id != index_item.id);
    history.insert(0, index_item);
}

pub fn get_chat(app: &AppHandle, id: String) -> Result<Option<ChatHistoryItem>, AppError> {
    let chats_dir = app_data_sub_dir(app, "chats")?;
    let chat_file_path = chats_dir.join(format!("{}.json", sanitize_chat_id(&id)?));

    if !chat_file_path.exists() {
        return Ok(None);
    }

    Ok(Some(read_json(
        &chat_file_path,
        ChatHistoryItem {
            id,
            description: String::new(),
            last_msg_date: String::new(),
            messages: Vec::new(),
        },
    )?))
}

/// Gives a stored chat another title. Neither its messages nor its place in
/// the index change: a rename is not activity in the chat.
pub fn rename_chat(app: &AppHandle, id: String, description: String) -> Result<(), AppError> {
    let chats_dir = app_data_sub_dir(app, "chats")?;
    let Some(mut chat) = get_chat(app, id.clone())? else {
        return Err(AppError::Message(String::from("Chat not found")));
    };
    chat.description = description;
    write_json(
        &chats_dir.join(format!("{}.json", sanitize_chat_id(&id)?)),
        &chat,
    )?;

    let mut history = get_chat_history(app)?;
    rename_in_chat_index(&mut history, &id, &chat.description);
    write_json(&chats_dir.join("index.json"), &history)
}

fn rename_in_chat_index(history: &mut [ChatHistoryItem], id: &str, description: &str) {
    if let Some(item) = history.iter_mut().find(|item| item.id == id) {
        item.description = description.to_string();
    }
}

/// Ids of the chats whose title or messages contain `query`, in index order.
/// The index holds no messages, so each chat file is read.
pub fn search_chat_history(app: &AppHandle, query: String) -> Result<Vec<String>, AppError> {
    let history = get_chat_history(app)?;
    let mut found = Vec::new();

    for item in history {
        let matches = match get_chat(app, item.id.clone()) {
            Ok(Some(chat)) => chat_matches(&chat, &query),
            _ => chat_matches(&item, &query),
        };
        if matches {
            found.push(item.id);
        }
    }

    Ok(found)
}

fn chat_matches(chat: &ChatHistoryItem, query: &str) -> bool {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return true;
    }

    chat.description.to_lowercase().contains(&query)
        || chat
            .messages
            .iter()
            .any(|message| message.content.to_lowercase().contains(&query))
}

pub fn remove_from_chat_history(app: &AppHandle, id: String) -> Result<(), AppError> {
    let file_name = format!("{}.json", sanitize_chat_id(&id)?);
    let chats_dir = app_data_sub_dir(app, "chats")?;
    let mut history = get_chat_history(app)?;
    history.retain(|item| item.id != id);
    write_json(&chats_dir.join("index.json"), &history)?;

    let chat_file_path = chats_dir.join(file_name);
    if chat_file_path.exists() {
        if let Err(error) = fs::remove_file(&chat_file_path) {
            log::warn!("Could not remove {}: {error}", chat_file_path.display());
        }
    }

    crate::services::chat_images::collect_orphans(&chats_dir)
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
    fn drop_expired(&self, history: &mut Vec<ChatHistoryItem>, now_ms: u64) {
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
        return clear_chat_history(app);
    }

    let mut history = get_chat_history(app)?;
    let count = history.len();
    policy.drop_expired(&mut history, now_ms());
    if history.len() == count {
        return Ok(());
    }

    let chats_dir = app_data_sub_dir(app, "chats")?;
    write_json(&chats_dir.join("index.json"), &history)?;
    remove_orphan_chat_files(&chats_dir, &history)
}

/// Removes the index, chat files, and persisted image bytes.
pub fn clear_chat_history(app: &AppHandle) -> Result<(), AppError> {
    let chats_dir = app_data_sub_dir(app, "chats")?;
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
    let is_safe = !id.is_empty()
        && id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_');

    if !is_safe {
        return Err(AppError::Message(String::from("Invalid chat id")));
    }

    Ok(id.to_string())
}

fn remove_orphan_chat_files(
    chats_dir: &PathBuf,
    history: &[ChatHistoryItem],
) -> Result<(), AppError> {
    let active_ids = history
        .iter()
        .map(|item| format!("{}.json", item.id))
        .collect::<std::collections::HashSet<_>>();

    if let Ok(entries) = fs::read_dir(chats_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };

            if path.is_file() && file_name != "index.json" && !active_ids.contains(file_name) {
                fs::remove_file(path)?;
            }
        }
    }

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

    fn chat_item(id: &str) -> ChatHistoryItem {
        ChatHistoryItem {
            id: id.to_string(),
            description: String::from("chat"),
            last_msg_date: String::from("0"),
            messages: Vec::new(),
        }
    }

    #[test]
    fn rename_in_chat_index_keeps_the_order() {
        let mut history = vec![chat_item("a"), chat_item("b")];

        rename_in_chat_index(&mut history, "b", "renamed");

        assert_eq!(history[0].id, "a");
        assert_eq!(history[1].id, "b");
        assert_eq!(history[1].description, "renamed");
    }

    #[test]
    fn chat_matches_the_title_and_the_messages_ignoring_case() {
        let mut chat = chat_item("a");
        chat.description = String::from("Trip plan");
        chat.messages = vec![crate::models::ChatMessage {
            role: String::from("user"),
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
        let mut history = vec![chat_item("a"), chat_item("b"), chat_item("c")];
        let mut updated = chat_item("c");
        updated.description = String::from("updated");

        upsert_chat_index(&mut history, &updated);

        let ids: Vec<_> = history.iter().map(|item| item.id.as_str()).collect();
        assert_eq!(ids, ["c", "a", "b"]);
        assert_eq!(history[0].description, "updated");
        assert!(history[0].messages.is_empty());
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
            dated("fresh", "2026-10-08T00:00:00.000Z"),
            dated("old", "2026-09-01T00:00:00.000Z"),
            dated("undated", "unknown"),
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
    fn sanitize_chat_id_rejects_path_traversal() {
        assert!(sanitize_chat_id("../../etc/passwd").is_err());
        assert!(sanitize_chat_id("chat/id").is_err());
        assert!(sanitize_chat_id("").is_err());
        assert_eq!(sanitize_chat_id("chat-1_A").unwrap(), "chat-1_A");
    }

    #[test]
    fn remove_orphan_chat_files_keeps_active_chats_and_the_index() {
        let dir = temp_dir("orphans");
        fs::write(dir.join("index.json"), "[]").unwrap();
        fs::write(dir.join("kept.json"), "{}").unwrap();
        fs::write(dir.join("orphan.json"), "{}").unwrap();

        remove_orphan_chat_files(&dir, &[chat_item("kept")]).unwrap();

        assert!(dir.join("index.json").exists());
        assert!(dir.join("kept.json").exists());
        assert!(!dir.join("orphan.json").exists());

        fs::remove_dir_all(&dir).unwrap();
    }
}
