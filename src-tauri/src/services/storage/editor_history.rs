use super::chat_history::enforce_chat_history_policy;
use super::*;

const EDITOR_HISTORY_FILE: &str = "editor-history.jsonl";
pub(super) const DEFAULT_EDITOR_HISTORY_LIMIT: usize = 100;

/// A line of `editor-history.jsonl`: a plain string in the legacy format.
#[derive(Deserialize)]
#[serde(untagged)]
enum StoredEditorHistoryLine {
    Item(EditorHistoryItem),
    Legacy(String),
}

fn editor_history_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    Ok(app_data_sub_dir(app, "history")?.join(EDITOR_HISTORY_FILE))
}

/// Entries without a date (the legacy format) get the time the file was last
/// written: the latest they can be from, so that the retention period applies
/// to them too.
fn read_editor_history(path: &Path) -> Result<Vec<EditorHistoryItem>, AppError> {
    let lines: Vec<StoredEditorHistoryLine> = read_jsonl(path)?;
    let file_time = || {
        fs::metadata(path)
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .and_then(|duration| u64::try_from(duration.as_millis()).ok())
            .unwrap_or_else(now_ms)
    };

    Ok(lines
        .into_iter()
        .enumerate()
        .map(|(index, line)| match line {
            StoredEditorHistoryLine::Item(item) => item,
            // stable while the file is untouched; the next write persists it
            StoredEditorHistoryLine::Legacy(text) => EditorHistoryItem {
                id: format!("legacy-{index}"),
                text,
                kind: EditorHistoryKind::Draft,
                operation: None,
                created_at: 0,
                result: None,
                sent: false,
            },
        })
        .map(|mut item| {
            if item.created_at == 0 {
                item.created_at = file_time();
            }
            item
        })
        .collect())
}

/// Where the editor history lives.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EditorHistoryStorage {
    /// Nothing is kept.
    Off,
    /// The memory of the process only: nothing outlives the app.
    Session,
    Disk,
}

impl EditorHistoryStorage {
    /// Configs older than the setting said it with a zero limit (off) and the
    /// `clearEditorHistoryOnExit` flag (session).
    pub fn from_config(user_config: &Value) -> Self {
        match user_config
            .get("editorHistoryStorage")
            .and_then(Value::as_str)
        {
            Some("off") => return Self::Off,
            Some("session") => return Self::Session,
            Some("disk") => return Self::Disk,
            _ => {}
        }

        if history_limit(
            user_config,
            "editorHistoryMaxItems",
            DEFAULT_EDITOR_HISTORY_LIMIT,
        ) == 0
        {
            Self::Off
        } else if user_config
            .get("clearEditorHistoryOnExit")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            Self::Session
        } else {
            Self::Disk
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Session => "session",
            Self::Disk => "disk",
        }
    }
}

/// What the settings say about the editor history.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EditorHistoryPolicy {
    /// How many entries to keep; 0 keeps none.
    pub limit: usize,
    /// The entries live in the memory of the process only and never reach the
    /// disk, so nothing of them outlives the app, whichever way it ends.
    pub memory_only: bool,
    /// Entries older than this many days are dropped; 0 keeps them forever.
    /// Applies on the disk only, as does `sanitize`.
    pub retention_days: u64,
    /// What looks like a password or a key is masked before it is stored.
    pub sanitize: bool,
}

impl EditorHistoryPolicy {
    pub fn from_config(user_config: &Value) -> Self {
        let flag = |key: &str| {
            user_config
                .get(key)
                .and_then(Value::as_bool)
                .unwrap_or(false)
        };

        let storage = EditorHistoryStorage::from_config(user_config);
        let on_disk = storage == EditorHistoryStorage::Disk;

        Self {
            limit: if storage == EditorHistoryStorage::Off {
                0
            } else {
                history_limit(
                    user_config,
                    "editorHistoryMaxItems",
                    DEFAULT_EDITOR_HISTORY_LIMIT,
                )
            },
            memory_only: storage == EditorHistoryStorage::Session,
            retention_days: if on_disk {
                user_config
                    .get("editorHistoryRetentionDays")
                    .and_then(Value::as_u64)
                    .unwrap_or(0)
            } else {
                0
            },
            sanitize: on_disk && flag("sanitizeSecretsInEditorHistory"),
        }
    }

    fn redact(&self, text: String) -> String {
        if self.sanitize {
            redact_secrets(&text)
        } else {
            text
        }
    }

    /// Brings stored entries in line with the settings: drops those past the
    /// retention period or over the limit and masks secrets when asked, also
    /// in entries stored before the setting was turned on.
    fn enforce(&self, history: &mut Vec<EditorHistoryItem>, now_ms: u64) {
        if self.retention_days > 0 {
            let cutoff = now_ms.saturating_sub(self.retention_days.saturating_mul(DAY_MS));
            history.retain(|item| item.created_at >= cutoff);
        }
        history.truncate(self.limit);
        if self.sanitize {
            for item in history.iter_mut() {
                item.text = redact_secrets(&item.text);
                item.result = item.result.take().map(|result| redact_secrets(&result));
            }
        }
    }
}

/// Where the editor history lives: its file, or the memory of the process.
enum EditorHistoryStore<'a> {
    File(PathBuf),
    Memory(&'a mut Vec<EditorHistoryItem>),
}

impl EditorHistoryStore<'_> {
    fn read(&self) -> Result<Vec<EditorHistoryItem>, AppError> {
        match self {
            Self::File(path) => read_editor_history(path),
            Self::Memory(items) => Ok(items.to_vec()),
        }
    }

    /// An empty history leaves no file behind.
    fn write(&mut self, items: Vec<EditorHistoryItem>) -> Result<(), AppError> {
        match self {
            Self::File(path) if items.is_empty() => remove_file_if_exists(path),
            Self::File(path) => write_jsonl(path, &items),
            Self::Memory(memory) => {
                **memory = items;
                Ok(())
            }
        }
    }
}

/// The editor history as the settings let it be seen and changed.
struct EditorHistory<'a> {
    store: EditorHistoryStore<'a>,
    policy: EditorHistoryPolicy,
}

impl<'a> EditorHistory<'a> {
    /// `memory` holds the entries while the history is kept in memory only.
    fn open(
        app: &AppHandle,
        user_config: &Value,
        memory: &'a mut Vec<EditorHistoryItem>,
    ) -> Result<Self, AppError> {
        let policy = EditorHistoryPolicy::from_config(user_config);
        let store = if policy.memory_only {
            EditorHistoryStore::Memory(memory)
        } else {
            EditorHistoryStore::File(editor_history_path(app)?)
        };

        Ok(Self { store, policy })
    }

    fn load(&self) -> Result<Vec<EditorHistoryItem>, AppError> {
        let mut items = self.store.read()?;
        self.policy.enforce(&mut items, now_ms());
        Ok(items)
    }

    fn save(&mut self, items: Vec<EditorHistoryItem>) -> Result<(), AppError> {
        self.store.write(items)
    }
}

pub fn get_editor_history(
    app: &AppHandle,
    user_config: &Value,
    memory: &mut Vec<EditorHistoryItem>,
) -> Result<Vec<EditorHistoryItem>, AppError> {
    EditorHistory::open(app, user_config, memory)?.load()
}

/// Adds an entry and returns its id, or `None` when nothing was stored: the
/// text is blank or the history is turned off
pub fn save_editor_history(
    app: &AppHandle,
    user_config: &Value,
    memory: &mut Vec<EditorHistoryItem>,
    entry: EditorHistoryEntry,
) -> Result<Option<String>, AppError> {
    save_editor_history_entry(&mut EditorHistory::open(app, user_config, memory)?, entry)
}

fn save_editor_history_entry(
    history: &mut EditorHistory,
    mut entry: EditorHistoryEntry,
) -> Result<Option<String>, AppError> {
    let policy = history.policy;

    if entry.text.trim().is_empty() || policy.limit == 0 {
        return Ok(None);
    }

    entry.text = policy.redact(entry.text);

    let mut items = history.load()?;
    let created_at = now_ms();
    let item = EditorHistoryItem {
        id: new_history_id(created_at),
        text: entry.text,
        kind: entry.kind,
        operation: entry.operation,
        created_at,
        result: None,
        sent: false,
    };

    let id = push_editor_history(&mut items, item, entry.replace_id.as_deref(), policy.limit);
    history.save(items)?;

    Ok(Some(id))
}

/// How much an entry says about the text: a text that was sent somewhere or
/// fed to the AI must not turn into a plain draft just because it is still in
/// the editor
fn kind_rank(kind: EditorHistoryKind) -> u8 {
    match kind {
        EditorHistoryKind::Draft => 0,
        EditorHistoryKind::Source => 1,
        EditorHistoryKind::Output => 2,
    }
}

fn collapses_duplicate(new_kind: EditorHistoryKind, existing_kind: EditorHistoryKind) -> bool {
    match (new_kind, existing_kind) {
        // A source supersedes an incidental draft, but every AI operation and
        // every actual output remains a separate event.
        (EditorHistoryKind::Source, EditorHistoryKind::Draft) => true,
        (EditorHistoryKind::Source, _) | (_, EditorHistoryKind::Source) => false,
        _ => true,
    }
}

/// Puts `item` on top and returns the id of the entry that now holds the text.
/// Draft snapshots are collapsed, and repeated outputs are moved to the top.
/// Sources stay separate because the same text may be used by several AI
/// operations and every result must remain attached to its source. A draft or
/// an output of an AI result is not a new entry: its source is moved to the top
/// instead, marked as sent in the case of an output.
fn push_editor_history(
    history: &mut Vec<EditorHistoryItem>,
    mut item: EditorHistoryItem,
    replace_id: Option<&str>,
    limit: usize,
) -> String {
    if let Some(replace_id) = replace_id {
        history.retain(|existing| {
            existing.id != replace_id || existing.kind != EditorHistoryKind::Draft
        });
    }

    let text = item.text.trim();

    if item.kind != EditorHistoryKind::Source {
        if let Some(index) = history.iter().position(|existing| {
            existing.kind == EditorHistoryKind::Source
                && existing.result.as_deref().map(str::trim) == Some(text)
        }) {
            let mut source = history.remove(index);
            source.sent |= item.kind == EditorHistoryKind::Output;
            source.created_at = item.created_at;
            history.retain(|existing| {
                existing.kind == EditorHistoryKind::Source || existing.text.trim() != text
            });

            let id = source.id.clone();
            history.insert(0, source);
            history.truncate(limit);
            return id;
        }
    }

    let duplicates: Vec<EditorHistoryItem> = history
        .iter()
        .filter(|existing| {
            existing.text.trim() == text && collapses_duplicate(item.kind, existing.kind)
        })
        .cloned()
        .collect();

    history.retain(|existing| {
        existing.text.trim() != text || !collapses_duplicate(item.kind, existing.kind)
    });

    if let Some(stronger) = duplicates
        .iter()
        .filter(|existing| kind_rank(existing.kind) > kind_rank(item.kind))
        .max_by_key(|existing| kind_rank(existing.kind))
    {
        item.kind = stronger.kind;
        item.operation = stronger.operation;
    }

    // what the AI made of the text stays comparable whatever happens to it next
    if item.result.is_none() {
        item.result = duplicates.into_iter().find_map(|existing| existing.result);
    }

    let id = item.id.clone();
    history.insert(0, item);
    history.truncate(limit);
    id
}

/// Attaches the AI result to the `Source` entry it was produced from.
pub fn set_editor_history_result(
    app: &AppHandle,
    user_config: &Value,
    memory: &mut Vec<EditorHistoryItem>,
    id: String,
    result: String,
) -> Result<(), AppError> {
    let mut history = EditorHistory::open(app, user_config, memory)?;
    let result = history.policy.redact(result);
    let mut items = history.load()?;

    if !apply_editor_history_result(&mut items, &id, result) {
        return Ok(());
    }

    history.save(items)
}

fn apply_editor_history_result(
    history: &mut [EditorHistoryItem],
    id: &str,
    result: String,
) -> bool {
    let Some(item) = history.iter_mut().find(|item| item.id == id) else {
        return false;
    };

    item.result = (!result.trim().is_empty()).then_some(result);
    true
}

/// Puts a removed entry back where it was (undo of a removal).
pub fn restore_editor_history_item(
    app: &AppHandle,
    user_config: &Value,
    memory: &mut Vec<EditorHistoryItem>,
    mut item: EditorHistoryItem,
) -> Result<(), AppError> {
    let mut history = EditorHistory::open(app, user_config, memory)?;
    let policy = history.policy;

    if policy.limit == 0 {
        return Ok(());
    }

    item.text = policy.redact(item.text);
    item.result = item.result.map(|result| policy.redact(result));

    let mut items = history.load()?;

    if insert_restored_item(&mut items, item, policy.limit) {
        history.save(items)?;
    }

    Ok(())
}

/// Entries are ordered newest first, so the item goes before the first older
/// one. Nothing is inserted when the same text has been added again meanwhile
fn insert_restored_item(
    history: &mut Vec<EditorHistoryItem>,
    item: EditorHistoryItem,
    limit: usize,
) -> bool {
    let text = item.text.trim();

    if history
        .iter()
        .any(|existing| existing.id == item.id || existing.text.trim() == text)
    {
        return false;
    }

    let index = history
        .iter()
        .position(|existing| existing.created_at < item.created_at)
        .unwrap_or(history.len());

    if index >= limit {
        return false;
    }

    history.insert(index, item);
    history.truncate(limit);
    true
}

pub fn remove_from_editor_history(
    app: &AppHandle,
    user_config: &Value,
    memory: &mut Vec<EditorHistoryItem>,
    id: String,
) -> Result<(), AppError> {
    let mut history = EditorHistory::open(app, user_config, memory)?;
    let mut items = history.load()?;
    items.retain(|item| item.id != id);
    history.save(items)
}

/// Removes every entry, from the memory and from the disk, whichever of them
/// the settings use now.
pub fn clear_editor_history(
    app: &AppHandle,
    memory: &mut Vec<EditorHistoryItem>,
) -> Result<(), AppError> {
    memory.clear();
    remove_file_if_exists(&editor_history_path(app)?)
}

/// Applies the history settings to what is stored. At startup the
/// memory-only mode means that the history of the previous run is gone, also
/// when that run ended without a chance to clean up.
pub fn apply_history_settings_on_startup(
    app: &AppHandle,
    user_config: &Value,
) -> Result<(), AppError> {
    let policy = EditorHistoryPolicy::from_config(user_config);
    let path = editor_history_path(app)?;

    if policy.memory_only {
        remove_file_if_exists(&path)?;
    } else {
        enforce_editor_history_file(&path, &policy, now_ms())?;
    }

    enforce_chat_history_policy(app, ChatHistoryPolicy::from_config(user_config))
}

fn enforce_editor_history_file(
    path: &Path,
    policy: &EditorHistoryPolicy,
    now_ms: u64,
) -> Result<(), AppError> {
    let stored = read_editor_history(path)?;
    let mut items = stored.clone();
    policy.enforce(&mut items, now_ms);

    if items != stored {
        EditorHistoryStore::File(path.to_path_buf()).write(items)?;
    }

    Ok(())
}

/// Applies a change of the history settings right away, as far as it is safe
/// to: the limit field passes through intermediate values while the user
/// types, so a lower limit or a shorter retention period are applied on the
/// next write or start instead. Turning the editor history off (limit 0) does
/// delete what is stored, as the settings promise. The chat settings are a
/// switch and a choice of periods, without intermediate values, so they apply
/// at once: turning the chat history off deletes the saved chats, and a
/// shorter retention period the chats it no longer covers.
pub fn apply_history_settings_change(
    app: &AppHandle,
    previous_config: &Value,
    user_config: &Value,
    memory: &mut Vec<EditorHistoryItem>,
) -> Result<(), AppError> {
    let before = EditorHistoryPolicy::from_config(previous_config);
    let after = EditorHistoryPolicy::from_config(user_config);
    let path = editor_history_path(app)?;

    switch_editor_history_store(&path, &before, &after, memory, now_ms())?;

    let chat_before = ChatHistoryPolicy::from_config(previous_config);
    let chat_after = ChatHistoryPolicy::from_config(user_config);
    if chat_after != chat_before {
        enforce_chat_history_policy(app, chat_after)?;
    }

    Ok(())
}

fn switch_editor_history_store(
    path: &Path,
    before: &EditorHistoryPolicy,
    after: &EditorHistoryPolicy,
    memory: &mut Vec<EditorHistoryItem>,
    now_ms: u64,
) -> Result<(), AppError> {
    let mut file = EditorHistoryStore::File(path.to_path_buf());

    if after.memory_only != before.memory_only {
        // the entries move to where the history lives now
        let mut items = if after.memory_only {
            file.read()?
        } else {
            std::mem::take(memory)
        };
        after.enforce(&mut items, now_ms);

        if after.memory_only {
            *memory = items;
            return remove_file_if_exists(path);
        }
        return file.write(items);
    }

    let turned_off = after.limit == 0 && before.limit != 0;
    let sanitize_turned_on = after.sanitize && !before.sanitize;

    if turned_off || sanitize_turned_on {
        let mut store = if after.memory_only {
            EditorHistoryStore::Memory(memory)
        } else {
            file
        };
        let mut items = store.read()?;
        after.enforce(&mut items, now_ms);
        store.write(items)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::EditorHistoryOperation;
    fn history_item(id: &str, text: &str, kind: EditorHistoryKind) -> EditorHistoryItem {
        EditorHistoryItem {
            id: id.to_string(),
            text: text.to_string(),
            kind,
            operation: None,
            created_at: 1,
            result: None,
            sent: false,
        }
    }

    fn history_texts(history: &[EditorHistoryItem]) -> Vec<&str> {
        history.iter().map(|item| item.text.as_str()).collect()
    }

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

    fn policy() -> EditorHistoryPolicy {
        EditorHistoryPolicy {
            limit: 100,
            memory_only: false,
            retention_days: 0,
            sanitize: false,
        }
    }

    fn entry(text: &str) -> EditorHistoryEntry {
        serde_json::from_value(json!({ "text": text, "kind": "draft" })).unwrap()
    }

    #[test]
    fn push_editor_history_moves_a_duplicate_to_the_top() {
        let mut history = vec![
            history_item("b", "second", EditorHistoryKind::Draft),
            history_item("a", "first", EditorHistoryKind::Draft),
        ];

        push_editor_history(
            &mut history,
            history_item("c", "  first\n", EditorHistoryKind::Source),
            None,
            10,
        );

        assert_eq!(history_texts(&history), vec!["  first\n", "second"]);
        assert_eq!(history[0].id, "c");
        assert_eq!(history[0].kind, EditorHistoryKind::Source);
    }

    #[test]
    fn push_editor_history_keeps_an_output_and_a_new_source_separate() {
        let mut history = vec![history_item("a", "sent", EditorHistoryKind::Output)];
        let mut source = history_item("b", "sent", EditorHistoryKind::Source);
        source.operation = Some(EditorHistoryOperation::Translate);

        push_editor_history(&mut history, source, None, 10);

        assert_eq!(history.len(), 2);
        assert_eq!(history[0].id, "b");
        assert_eq!(history[0].kind, EditorHistoryKind::Source);
        assert_eq!(
            history[0].operation,
            Some(EditorHistoryOperation::Translate)
        );
        assert_eq!(history[1].kind, EditorHistoryKind::Output);
    }

    #[test]
    fn push_editor_history_keeps_repeated_ai_operations_separate() {
        let mut first = history_item("a", "text", EditorHistoryKind::Source);
        first.operation = Some(EditorHistoryOperation::Translate);
        first.result = Some(String::from("Translation"));
        let mut second = history_item("b", "text", EditorHistoryKind::Source);
        second.operation = Some(EditorHistoryOperation::Correction);
        let mut history = vec![first];

        push_editor_history(&mut history, second, None, 10);

        assert_eq!(history.len(), 2);
        assert_eq!(history[0].id, "b");
        assert_eq!(history[0].result, None);
        assert_eq!(history[1].id, "a");
        assert_eq!(history[1].result.as_deref(), Some("Translation"));
    }

    #[test]
    fn push_editor_history_keeps_a_source_when_the_same_text_becomes_a_draft() {
        let mut source = history_item("a", "text", EditorHistoryKind::Source);
        source.operation = Some(EditorHistoryOperation::Correction);
        source.result = Some(String::from("Text."));
        let mut history = vec![source];

        push_editor_history(
            &mut history,
            history_item("b", "text", EditorHistoryKind::Draft),
            None,
            10,
        );

        assert_eq!(history.len(), 2);
        assert_eq!(history[0].kind, EditorHistoryKind::Draft);
        assert_eq!(history[1].kind, EditorHistoryKind::Source);
        assert_eq!(
            history[1].operation,
            Some(EditorHistoryOperation::Correction)
        );
        assert_eq!(history[1].result.as_deref(), Some("Text."));
    }

    #[test]
    fn push_editor_history_keeps_the_ai_source_and_its_sent_output() {
        let mut source = history_item("a", "text", EditorHistoryKind::Source);
        source.result = Some(String::from("Text."));
        let mut history = vec![source];

        push_editor_history(
            &mut history,
            history_item("b", "text", EditorHistoryKind::Output),
            None,
            10,
        );

        assert_eq!(history.len(), 2);
        assert_eq!(history[0].kind, EditorHistoryKind::Output);
        assert_eq!(history[0].result, None);
        assert_eq!(history[1].kind, EditorHistoryKind::Source);
        assert_eq!(history[1].result.as_deref(), Some("Text."));
    }

    #[test]
    fn push_editor_history_marks_the_source_of_a_sent_ai_result() {
        let mut source = history_item("a", "text", EditorHistoryKind::Source);
        source.result = Some(String::from("Text."));
        let mut history = vec![
            history_item("d", "Text.", EditorHistoryKind::Draft),
            history_item("o", "older", EditorHistoryKind::Output),
            source,
        ];
        let mut output = history_item("b", "Text.\n", EditorHistoryKind::Output);
        output.created_at = 5;

        let id = push_editor_history(&mut history, output, None, 10);

        assert_eq!(id, "a");
        assert_eq!(history_texts(&history), vec!["text", "older"]);
        assert!(history[0].sent);
        assert_eq!(history[0].created_at, 5);
        assert_eq!(history[0].kind, EditorHistoryKind::Source);
    }

    #[test]
    fn push_editor_history_keeps_an_ai_result_draft_in_its_source() {
        let mut source = history_item("a", "text", EditorHistoryKind::Source);
        source.result = Some(String::from("Text."));
        let mut history = vec![
            history_item("o", "older", EditorHistoryKind::Output),
            source,
        ];

        let id = push_editor_history(
            &mut history,
            history_item("d", "Text.", EditorHistoryKind::Draft),
            None,
            10,
        );

        assert_eq!(id, "a");
        assert_eq!(history_texts(&history), vec!["text", "older"]);
        assert!(!history[0].sent);
    }

    #[test]
    fn push_editor_history_replaces_the_draft_of_the_same_session() {
        let mut history = vec![
            history_item("d", "hello", EditorHistoryKind::Draft),
            history_item("o", "older", EditorHistoryKind::Output),
        ];

        push_editor_history(
            &mut history,
            history_item("e", "hello world", EditorHistoryKind::Draft),
            Some("d"),
            10,
        );

        assert_eq!(history_texts(&history), vec!["hello world", "older"]);
    }

    #[test]
    fn push_editor_history_never_replaces_a_non_draft() {
        let mut history = vec![history_item("o", "sent", EditorHistoryKind::Output)];

        push_editor_history(
            &mut history,
            history_item("e", "sent and edited", EditorHistoryKind::Draft),
            Some("o"),
            10,
        );

        assert_eq!(history_texts(&history), vec!["sent and edited", "sent"]);
    }

    #[test]
    fn push_editor_history_truncates_to_the_limit() {
        let mut history = vec![
            history_item("b", "second", EditorHistoryKind::Draft),
            history_item("a", "first", EditorHistoryKind::Draft),
        ];

        push_editor_history(
            &mut history,
            history_item("c", "third", EditorHistoryKind::Output),
            None,
            2,
        );

        assert_eq!(history_texts(&history), vec!["third", "second"]);
    }

    #[test]
    fn apply_editor_history_result_sets_and_clears_the_result() {
        let mut history = vec![history_item("a", "text", EditorHistoryKind::Source)];

        assert!(apply_editor_history_result(
            &mut history,
            "a",
            String::from("Text.")
        ));
        assert_eq!(history[0].result.as_deref(), Some("Text."));

        assert!(apply_editor_history_result(
            &mut history,
            "a",
            String::from("  ")
        ));
        assert_eq!(history[0].result, None);

        assert!(!apply_editor_history_result(
            &mut history,
            "missing",
            String::from("x")
        ));
    }

    #[test]
    fn insert_restored_item_goes_back_to_its_place() {
        let mut newer = history_item("n", "newer", EditorHistoryKind::Draft);
        newer.created_at = 30;
        let mut older = history_item("o", "older", EditorHistoryKind::Draft);
        older.created_at = 10;
        let mut history = vec![newer, older];
        let mut removed = history_item("r", "removed", EditorHistoryKind::Output);
        removed.created_at = 20;

        assert!(insert_restored_item(&mut history, removed, 10));
        assert_eq!(history_texts(&history), vec!["newer", "removed", "older"]);
    }

    #[test]
    fn insert_restored_item_skips_a_text_added_again() {
        let mut history = vec![history_item("n", "same", EditorHistoryKind::Draft)];

        assert!(!insert_restored_item(
            &mut history,
            history_item("r", " same ", EditorHistoryKind::Output),
            10
        ));
        assert_eq!(history.len(), 1);
    }

    #[test]
    fn insert_restored_item_respects_the_limit() {
        let mut newer = history_item("n", "newer", EditorHistoryKind::Draft);
        newer.created_at = 30;
        let mut history = vec![newer];
        let mut removed = history_item("r", "removed", EditorHistoryKind::Draft);
        removed.created_at = 10;

        assert!(!insert_restored_item(&mut history, removed, 1));
        assert_eq!(history_texts(&history), vec!["newer"]);
    }

    #[test]
    fn read_editor_history_upgrades_legacy_lines() {
        let dir = temp_dir("editor-history");
        let path = dir.join(EDITOR_HISTORY_FILE);
        let item = history_item("x", "new", EditorHistoryKind::Output);
        let raw = format!(
            "{}\n{}\n",
            serde_json::to_string("old").unwrap(),
            serde_json::to_string(&item).unwrap()
        );
        fs::write(&path, raw).unwrap();

        let history = read_editor_history(&path).unwrap();

        assert_eq!(history[0].id, "legacy-0");
        assert_eq!(history[0].text, "old");
        assert_eq!(history[0].kind, EditorHistoryKind::Draft);
        // the time the file was written, so that the retention period applies
        assert!(history[0].created_at > 0);
        assert!(history[0].created_at <= now_ms());
        assert_eq!(history[1], item);

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn policy_reads_the_settings() {
        let config = json!({
            "editorHistoryStorage": "disk",
            "editorHistoryMaxItems": "20",
            "editorHistoryRetentionDays": 7,
            "sanitizeSecretsInEditorHistory": true,
        });

        assert_eq!(
            EditorHistoryPolicy::from_config(&config),
            EditorHistoryPolicy {
                limit: 20,
                memory_only: false,
                retention_days: 7,
                sanitize: true,
            }
        );
        assert_eq!(
            EditorHistoryPolicy::from_config(&json!({
                "editorHistoryStorage": "session",
                "editorHistoryMaxItems": 20,
                "editorHistoryRetentionDays": 7,
                "sanitizeSecretsInEditorHistory": true,
            })),
            EditorHistoryPolicy {
                limit: 20,
                memory_only: true,
                ..policy()
            }
        );
        assert_eq!(
            EditorHistoryPolicy::from_config(&json!({
                "editorHistoryStorage": "off",
                "editorHistoryMaxItems": 20,
            })),
            EditorHistoryPolicy {
                limit: 0,
                ..policy()
            }
        );
        // a config not migrated yet
        assert_eq!(
            EditorHistoryPolicy::from_config(&json!({
                "editorHistoryMaxItems": 20,
                "clearEditorHistoryOnExit": true,
            })),
            EditorHistoryPolicy {
                limit: 20,
                memory_only: true,
                ..policy()
            }
        );
        assert_eq!(
            EditorHistoryPolicy::from_config(&json!({})),
            EditorHistoryPolicy {
                limit: DEFAULT_EDITOR_HISTORY_LIMIT,
                ..policy()
            }
        );
    }

    #[test]
    fn enforce_drops_expired_entries_and_those_over_the_limit() {
        let now = 100 * DAY_MS;
        let mut fresh = history_item("fresh", "fresh", EditorHistoryKind::Draft);
        fresh.created_at = now - DAY_MS;
        let mut second = history_item("second", "second", EditorHistoryKind::Draft);
        second.created_at = now - 2 * DAY_MS;
        let mut old = history_item("old", "old", EditorHistoryKind::Draft);
        old.created_at = now - 3 * DAY_MS;
        let mut history = vec![fresh, second, old];

        EditorHistoryPolicy {
            retention_days: 2,
            ..policy()
        }
        .enforce(&mut history, now);
        assert_eq!(history_texts(&history), ["fresh", "second"]);

        EditorHistoryPolicy {
            limit: 1,
            ..policy()
        }
        .enforce(&mut history, now);
        assert_eq!(history_texts(&history), ["fresh"]);
    }

    #[test]
    fn enforce_masks_secrets_in_entries_stored_before() {
        let mut item = history_item("a", "password=hunter22", EditorHistoryKind::Source);
        item.result = Some(String::from("token: abcdef123456"));
        let mut history = vec![item];

        EditorHistoryPolicy {
            sanitize: true,
            ..policy()
        }
        .enforce(&mut history, now_ms());

        assert_eq!(history[0].text, "password=[REDACTED SECRET]");
        assert_eq!(
            history[0].result.as_deref(),
            Some("token: [REDACTED SECRET]")
        );
    }

    #[test]
    fn save_editor_history_entry_masks_secrets_when_enabled() {
        let dir = temp_dir("save-secrets");
        let path = dir.join(EDITOR_HISTORY_FILE);
        let mut history = EditorHistory {
            store: EditorHistoryStore::File(path.clone()),
            policy: EditorHistoryPolicy {
                sanitize: true,
                ..policy()
            },
        };

        save_editor_history_entry(
            &mut history,
            entry("Here is my key: sk-proj-1234567890abcdef1234567890"),
        )
        .unwrap();

        let raw = fs::read_to_string(&path).unwrap();
        assert!(raw.contains("[REDACTED API KEY]"));
        assert!(!raw.contains("sk-proj-"));

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn save_editor_history_entry_stores_nothing_when_the_history_is_off() {
        let dir = temp_dir("save-off");
        let path = dir.join(EDITOR_HISTORY_FILE);
        let mut history = EditorHistory {
            store: EditorHistoryStore::File(path.clone()),
            policy: EditorHistoryPolicy {
                limit: 0,
                ..policy()
            },
        };

        assert_eq!(
            save_editor_history_entry(&mut history, entry("text")).unwrap(),
            None
        );
        assert!(!path.exists());

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_memory_store_never_touches_the_disk() {
        let dir = temp_dir("memory-store");
        let mut memory = Vec::new();
        let mut history = EditorHistory {
            store: EditorHistoryStore::Memory(&mut memory),
            policy: EditorHistoryPolicy {
                memory_only: true,
                ..policy()
            },
        };

        save_editor_history_entry(&mut history, entry("kept in memory")).unwrap();

        assert_eq!(history_texts(&memory), ["kept in memory"]);
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn an_emptied_file_store_leaves_no_file() {
        let dir = temp_dir("empty-store");
        let path = dir.join(EDITOR_HISTORY_FILE);
        let mut store = EditorHistoryStore::File(path.clone());

        store
            .write(vec![history_item("a", "a", EditorHistoryKind::Draft)])
            .unwrap();
        assert!(path.exists());
        store.write(Vec::new()).unwrap();
        assert!(!path.exists());

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn switching_to_memory_only_moves_the_file_into_memory() {
        let dir = temp_dir("switch-on");
        let path = dir.join(EDITOR_HISTORY_FILE);
        let now = now_ms();
        let mut item = history_item("a", "stored", EditorHistoryKind::Draft);
        item.created_at = now;
        write_jsonl(&path, &[item]).unwrap();
        let mut memory = Vec::new();

        switch_editor_history_store(
            &path,
            &policy(),
            &EditorHistoryPolicy {
                memory_only: true,
                ..policy()
            },
            &mut memory,
            now,
        )
        .unwrap();

        assert!(!path.exists());
        assert_eq!(history_texts(&memory), ["stored"]);

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn switching_memory_only_off_writes_the_memory_to_the_file() {
        let dir = temp_dir("switch-off");
        let path = dir.join(EDITOR_HISTORY_FILE);
        let now = now_ms();
        let mut item = history_item("a", "in memory", EditorHistoryKind::Draft);
        item.created_at = now;
        let mut memory = vec![item];

        switch_editor_history_store(
            &path,
            &EditorHistoryPolicy {
                memory_only: true,
                ..policy()
            },
            &policy(),
            &mut memory,
            now,
        )
        .unwrap();

        assert!(memory.is_empty());
        assert_eq!(
            history_texts(&read_editor_history(&path).unwrap()),
            ["in memory"]
        );

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn turning_the_history_off_deletes_the_file() {
        let dir = temp_dir("turn-off");
        let path = dir.join(EDITOR_HISTORY_FILE);
        write_jsonl(&path, &[history_item("a", "a", EditorHistoryKind::Draft)]).unwrap();

        switch_editor_history_store(
            &path,
            &policy(),
            &EditorHistoryPolicy {
                limit: 0,
                ..policy()
            },
            &mut Vec::new(),
            now_ms(),
        )
        .unwrap();

        assert!(!path.exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_lower_limit_waits_for_the_next_write() {
        let dir = temp_dir("lower-limit");
        let path = dir.join(EDITOR_HISTORY_FILE);
        let items = vec![
            history_item("a", "a", EditorHistoryKind::Draft),
            history_item("b", "b", EditorHistoryKind::Draft),
        ];
        write_jsonl(&path, &items).unwrap();

        switch_editor_history_store(
            &path,
            &policy(),
            &EditorHistoryPolicy {
                limit: 1,
                ..policy()
            },
            &mut Vec::new(),
            now_ms(),
        )
        .unwrap();

        assert_eq!(read_editor_history(&path).unwrap().len(), 2);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn startup_drops_expired_entries_and_legacy_lines_expire_too() {
        let dir = temp_dir("startup");
        let path = dir.join(EDITOR_HISTORY_FILE);
        let now = now_ms();
        let mut fresh = history_item("fresh", "fresh", EditorHistoryKind::Draft);
        fresh.created_at = now;
        let raw = format!(
            "{}\n{}\n",
            serde_json::to_string(&fresh).unwrap(),
            serde_json::to_string("legacy").unwrap()
        );
        fs::write(&path, raw).unwrap();
        let retention = EditorHistoryPolicy {
            retention_days: 1,
            ..policy()
        };

        // the legacy line is as old as the file, which is new
        enforce_editor_history_file(&path, &retention, now).unwrap();
        assert_eq!(read_editor_history(&path).unwrap().len(), 2);

        enforce_editor_history_file(&path, &retention, now + 2 * DAY_MS).unwrap();
        assert!(!path.exists());

        fs::remove_dir_all(&dir).unwrap();
    }
}
