use super::*;
use crate::models::EditorHistoryKind;
use crate::services::storage::test_support::{history_item, history_texts, TestDir};
use crate::services::storage::DAY_MS;
use serde_json::json;

fn policy() -> EditorHistoryPolicy {
    EditorHistoryPolicy {
        max_entries: 100,
        is_memory_only: false,
        retention_days: 0,
        should_redact_secrets: false,
    }
}

fn entry(text: &str) -> EditorHistoryEntry {
    serde_json::from_value(json!({ "text": text, "kind": "draft" })).unwrap()
}

#[test]
fn cleanup_failure_preserves_the_committed_policy_and_can_be_retried() {
    let dir = TestDir::new("post-commit-cleanup");
    let path = dir.join(EDITOR_HISTORY_FILE);
    let mut memory = Vec::new();
    write_jsonl(
        &path,
        &[history_item("a", "private", EditorHistoryKind::Draft)],
    )
    .unwrap();
    let after = EditorHistoryPolicy {
        max_entries: 0,
        ..policy()
    };
    let HistoryCommit {
        value: revision,
        is_cleanup_pending: pending,
    } = commit_history_transition(&path, &policy(), &after, &mut memory, || {
        // Simulate a filesystem failure after the config has committed.
        fs::remove_file(&path).unwrap();
        fs::create_dir(&path).unwrap();
        Ok(1u64)
    })
    .unwrap();
    assert_eq!(revision, 1);
    assert!(pending);
    fs::remove_dir(&path).unwrap();
    let HistoryCommit {
        is_cleanup_pending: pending,
        ..
    } = commit_history_transition(&path, &after, &after, &mut memory, || Ok(2u64)).unwrap();
    assert!(!pending);
    assert!(!path.exists());
}

#[test]
fn config_write_failure_never_deletes_disabled_history() {
    let dir = TestDir::new("failed-disable");
    let path = dir.join(EDITOR_HISTORY_FILE);
    let items = vec![history_item("a", "private", EditorHistoryKind::Draft)];
    write_jsonl(&path, &items).unwrap();
    let after = EditorHistoryPolicy {
        max_entries: 0,
        ..policy()
    };
    let result = commit_history_transition(&path, &policy(), &after, &mut Vec::new(), || {
        Err::<(), _>(AppError::Io(std::io::Error::other("Disk unavailable")))
    });
    assert!(result.is_err());
    assert_eq!(read_file_records(&path).unwrap(), items);
}

#[test]
fn failed_config_commit_preserves_editor_disk_and_memory() {
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
    let result: Result<HistoryCommit<()>, AppError> =
        commit_history_transition(&path, &policy(), &after, &mut memory, || {
            Err(AppError::Failed("Config storage failed".into()))
        });
    assert!(result.is_err());
    assert!(memory.is_empty());
    assert_eq!(fs::read(&path).unwrap(), original);
}

#[test]
fn failed_config_commit_restores_memory_after_prepared_disk_write() {
    let dir = TestDir::new("failed-chat-after-write");
    let path = dir.join(EDITOR_HISTORY_FILE);
    let mut memory = vec![history_item("a", "private", EditorHistoryKind::Draft)];
    let original = memory.clone();
    let before = EditorHistoryPolicy {
        is_memory_only: true,
        ..policy()
    };
    let result: Result<HistoryCommit<()>, AppError> =
        commit_history_transition(&path, &before, &policy(), &mut memory, || {
            Err(AppError::Failed("Config storage failed".into()))
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
    assert!(switch_editor_history_store(&path, &before, &policy(), &mut memory, now_ms()).is_err());
    assert_eq!(memory, original);
}

#[test]
fn development_mode_blocks_disk_and_memory_writes_without_removing_existing_history() {
    let dir = TestDir::new("development-disabled");
    let path = dir.join(EDITOR_HISTORY_FILE);
    let existing = vec![history_item("existing", "saved", EditorHistoryKind::Draft)];
    let mut file_store = EditorHistoryTarget::File(path.clone());
    file_store.write(existing.clone()).unwrap();
    let original = fs::read(&path).unwrap();
    let mut memory = existing.clone();
    for store in [file_store, EditorHistoryTarget::Memory(&mut memory)] {
        let mut history = EditorHistorySession {
            store,
            policy: policy(),
            is_in_development: false,
        };
        assert_eq!(
            save_editor_history_entry(&mut history, entry("new")).unwrap(),
            None
        );
        assert!(history.load().unwrap().is_empty());
        history.save(Vec::new()).unwrap();
    }
    assert_eq!(fs::read(&path).unwrap(), original);
    assert_eq!(memory, existing);
}

#[test]
fn save_editor_history_entry_masks_secrets_when_enabled() {
    let dir = TestDir::new("save-secrets");
    let path = dir.join(EDITOR_HISTORY_FILE);
    let mut history = EditorHistorySession {
        is_in_development: true,
        store: EditorHistoryTarget::File(path.clone()),
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
    let mut history = EditorHistorySession {
        is_in_development: true,
        store: EditorHistoryTarget::File(path.clone()),
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
    let mut history = EditorHistorySession {
        is_in_development: true,
        store: EditorHistoryTarget::Memory(&mut memory),
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
    let mut store = EditorHistoryTarget::File(path.clone());

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
        history_texts(&read_file_records(&path).unwrap()),
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

    assert_eq!(read_file_records(&path).unwrap().len(), 2);
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
    assert_eq!(read_file_records(&path).unwrap(), vec![fresh]);

    enforce_editor_history_file(&path, &retention, now + 2 * DAY_MS).unwrap();
    assert!(!path.exists());
}
