use super::*;
use crate::models::EditorHistoryKind;
use crate::services::storage::test_support::{history_item, history_texts, TestDir};
use crate::services::storage::DAY_MS;
use serde_json::json;

const LAPTOP: &str = "0b7d6f0e-1c2a-4b3c-8d4e-5f6a7b8c9d0e";
const DESKTOP: &str = "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d";

fn policy() -> EditorHistoryPolicy {
    EditorHistoryPolicy {
        is_recording: true,
        max_entries: 100,
        is_memory_only: false,
        retention_days: 0,
        should_redact_secrets: false,
        is_local_only: false,
    }
}

fn memory_only() -> EditorHistoryPolicy {
    EditorHistoryPolicy {
        is_memory_only: true,
        ..policy()
    }
}

fn entry(text: &str) -> EditorHistoryEntry {
    serde_json::from_value(json!({ "text": text, "kind": "draft" })).unwrap()
}

fn recent(id: &str, text: &str) -> EditorHistoryItem {
    let mut item = history_item(id, text, EditorHistoryKind::Draft);
    item.created_at_ms = now_ms();
    item
}

fn own(location: &HistoryLocation) -> PathBuf {
    location.own_path(false).unwrap()
}

fn write_items(path: &Path, items: &[EditorHistoryItem]) {
    write_records(
        path,
        &items
            .iter()
            .cloned()
            .map(HistoryRecord::Item)
            .collect::<Vec<_>>(),
    )
    .unwrap();
}

/// A session of the device `location` over its journals.
fn session<'a>(
    location: &HistoryLocation,
    policy: EditorHistoryPolicy,
) -> EditorHistorySession<'a> {
    EditorHistorySession {
        store: EditorHistoryTarget::Journals {
            location: location.clone(),
            own: location.own_path(policy.is_local_only).unwrap(),
        },
        policy,
    }
}

fn texts(location: &HistoryLocation) -> Vec<String> {
    session(location, policy())
        .load()
        .unwrap()
        .into_iter()
        .map(|item| item.text)
        .collect()
}

#[test]
fn cleanup_failure_preserves_the_committed_policy_and_can_be_retried() {
    let dir = TestDir::new("post-commit-cleanup");
    let location = HistoryLocation::at(&dir, LAPTOP);
    let path = own(&location);
    let mut memory = Vec::new();
    write_items(&path, &[recent("a", "private")]);
    let HistoryCommit {
        value: revision,
        is_cleanup_pending: pending,
    } = commit_history_transition(&location, &policy(), &memory_only(), &mut memory, || {
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
    } = commit_history_transition(
        &location,
        &memory_only(),
        &memory_only(),
        &mut memory,
        || Ok(2u64),
    )
    .unwrap();
    assert!(!pending);
    assert!(!path.exists());
}

#[test]
fn config_write_failure_never_deletes_the_journal() {
    let dir = TestDir::new("failed-disable");
    let location = HistoryLocation::at(&dir, LAPTOP);
    let path = own(&location);
    write_items(&path, &[recent("a", "private")]);
    let original = fs::read(&path).unwrap();
    let mut memory = Vec::new();
    let result =
        commit_history_transition(&location, &policy(), &memory_only(), &mut memory, || {
            Err::<(), _>(AppError::Io(std::io::Error::other("Disk unavailable")))
        });
    assert!(result.is_err());
    assert!(memory.is_empty());
    assert_eq!(fs::read(&path).unwrap(), original);
}

#[test]
fn failed_config_commit_restores_memory_after_prepared_disk_write() {
    let dir = TestDir::new("failed-after-write");
    let location = HistoryLocation::at(&dir, LAPTOP);
    let mut memory = vec![recent("a", "private")];
    let original = memory.clone();
    let result: Result<HistoryCommit<()>, AppError> =
        commit_history_transition(&location, &memory_only(), &policy(), &mut memory, || {
            Err(AppError::Failed("Config storage failed".into()))
        });
    assert!(result.is_err());
    assert_eq!(memory, original);
    assert!(!own(&location).exists());
}

#[test]
fn save_editor_history_entry_masks_secrets_when_enabled() {
    let dir = TestDir::new("save-secrets");
    let location = HistoryLocation::at(&dir, LAPTOP);
    let mut history = session(
        &location,
        EditorHistoryPolicy {
            should_redact_secrets: true,
            ..policy()
        },
    );

    save_editor_history_entry(
        &mut history,
        entry("Here is my key: sk-proj-1234567890abcdef1234567890"),
    )
    .unwrap();

    let raw = fs::read_to_string(own(&location)).unwrap();
    assert!(raw.contains("[REDACTED API KEY]"));
    assert!(!raw.contains("sk-proj-"));
}

#[test]
fn save_editor_history_entry_stores_nothing_when_the_history_is_off() {
    let dir = TestDir::new("save-off");
    let location = HistoryLocation::at(&dir, LAPTOP);
    let mut history = session(
        &location,
        EditorHistoryPolicy {
            is_recording: false,
            ..policy()
        },
    );

    assert_eq!(
        save_editor_history_entry(&mut history, entry("text")).unwrap(),
        None
    );
    assert!(!own(&location).exists());
}

#[test]
fn the_memory_store_never_touches_the_disk() {
    let dir = TestDir::new("memory-store");
    let mut memory = Vec::new();
    let mut history = EditorHistorySession {
        store: EditorHistoryTarget::Memory(&mut memory),
        policy: memory_only(),
    };

    save_editor_history_entry(&mut history, entry("kept in memory")).unwrap();

    assert_eq!(history_texts(&memory), ["kept in memory"]);
    assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
}

#[test]
fn each_device_writes_its_own_journal_and_reads_them_all() {
    let dir = TestDir::new("two-devices");
    let laptop = HistoryLocation::at(&dir, LAPTOP);
    let desktop = HistoryLocation::at(&dir, DESKTOP);

    save_editor_history_entry(&mut session(&laptop, policy()), entry("from the laptop")).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(2));
    save_editor_history_entry(&mut session(&desktop, policy()), entry("from the desktop")).unwrap();

    assert_eq!(texts(&laptop), ["from the desktop", "from the laptop"]);
    assert_eq!(texts(&desktop), texts(&laptop));
    let laptop_raw = fs::read_to_string(own(&laptop)).unwrap();
    assert!(laptop_raw.contains("from the laptop") && !laptop_raw.contains("desktop"));
    let desktop_raw = fs::read_to_string(own(&desktop)).unwrap();
    assert!(desktop_raw.contains("from the desktop") && !desktop_raw.contains("laptop"));
}

#[test]
fn changes_to_entries_of_another_device_stay_in_the_own_journal() {
    let dir = TestDir::new("foreign-changes");
    let laptop = HistoryLocation::at(&dir, LAPTOP);
    let desktop = HistoryLocation::at(&dir, DESKTOP);
    let mut source = recent("source", "text");
    source.kind = EditorHistoryKind::Source;
    write_items(&own(&desktop), &[recent("other", "other"), source]);
    let desktop_raw = fs::read(own(&desktop)).unwrap();

    let mut history = session(&laptop, policy());
    let before = history.load().unwrap();
    let mut items = before.clone();
    apply_editor_history_result(&mut items, "source", String::from("Text."));
    history.save(&before, items).unwrap();
    let before = history.load().unwrap();
    let mut items = before.clone();
    items.retain(|item| item.id != "other");
    history.save(&before, items).unwrap();

    let merged = session(&desktop, policy()).load().unwrap();
    assert_eq!(history_texts(&merged), ["text"]);
    assert_eq!(merged[0].result.as_deref(), Some("Text."));
    assert_eq!(fs::read(own(&desktop)).unwrap(), desktop_raw);
}

#[test]
fn a_restored_entry_of_a_journal_comes_back_under_a_new_id() {
    let dir = TestDir::new("restore-journal");
    let location = HistoryLocation::at(&dir, LAPTOP);
    let removed = recent("removed", "removed");
    write_items(&own(&location), std::slice::from_ref(&removed));
    let mut history = session(&location, policy());
    let before = history.load().unwrap();
    history.save(&before, Vec::new()).unwrap();
    assert!(texts(&location).is_empty());

    restore_item(&mut history, removed).unwrap();

    let restored = session(&location, policy()).load().unwrap();
    assert_eq!(history_texts(&restored), ["removed"]);
    assert_ne!(restored[0].id, "removed");
}

#[test]
fn clearing_on_one_device_hides_the_entries_of_every_device() {
    let dir = TestDir::new("clear");
    let laptop = HistoryLocation::at(&dir, LAPTOP);
    let desktop = HistoryLocation::at(&dir, DESKTOP);
    write_items(&own(&desktop), &[recent("other", "other")]);
    write_items(&own(&laptop), &[recent("own", "own")]);
    let mut memory = vec![recent("memory", "memory")];

    clear_history(&laptop, &policy(), &mut memory, now_ms()).unwrap();

    assert!(memory.is_empty());
    assert!(texts(&laptop).is_empty());
    assert!(texts(&desktop).is_empty());
    assert!(own(&desktop).exists(), "another device's journal stays");
    // what the other device adds later shows
    std::thread::sleep(std::time::Duration::from_millis(2));
    save_editor_history_entry(&mut session(&desktop, policy()), entry("later")).unwrap();
    assert_eq!(texts(&laptop), ["later"]);
}

#[test]
fn a_local_history_stays_out_of_the_user_data_folder() {
    let dir = TestDir::new("local-only");
    let location = HistoryLocation::at(&dir, LAPTOP);
    let desktop = HistoryLocation::at(&dir, DESKTOP);
    write_items(&own(&desktop), &[recent("other", "from the desktop")]);
    let local = EditorHistoryPolicy {
        is_local_only: true,
        ..policy()
    };

    save_editor_history_entry(&mut session(&location, local), entry("private")).unwrap();

    assert!(!own(&location).exists());
    assert!(location
        .own_path(true)
        .unwrap()
        .starts_with(dir.join("state")));
    let mut texts: Vec<_> = session(&location, local)
        .load()
        .unwrap()
        .into_iter()
        .map(|item| item.text)
        .collect();
    texts.sort();
    assert_eq!(texts, ["from the desktop", "private"]);
}

#[test]
fn turning_local_only_on_and_off_moves_the_own_journal() {
    let dir = TestDir::new("local-only-move");
    let location = HistoryLocation::at(&dir, LAPTOP);
    let shared = own(&location);
    let local_path = location.own_path(true).unwrap();
    write_items(&shared, &[recent("a", "mine")]);
    let local = EditorHistoryPolicy {
        is_local_only: true,
        ..policy()
    };

    commit_history_transition(&location, &policy(), &local, &mut Vec::new(), || Ok(())).unwrap();
    assert!(!shared.exists());
    assert_eq!(
        history_texts(&merge_journals(&[read_records(&local_path).unwrap()])),
        ["mine"]
    );

    commit_history_transition(&location, &local, &policy(), &mut Vec::new(), || Ok(())).unwrap();
    assert!(!local_path.exists());
    assert_eq!(
        history_texts(&merge_journals(&[read_records(&shared).unwrap()])),
        ["mine"]
    );
}

#[test]
fn a_failed_commit_leaves_the_journal_where_it_was() {
    let dir = TestDir::new("local-only-failed");
    let location = HistoryLocation::at(&dir, LAPTOP);
    let shared = own(&location);
    write_items(&shared, &[recent("a", "mine")]);
    let local = EditorHistoryPolicy {
        is_local_only: true,
        ..policy()
    };
    let result = commit_history_transition(&location, &policy(), &local, &mut Vec::new(), || {
        Err::<(), _>(AppError::Failed("Config storage failed".into()))
    });
    assert!(result.is_err());
    assert!(shared.exists());
    assert!(!location.own_path(true).unwrap().exists());
}

#[test]
fn switching_to_memory_only_moves_the_journals_into_memory() {
    let dir = TestDir::new("switch-on");
    let location = HistoryLocation::at(&dir, LAPTOP);
    write_items(&own(&location), &[recent("a", "stored")]);
    let mut memory = Vec::new();

    commit_history_transition(&location, &policy(), &memory_only(), &mut memory, || Ok(()))
        .unwrap();

    assert!(!own(&location).exists());
    assert_eq!(history_texts(&memory), ["stored"]);
}

#[test]
fn switching_memory_only_off_writes_the_memory_to_the_journal() {
    let dir = TestDir::new("switch-off");
    let location = HistoryLocation::at(&dir, LAPTOP);
    let mut memory = vec![recent("a", "in memory")];

    commit_history_transition(&location, &memory_only(), &policy(), &mut memory, || Ok(()))
        .unwrap();

    assert!(memory.is_empty());
    assert_eq!(texts(&location), ["in memory"]);
}

#[test]
fn turning_the_history_off_keeps_the_journal() {
    let dir = TestDir::new("turn-off");
    let location = HistoryLocation::at(&dir, LAPTOP);
    write_items(&own(&location), &[recent("a", "a")]);
    let original = fs::read(own(&location)).unwrap();
    let off = EditorHistoryPolicy {
        is_recording: false,
        ..policy()
    };

    commit_history_transition(&location, &policy(), &off, &mut Vec::new(), || Ok(())).unwrap();
    assert_eq!(fs::read(own(&location)).unwrap(), original);

    // and turning it on again keeps it as well
    commit_history_transition(&location, &off, &policy(), &mut Vec::new(), || Ok(())).unwrap();
    assert_eq!(fs::read(own(&location)).unwrap(), original);
}

#[test]
fn turning_the_memory_only_history_off_keeps_it_in_memory() {
    let dir = TestDir::new("session-off");
    let location = HistoryLocation::at(&dir, LAPTOP);
    let mut memory = vec![recent("a", "in memory")];
    let off = EditorHistoryPolicy {
        is_recording: false,
        ..policy()
    };

    commit_history_transition(&location, &memory_only(), &off, &mut memory, || Ok(())).unwrap();
    assert_eq!(history_texts(&memory), ["in memory"]);
    assert!(!own(&location).exists());
    assert!(is_in_memory(&off, &memory));

    // turned on on the disk, what the memory kept goes to the journal
    commit_history_transition(&location, &off, &policy(), &mut memory, || Ok(())).unwrap();
    assert!(memory.is_empty());
    assert_eq!(texts(&location), ["in memory"]);
}

#[test]
fn a_restored_item_needs_a_valid_id_and_a_past_time() {
    let mut item = history_item("18f-2a", "text", EditorHistoryKind::Draft);
    item.created_at_ms = 500;
    validate_restored_item(&mut item, 100).unwrap();
    assert_eq!(item.created_at_ms, 100);

    for id in ["", "../x", "a b", &"a".repeat(65)] {
        let mut item = history_item(id, "text", EditorHistoryKind::Draft);
        assert!(validate_restored_item(&mut item, 100).is_err(), "{id}");
    }
}

#[test]
fn a_lower_limit_applies_to_the_own_journal_at_once() {
    let dir = TestDir::new("lower-limit");
    let location = HistoryLocation::at(&dir, LAPTOP);
    write_items(&own(&location), &[recent("a", "a"), recent("b", "b")]);

    commit_history_transition(
        &location,
        &policy(),
        &EditorHistoryPolicy {
            max_entries: 1,
            ..policy()
        },
        &mut Vec::new(),
        || Ok(()),
    )
    .unwrap();

    assert_eq!(read_records(&own(&location)).unwrap().len(), 1);
}

#[test]
fn the_limits_apply_to_the_merged_history_when_read() {
    let dir = TestDir::new("merged-limit");
    let laptop = HistoryLocation::at(&dir, LAPTOP);
    let desktop = HistoryLocation::at(&dir, DESKTOP);
    let mut older = recent("older", "older");
    older.created_at_ms -= 10;
    write_items(&own(&desktop), &[older]);
    write_items(&own(&laptop), &[recent("newer", "newer")]);
    let limited = EditorHistoryPolicy {
        max_entries: 1,
        ..policy()
    };
    assert_eq!(
        history_texts(&session(&laptop, limited).load().unwrap()),
        ["newer"]
    );
    // a change on one device never deletes what is over the limit on another
    std::thread::sleep(std::time::Duration::from_millis(2));
    save_editor_history_entry(&mut session(&laptop, limited), entry("newest")).unwrap();
    assert_eq!(read_records(&own(&desktop)).unwrap().len(), 1);
    assert_eq!(texts(&desktop), ["newest", "newer", "older"]);
}

#[test]
fn startup_drops_expired_entries_of_the_own_journal() {
    let dir = TestDir::new("startup");
    let location = HistoryLocation::at(&dir, LAPTOP);
    let desktop = HistoryLocation::at(&dir, DESKTOP);
    let now = now_ms();
    let fresh = recent("fresh", "fresh");
    let mut expired = history_item("expired", "expired", EditorHistoryKind::Draft);
    expired.created_at_ms = now - 2 * DAY_MS;
    write_items(&own(&location), &[expired.clone(), fresh.clone()]);
    write_items(&own(&desktop), &[expired]);
    let retention = EditorHistoryPolicy {
        retention_days: 1,
        ..policy()
    };

    enforce_policy(&location, &retention, now).unwrap();
    assert_eq!(
        read_records(&own(&location)).unwrap(),
        vec![HistoryRecord::Item(fresh)]
    );
    // the journal of the other device is only read
    assert_eq!(read_records(&own(&desktop)).unwrap().len(), 1);

    enforce_policy(&location, &retention, now + 2 * DAY_MS).unwrap();
    assert!(!own(&location).exists());
}

#[test]
fn conflicting_copies_of_a_journal_are_not_read_as_devices() {
    let dir = TestDir::new("journal-copies");
    let location = HistoryLocation::at(&dir, LAPTOP);
    write_items(&own(&location), &[recent("a", "mine")]);
    let copy = own(&location).with_file_name(format!(
        "{LAPTOP}.sync-conflict-20261101-120000-ABCDEFG.jsonl"
    ));
    write_items(&copy, &[recent("b", "copy")]);
    write_items(
        &own(&location).with_file_name("notes.jsonl"),
        &[recent("c", "other")],
    );
    assert_eq!(texts(&location), ["mine"]);
}

#[test]
fn read_only_history_remains_readable_and_cannot_be_changed() {
    let dir = TestDir::new("history-read-only");
    let location = HistoryLocation::at(&dir, LAPTOP);
    write_items(&own(&location), &[recent("saved", "text")]);
    let user = dir.join("user");
    fs::write(user.join("tyco-user.json"), r#"{"formatVersion":2}"#).unwrap();
    let data = super::super::user_data::UserData::resolve(&user, "");
    super::super::user_data::register_write_guard(&data);
    assert_eq!(texts(&location), ["text"]);
    let mut history = session(&location, policy());
    assert!(save_editor_history_entry(&mut history, entry("new")).is_err());
    assert_eq!(texts(&location), ["text"]);
}

#[test]
fn input_checkpoints_replace_one_record_and_promote_it_without_a_duplicate() {
    let mut memory = Vec::new();
    let mut history = EditorHistorySession {
        store: EditorHistoryTarget::Memory(&mut memory),
        policy: memory_only(),
    };
    let id = save_editor_history_entry(&mut history, entry("first words"))
        .unwrap()
        .unwrap();
    let checkpoint =
        serde_json::from_value(json!({"id": id, "text": "more words", "kind": "draft"})).unwrap();
    assert_eq!(
        save_editor_history_entry(&mut history, checkpoint).unwrap(),
        Some(id.clone())
    );
    let items = history.load().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].text, "more words");
    let source = serde_json::from_value(
        json!({"id": id, "text": "final words", "kind": "source", "operation": "voiceCorrection"}),
    )
    .unwrap();
    save_editor_history_entry(&mut history, source).unwrap();
    let late =
        serde_json::from_value(json!({"id": id, "text": "late partial", "kind": "draft"})).unwrap();
    save_editor_history_entry(&mut history, late).unwrap();
    let items = history.load().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].id, id);
    assert_eq!(items[0].text, "final words");
    assert_eq!(items[0].kind, EditorHistoryKind::Source);
}

#[test]
fn checkpoint_updates_do_not_resurrect_deleted_records() {
    let mut memory = Vec::new();
    let mut history = EditorHistorySession {
        store: EditorHistoryTarget::Memory(&mut memory),
        policy: memory_only(),
    };
    let checkpoint =
        serde_json::from_value(json!({"id": "deleted", "text": "late partial", "kind": "draft"}))
            .unwrap();
    assert_eq!(
        save_editor_history_entry(&mut history, checkpoint).unwrap(),
        None
    );
    assert!(history.load().unwrap().is_empty());
}

#[test]
fn disk_checkpoints_keep_only_the_latest_text_in_the_own_journal() {
    let dir = TestDir::new("input-checkpoints");
    let location = HistoryLocation::at(&dir, LAPTOP);
    let mut history = session(&location, policy());
    let id = save_editor_history_entry(&mut history, entry("first"))
        .unwrap()
        .unwrap();
    for text in ["second", "third", "final"] {
        let checkpoint =
            serde_json::from_value(json!({"id": id, "text": text, "kind": "draft"})).unwrap();
        save_editor_history_entry(&mut history, checkpoint).unwrap();
    }
    assert_eq!(read_records(&own(&location)).unwrap().len(), 1);
    assert_eq!(history.load().unwrap()[0].text, "final");
}
