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
            "renamed".into(),
            &ChatSearchCache::default()
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
    let cache = ChatSearchCache::default();
    let search = |query: &str| {
        let mut found =
            search_chats(&dir, list_chats(&dir).unwrap(), query.into(), &cache).unwrap();
        found.sort();
        found
    };

    assert_eq!(search("  TRIP "), vec!["trip"]);
    assert_eq!(search("   "), vec!["other", "trip"]);
}

#[test]
fn search_finds_attachments_and_sees_a_changed_chat() {
    let dir = TestDir::new("chat-search-attachments");
    let images = Mutex::new(ChatImageStore::default());
    let cache = ChatSearchCache::default();
    let mut chat = chat_item("doc");
    chat.messages = vec![crate::models::ChatMessage {
        role: crate::models::ChatRole::User,
        content: String::from("Look at this"),
        attachments: vec![crate::models::ChatAttachment {
            text: String::from("Quarterly revenue"),
            source: None,
            name: Some(String::from("report.pdf")),
            media_type: None,
            workspace_path: None,
        }],
        images: Vec::new(),
        parts: vec![],
        status: None,
    }];
    save_chat(&dir, enabled_policy(), &images, chat.clone()).unwrap();
    let search =
        |query: &str| search_chats(&dir, list_chats(&dir).unwrap(), query.into(), &cache).unwrap();

    assert_eq!(search("revenue"), vec!["doc"]);
    assert_eq!(search("REPORT.PDF"), vec!["doc"]);
    assert!(search("budget").is_empty());

    chat.messages[0].content = String::from("The budget is approved and final");
    save_chat(&dir, enabled_policy(), &images, chat).unwrap();
    assert_eq!(search("budget"), vec!["doc"]);
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
        staged_chat_id: None,
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
    assert!(commit_chat_transaction(&dir, Vec::new(), None).is_err());
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
            staged_chat_id: None,
        },
    )
    .unwrap();
    assert!(load_chat_index(&dir).unwrap().is_empty());
    assert!(!dir.join("removed.json").exists());
}

#[test]
fn an_invalid_save_cannot_leave_a_journal_that_blocks_other_chats() {
    let dir = TestDir::new("invalid-save");
    let history = vec![ChatSummary::from(&chat_item("../invalid"))];
    assert!(commit_chat_transaction(&dir, history, None).is_err());
    assert!(!dir.join(CHAT_TRANSACTION_FILE).exists());
    assert!(load_chat_index(&dir).unwrap().is_empty());
}

#[test]
fn a_staged_save_replays_once_and_drops_staged_leftovers() {
    let dir = TestDir::new("staged-save");
    let chat = chat_item("new");
    write_json(&staged_chat_path(&dir, "new"), &chat).unwrap();
    write_json(
        &staged_chat_path(&dir, "abandoned"),
        &chat_item("abandoned"),
    )
    .unwrap();
    write_json(
        &dir.join(CHAT_TRANSACTION_FILE),
        &PendingChatTransaction {
            history: vec![ChatSummary::from(&chat)],
            chat: None,
            staged_chat_id: Some(String::from("new")),
        },
    )
    .unwrap();

    assert_eq!(load_chat_index(&dir).unwrap()[0].id, "new");
    assert!(dir.join("new.json").exists());
    assert!(!staged_chat_path(&dir, "new").exists());
    assert!(!staged_chat_path(&dir, "abandoned").exists());
    assert!(!dir.join(CHAT_TRANSACTION_FILE).exists());
}

#[test]
fn a_save_writes_no_chat_into_the_journal() {
    let dir = TestDir::new("staged-commit");
    commit_chat_transaction(
        &dir,
        vec![ChatSummary::from(&chat_item("a"))],
        Some(chat_item("a")),
    )
    .unwrap();
    assert_eq!(read_chat(&dir, "a".into()).unwrap().unwrap().id, "a");
    assert!(!staged_chat_path(&dir, "a").exists());
    let journal = PendingChatTransaction {
        history: Vec::new(),
        chat: None,
        staged_chat_id: Some(String::from("a")),
    };
    assert!(serde_json::to_value(&journal)
        .unwrap()
        .get("chat")
        .is_none());
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
            staged_chat_id: None,
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
fn an_unreadable_chat_is_set_aside_and_leaves_the_index() {
    let dir = TestDir::new("open-broken-chat");
    let images = Mutex::new(ChatImageStore::default());
    for id in ["kept", "broken"] {
        save_chat(&dir, enabled_policy(), &images, chat_item(id)).unwrap();
    }
    fs::write(dir.join("broken.json"), b"{\"id\": ").unwrap();
    assert!(read_chat(&dir, "broken".into()).is_err());

    assert!(open_chat(&dir, "broken".into()).unwrap().is_none());

    let ids: Vec<_> = list_chats(&dir)
        .unwrap()
        .into_iter()
        .map(|item| item.id)
        .collect();
    assert_eq!(ids, ["kept"]);
    let kept_aside = fs::read_dir(&*dir).unwrap().any(|entry| {
        let name = entry.unwrap().file_name();
        name.to_string_lossy().starts_with("broken.json.broken-")
    });
    assert!(kept_aside);
    assert_eq!(open_chat(&dir, "kept".into()).unwrap().unwrap().id, "kept");
}

#[test]
fn saving_a_chat_past_the_retention_period_keeps_it() {
    let dir = TestDir::new("save-expired-chat");
    let images = Mutex::new(ChatImageStore::default());
    let policy = ChatHistoryPolicy {
        is_enabled: true,
        retention_days: 30,
    };
    // a chat whose last message is from 1970, e.g. one only renamed
    save_chat(&dir, policy, &images, chat_item("old")).unwrap();
    assert_eq!(list_chats(&dir).unwrap().len(), 1);
    assert!(dir.join("old.json").exists());
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
fn search_text_holds_the_title_and_the_messages_ignoring_case() {
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

    let text = chat_search_text(&chat);
    assert!(text.contains("trip"));
    assert!(text.contains("билеты"));
    assert!(!text.contains("hotel"));
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
fn profile_chats_follow_their_own_settings() {
    let config = json!({
        "chat": {"history": {"storage": "off"}},
        "aiProfiles": {"chatHistory": {"storage": "disk", "retentionDays": 7}}
    });
    assert_eq!(
        ChatHistoryPolicy::from_config(&config),
        ChatHistoryPolicy {
            is_enabled: false,
            retention_days: 0,
        }
    );
    assert_eq!(
        ChatHistoryPolicy::for_profiles(&config),
        ChatHistoryPolicy {
            is_enabled: true,
            retention_days: 7,
        }
    );
    assert_eq!(
        ChatHistoryPolicy::for_profiles(&json!({})),
        ChatHistoryPolicy {
            is_enabled: true,
            retention_days: 0,
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

#[test]
fn chat_history_policy_disabled_does_not_clear_chats() {
    let dir = TestDir::new("policy-disabled-keeps-chats");
    let chat = chat_item("chat-1");
    write_json(&dir.join(format!("{}.json", chat.id)), &chat).unwrap();
    write_json(&dir.join(CHAT_INDEX_FILE), &[ChatSummary::from(&chat)]).unwrap();

    let policy = ChatHistoryPolicy {
        is_enabled: false,
        retention_days: 0,
    };
    enforce_chat_history_policy(&dir, policy).unwrap();
    assert_eq!(list_chats(&dir).unwrap().len(), 1);
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
    assert!(validate_stored_chat_id(Path::new("original.json"), &chat_item("different")).is_err());
    assert!(validate_stored_chat_id(Path::new("original.json"), &chat_item("../invalid")).is_err());
    assert!(validate_stored_chat_id(Path::new("original.json"), &chat_item("original")).is_ok());
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
