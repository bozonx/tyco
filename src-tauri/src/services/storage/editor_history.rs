mod entries;
mod policy;

use entries::{apply_editor_history_result, insert_restored_item, push_editor_history};
pub use policy::EditorHistoryPolicy;

use super::chat_history::enforce_chat_history_policy;
use super::*;

const EDITOR_HISTORY_FILE: &str = "editor-history.jsonl";
pub(super) const DEFAULT_EDITOR_HISTORY_LIMIT: usize = 100;

fn editor_history_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    Ok(app_data_sub_dir(app, "history")?.join(EDITOR_HISTORY_FILE))
}

fn remove_editor_history_files(path: &Path) -> Result<(), AppError> {
    remove_file_if_exists(path)?;
    if let Some(parent) = path.parent() {
        let prefix = format!("{EDITOR_HISTORY_FILE}.broken-");
        for entry in fs::read_dir(parent)? {
            let entry = entry?;
            if entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.starts_with(&prefix))
            {
                remove_file_if_exists(&entry.path())?;
            }
        }
    }
    Ok(())
}

fn read_editor_history(path: &Path) -> Result<Vec<EditorHistoryRecord>, AppError> {
    read_jsonl(path)
}

/// Where the editor history lives: its file, or the memory of the process.
enum EditorHistoryStore<'a> {
    File(PathBuf),
    Memory(&'a mut Vec<EditorHistoryRecord>),
}

impl EditorHistoryStore<'_> {
    fn read(&self) -> Result<Vec<EditorHistoryRecord>, AppError> {
        match self {
            Self::File(path) => read_editor_history(path),
            Self::Memory(items) => Ok(items.to_vec()),
        }
    }

    /// An empty history leaves no file behind.
    fn write(&mut self, items: Vec<EditorHistoryRecord>) -> Result<(), AppError> {
        match self {
            Self::File(path) if items.is_empty() => remove_editor_history_files(path),
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
        memory: &'a mut Vec<EditorHistoryRecord>,
    ) -> Result<Self, AppError> {
        let policy = EditorHistoryPolicy::from_config(user_config);
        let store = if policy.is_memory_only {
            EditorHistoryStore::Memory(memory)
        } else {
            EditorHistoryStore::File(editor_history_path(app)?)
        };

        Ok(Self { store, policy })
    }

    fn load(&self) -> Result<Vec<EditorHistoryRecord>, AppError> {
        let mut items = self.store.read()?;
        self.policy.enforce(&mut items, now_ms());
        Ok(items)
    }

    fn save(&mut self, items: Vec<EditorHistoryRecord>) -> Result<(), AppError> {
        self.store.write(items)
    }
}

pub fn get_editor_history(
    app: &AppHandle,
    user_config: &Value,
    memory: &mut Vec<EditorHistoryRecord>,
) -> Result<Vec<EditorHistoryRecord>, AppError> {
    EditorHistory::open(app, user_config, memory)?.load()
}

/// Adds an entry and returns its id, or `None` when nothing was stored: the
/// text is blank or the history is turned off
pub fn save_editor_history(
    app: &AppHandle,
    user_config: &Value,
    memory: &mut Vec<EditorHistoryRecord>,
    entry: CreateEditorHistoryRequest,
) -> Result<Option<String>, AppError> {
    save_editor_history_entry(&mut EditorHistory::open(app, user_config, memory)?, entry)
}

fn save_editor_history_entry(
    history: &mut EditorHistory,
    mut entry: CreateEditorHistoryRequest,
) -> Result<Option<String>, AppError> {
    let policy = history.policy;

    if entry.text.trim().is_empty() || policy.max_entries == 0 {
        return Ok(None);
    }

    entry.text = policy.redact(entry.text);

    let mut items = history.load()?;
    let created_at_ms = now_ms();
    let item = EditorHistoryRecord {
        id: new_history_id(created_at_ms),
        text: entry.text,
        kind: entry.kind,
        operation: entry.operation,
        created_at_ms,
        result: None,
        is_result_applied: false,
    };

    let id = push_editor_history(
        &mut items,
        item,
        entry.replace_id.as_deref(),
        policy.max_entries,
    );
    history.save(items)?;

    Ok(Some(id))
}

/// Attaches the AI result to the `Source` entry it was produced from.
pub fn set_editor_history_result(
    app: &AppHandle,
    user_config: &Value,
    memory: &mut Vec<EditorHistoryRecord>,
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

/// Puts a removed entry back where it was (undo of a removal).
pub fn restore_editor_history_item(
    app: &AppHandle,
    user_config: &Value,
    memory: &mut Vec<EditorHistoryRecord>,
    mut item: EditorHistoryRecord,
) -> Result<(), AppError> {
    let mut history = EditorHistory::open(app, user_config, memory)?;
    let policy = history.policy;

    if policy.max_entries == 0 {
        return Ok(());
    }

    item.text = policy.redact(item.text);
    item.result = item.result.map(|result| policy.redact(result));

    let mut items = history.load()?;

    if insert_restored_item(&mut items, item, policy.max_entries) {
        history.save(items)?;
    }

    Ok(())
}

pub fn remove_from_editor_history(
    app: &AppHandle,
    user_config: &Value,
    memory: &mut Vec<EditorHistoryRecord>,
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
    memory: &mut Vec<EditorHistoryRecord>,
) -> Result<(), AppError> {
    memory.clear();
    remove_editor_history_files(&editor_history_path(app)?)
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

    if policy.is_memory_only {
        remove_editor_history_files(&path)?;
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
    memory: &mut Vec<EditorHistoryRecord>,
) -> Result<(), AppError> {
    let before = EditorHistoryPolicy::from_config(previous_config);
    let after = EditorHistoryPolicy::from_config(user_config);
    let path = editor_history_path(app)?;

    apply_history_transition(&path, &before, &after, memory, || {
        let chat_before = ChatHistoryPolicy::from_config(previous_config);
        let chat_after = ChatHistoryPolicy::from_config(user_config);
        if chat_after != chat_before {
            enforce_chat_history_policy(app, chat_after)?;
        }
        Ok(())
    })
}

/// Retains the editor snapshot until every part of the settings change succeeds.
fn apply_history_transition(
    path: &Path,
    before: &EditorHistoryPolicy,
    after: &EditorHistoryPolicy,
    memory: &mut Vec<EditorHistoryRecord>,
    apply_chats: impl FnOnce() -> Result<(), AppError>,
) -> Result<(), AppError> {
    if before == after {
        return apply_chats();
    }
    let disk = match fs::read(path) {
        Ok(bytes) => Some(bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.into()),
    };
    let original_memory = memory.clone();
    let result = switch_editor_history_store(path, before, after, memory, now_ms())
        .and_then(|()| apply_chats());
    if let Err(error) = result {
        *memory = original_memory;
        let rollback = match disk {
            Some(bytes) => crate::services::atomic_file::write_private_bytes(path, &bytes),
            None => remove_file_if_exists(path),
        };
        if let Err(rollback_error) = rollback {
            return Err(AppError::Message(format!(
                "Could not apply history settings: {error}; could not restore editor history: {rollback_error}"
            )));
        }
        return Err(error);
    }
    Ok(())
}

fn switch_editor_history_store(
    path: &Path,
    before: &EditorHistoryPolicy,
    after: &EditorHistoryPolicy,
    memory: &mut Vec<EditorHistoryRecord>,
    now_ms: u64,
) -> Result<(), AppError> {
    let mut file = EditorHistoryStore::File(path.to_path_buf());

    if after.is_memory_only != before.is_memory_only {
        // the entries move to where the history lives now
        let mut items = if after.is_memory_only {
            file.read()?
        } else {
            memory.clone()
        };
        after.enforce(&mut items, now_ms);

        if after.is_memory_only {
            remove_editor_history_files(path)?;
            *memory = items;
            return Ok(());
        }
        file.write(items)?;
        memory.clear();
        return Ok(());
    }

    let turned_off = after.max_entries == 0 && before.max_entries != 0;
    let sanitize_turned_on = after.should_redact_secrets && !before.should_redact_secrets;

    if turned_off || sanitize_turned_on {
        let mut store = if after.is_memory_only {
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
    use crate::models::EditorHistoryKind;
    use crate::services::storage::test_support::{history_item, history_texts, TestDir};

    fn policy() -> EditorHistoryPolicy {
        EditorHistoryPolicy {
            max_entries: 100,
            is_memory_only: false,
            retention_days: 0,
            should_redact_secrets: false,
        }
    }

    fn entry(text: &str) -> CreateEditorHistoryRequest {
        serde_json::from_value(json!({ "text": text, "kind": "draft" })).unwrap()
    }

    #[test]
    fn failed_chat_transition_restores_editor_disk_and_memory() {
        let dir = TestDir::new("failed-chat-transition");
        let path = dir.join(EDITOR_HISTORY_FILE);
        let items = vec![history_item("a", "private", EditorHistoryKind::Draft)];
        write_jsonl(&path, &items).unwrap();
        let original = fs::read(&path).unwrap();
        let mut memory = Vec::new();
        let after = EditorHistoryPolicy {
            is_memory_only: true,
            ..policy()
        };
        let result = apply_history_transition(&path, &policy(), &after, &mut memory, || {
            Err(AppError::Message("Chat storage failed".into()))
        });
        assert!(result.is_err());
        assert!(memory.is_empty());
        assert_eq!(fs::read(&path).unwrap(), original);
    }

    #[test]
    fn failed_chat_transition_restores_memory_after_disk_write() {
        let dir = TestDir::new("failed-chat-after-write");
        let path = dir.join(EDITOR_HISTORY_FILE);
        let mut memory = vec![history_item("a", "private", EditorHistoryKind::Draft)];
        let original = memory.clone();
        let before = EditorHistoryPolicy {
            is_memory_only: true,
            ..policy()
        };
        let result = apply_history_transition(&path, &before, &policy(), &mut memory, || {
            Err(AppError::Message("Chat storage failed".into()))
        });
        assert!(result.is_err());
        assert_eq!(memory, original);
        assert!(!path.exists());
    }

    #[test]
    fn failed_store_transition_preserves_memory() {
        let dir = TestDir::new("failed-transition");
        let path = dir.join("missing").join(EDITOR_HISTORY_FILE);
        let mut memory = vec![history_item("a", "private", EditorHistoryKind::Draft)];
        let original = memory.clone();
        let before = EditorHistoryPolicy {
            is_memory_only: true,
            ..policy()
        };
        assert!(
            switch_editor_history_store(&path, &before, &policy(), &mut memory, now_ms()).is_err()
        );
        assert_eq!(memory, original);
    }

    #[test]
    fn save_editor_history_entry_masks_secrets_when_enabled() {
        let dir = TestDir::new("save-secrets");
        let path = dir.join(EDITOR_HISTORY_FILE);
        let mut history = EditorHistory {
            store: EditorHistoryStore::File(path.clone()),
            policy: EditorHistoryPolicy {
                should_redact_secrets: true,
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
    }

    #[test]
    fn save_editor_history_entry_stores_nothing_when_the_history_is_off() {
        let dir = TestDir::new("save-off");
        let path = dir.join(EDITOR_HISTORY_FILE);
        let mut history = EditorHistory {
            store: EditorHistoryStore::File(path.clone()),
            policy: EditorHistoryPolicy {
                max_entries: 0,
                ..policy()
            },
        };

        assert_eq!(
            save_editor_history_entry(&mut history, entry("text")).unwrap(),
            None
        );
        assert!(!path.exists());
    }

    #[test]
    fn the_memory_store_never_touches_the_disk() {
        let dir = TestDir::new("memory-store");
        let mut memory = Vec::new();
        let mut history = EditorHistory {
            store: EditorHistoryStore::Memory(&mut memory),
            policy: EditorHistoryPolicy {
                is_memory_only: true,
                ..policy()
            },
        };

        save_editor_history_entry(&mut history, entry("kept in memory")).unwrap();

        assert_eq!(history_texts(&memory), ["kept in memory"]);
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
    }

    #[test]
    fn an_emptied_file_store_leaves_no_file() {
        let dir = TestDir::new("empty-store");
        let path = dir.join(EDITOR_HISTORY_FILE);
        let mut store = EditorHistoryStore::File(path.clone());

        store
            .write(vec![history_item("a", "a", EditorHistoryKind::Draft)])
            .unwrap();
        assert!(path.exists());
        store.write(Vec::new()).unwrap();
        assert!(!path.exists());
    }

    #[test]
    fn switching_to_memory_only_moves_the_file_into_memory() {
        let dir = TestDir::new("switch-on");
        let path = dir.join(EDITOR_HISTORY_FILE);
        let now = now_ms();
        let mut item = history_item("a", "stored", EditorHistoryKind::Draft);
        item.created_at_ms = now;
        write_jsonl(&path, &[item]).unwrap();
        let mut memory = Vec::new();

        switch_editor_history_store(
            &path,
            &policy(),
            &EditorHistoryPolicy {
                is_memory_only: true,
                ..policy()
            },
            &mut memory,
            now,
        )
        .unwrap();

        assert!(!path.exists());
        assert_eq!(history_texts(&memory), ["stored"]);
    }

    #[test]
    fn switching_memory_only_off_writes_the_memory_to_the_file() {
        let dir = TestDir::new("switch-off");
        let path = dir.join(EDITOR_HISTORY_FILE);
        let now = now_ms();
        let mut item = history_item("a", "in memory", EditorHistoryKind::Draft);
        item.created_at_ms = now;
        let mut memory = vec![item];

        switch_editor_history_store(
            &path,
            &EditorHistoryPolicy {
                is_memory_only: true,
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
    }

    #[test]
    fn turning_the_history_off_deletes_the_file() {
        let dir = TestDir::new("turn-off");
        let path = dir.join(EDITOR_HISTORY_FILE);
        write_jsonl(&path, &[history_item("a", "a", EditorHistoryKind::Draft)]).unwrap();

        switch_editor_history_store(
            &path,
            &policy(),
            &EditorHistoryPolicy {
                max_entries: 0,
                ..policy()
            },
            &mut Vec::new(),
            now_ms(),
        )
        .unwrap();

        assert!(!path.exists());
    }

    #[test]
    fn a_lower_limit_waits_for_the_next_write() {
        let dir = TestDir::new("lower-limit");
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
                max_entries: 1,
                ..policy()
            },
            &mut Vec::new(),
            now_ms(),
        )
        .unwrap();

        assert_eq!(read_editor_history(&path).unwrap().len(), 2);
    }

    #[test]
    fn startup_drops_expired_entries() {
        let dir = TestDir::new("startup");
        let path = dir.join(EDITOR_HISTORY_FILE);
        let now = now_ms();
        let mut fresh = history_item("fresh", "fresh", EditorHistoryKind::Draft);
        fresh.created_at_ms = now;
        let mut expired = history_item("expired", "expired", EditorHistoryKind::Draft);
        expired.created_at_ms = now - 2 * DAY_MS;
        let raw = format!(
            "{}\n{}\n",
            serde_json::to_string(&fresh).unwrap(),
            serde_json::to_string(&expired).unwrap()
        );
        fs::write(&path, raw).unwrap();
        let retention = EditorHistoryPolicy {
            retention_days: 1,
            ..policy()
        };

        enforce_editor_history_file(&path, &retention, now).unwrap();
        assert_eq!(read_editor_history(&path).unwrap(), vec![fresh]);

        enforce_editor_history_file(&path, &retention, now + 2 * DAY_MS).unwrap();
        assert!(!path.exists());
    }
}
