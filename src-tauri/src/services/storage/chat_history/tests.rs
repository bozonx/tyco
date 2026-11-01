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

fn dated(id: &str, last_message_at_ms: u64) -> Chat {
    let mut chat = chat_item(id);
    chat.last_message_at_ms = last_message_at_ms;
    chat
}

fn enabled_policy() -> ChatHistoryPolicy {
    ChatHistoryPolicy {
        is_enabled: true,
        retention_days: 0,
    }
}

/// A chat history in `dir/<name>`, its index in the state of `dir`.
fn dirs_at(dir: &Path, name: &str) -> ChatDirs {
    let chats = dir.join(name);
    fs::create_dir_all(&chats).unwrap();
    ChatDirs {
        chats,
        index: dir.join("state/index").join(name).join(CHAT_INDEX_FILE),
        orphans: dir.join("state/index").join(ORPHAN_IMAGES_FILE),
    }
}

fn dirs(dir: &Path) -> ChatDirs {
    dirs_at(dir, "chats")
}

fn ids(dirs: &ChatDirs) -> Vec<String> {
    list_chats(dirs)
        .unwrap()
        .into_iter()
        .map(|item| item.id)
        .collect()
}

#[test]
fn any_folder_keeps_its_own_chat_history() {
    let dir = TestDir::new("chat-history-folder");
    let ask = dirs_at(&dir, "chats");
    let profile = dirs_at(&dir, "profile-chats");
    let images = Mutex::new(ChatImageStore::default());

    save_chat(&profile, enabled_policy(), &images, chat_item("profile")).unwrap();

    assert!(list_chats(&ask).unwrap().is_empty());
    assert_eq!(ids(&profile), ["profile"]);

    rename_chat(&profile, "profile".into(), "Renamed".into()).unwrap();
    let chat = read_chat(&profile.chats, "profile".into())
        .unwrap()
        .unwrap();
    assert_eq!(chat.title, "Renamed");
    assert_eq!(
        search_chats(
            &profile.chats,
            list_chats(&profile).unwrap(),
            "renamed".into(),
            &ChatSearchCache::default()
        )
        .unwrap(),
        vec!["profile"]
    );

    delete_chat(&profile, "profile".into()).unwrap();
    assert!(list_chats(&profile).unwrap().is_empty());
    assert!(!profile.chats.join("profile.json").exists());
}

#[test]
fn the_chat_folder_holds_chat_files_only() {
    let dir = TestDir::new("chat-folder-files");
    let dirs = dirs(&dir);
    let images = Mutex::new(ChatImageStore::default());
    save_chat(&dirs, enabled_policy(), &images, chat_item("a")).unwrap();
    let names: Vec<_> = fs::read_dir(&dirs.chats)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names, ["a.json"]);
    list_chats(&dirs).unwrap();
    assert!(dirs.index.is_file());
}

#[test]
fn search_normalizes_the_query_once_and_an_empty_one_lists_every_chat() {
    let dir = TestDir::new("chat-search");
    let dirs = dirs(&dir);
    let images = Mutex::new(ChatImageStore::default());
    let mut trip = chat_item("trip");
    trip.title = String::from("Trip plan");
    save_chat(&dirs, enabled_policy(), &images, trip).unwrap();
    save_chat(&dirs, enabled_policy(), &images, chat_item("other")).unwrap();
    let cache = ChatSearchCache::default();
    let search = |query: &str| {
        let mut found = search_chats(
            &dirs.chats,
            list_chats(&dirs).unwrap(),
            query.into(),
            &cache,
        )
        .unwrap();
        found.sort();
        found
    };

    assert_eq!(search("  TRIP "), vec!["trip"]);
    assert_eq!(search("   "), vec!["other", "trip"]);
}

#[test]
fn search_finds_attachments_and_sees_a_changed_chat() {
    let dir = TestDir::new("chat-search-attachments");
    let dirs = dirs(&dir);
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
    save_chat(&dirs, enabled_policy(), &images, chat.clone()).unwrap();
    let search = |query: &str| {
        search_chats(
            &dirs.chats,
            list_chats(&dirs).unwrap(),
            query.into(),
            &cache,
        )
        .unwrap()
    };

    assert_eq!(search("revenue"), vec!["doc"]);
    assert_eq!(search("REPORT.PDF"), vec!["doc"]);
    assert!(search("budget").is_empty());

    chat.messages[0].content = String::from("The budget is approved and final");
    save_chat(&dirs, enabled_policy(), &images, chat).unwrap();
    assert_eq!(search("budget"), vec!["doc"]);
}

#[test]
fn a_disabled_history_stores_no_chat_in_any_folder() {
    let dir = TestDir::new("chat-history-disabled");
    let dirs = dirs(&dir);
    let images = Mutex::new(ChatImageStore::default());
    let policy = ChatHistoryPolicy {
        is_enabled: false,
        retention_days: 0,
    };

    save_chat(&dirs, policy, &images, chat_item("chat")).unwrap();

    assert!(list_chats(&dirs).unwrap().is_empty());
    assert!(!dirs.chats.join("chat.json").exists());
}

#[test]
fn a_missing_folder_reads_as_an_empty_history() {
    let dir = TestDir::new("missing-chat-folder");
    let dirs = ChatDirs {
        chats: dir.join("never-created"),
        index: dir.join("state/chats.json"),
        orphans: dir.join("state/orphans.json"),
    };

    assert!(list_chats(&dirs).unwrap().is_empty());
    assert!(read_chat(&dirs.chats, "a".into()).unwrap().is_none());
    let cache = ChatSearchCache::default();
    assert!(search_chats(&dirs.chats, Vec::new(), "x".into(), &cache)
        .unwrap()
        .is_empty());
    assert!(!dirs.chats.exists());
}

#[test]
fn a_saved_title_is_cut_to_the_rename_limit() {
    let dir = TestDir::new("save-long-title");
    let dirs = dirs(&dir);
    let images = Mutex::new(ChatImageStore::default());
    let mut chat = chat_item("long");
    chat.title = "й".repeat(MAX_CHAT_TITLE_CHARS + 10);

    save_chat(&dirs, enabled_policy(), &images, chat).unwrap();

    let title = read_chat(&dirs.chats, "long".into())
        .unwrap()
        .unwrap()
        .title;
    assert_eq!(title.chars().count(), MAX_CHAT_TITLE_CHARS);
    assert!(title.ends_with('…'));
    assert_eq!(list_chats(&dirs).unwrap()[0].title, title);
    assert_eq!(clamp_chat_title("short"), "short");
}

#[test]
fn the_search_cache_keeps_to_its_size_dropping_the_least_recently_used() {
    let dir = TestDir::new("search-cache-limit");
    let dirs = dirs(&dir);
    let images = Mutex::new(ChatImageStore::default());
    for id in ["a", "b", "c"] {
        let mut chat = chat_item(id);
        chat.title = format!("{id}{}", "x".repeat(40));
        save_chat(&dirs, enabled_policy(), &images, chat).unwrap();
    }
    // each text is 41 bytes: two fit
    let cache = ChatSearchCache::with_max_bytes(100);
    let history = list_chats(&dirs).unwrap();
    let found = search_chats(&dirs.chats, history.clone(), "x".into(), &cache).unwrap();

    assert_eq!(found.len(), 3);
    assert_eq!(cache.cached_bytes(), 82);
    // a text larger than the whole cache is searched but never kept
    let tiny = ChatSearchCache::with_max_bytes(10);
    assert_eq!(
        search_chats(&dirs.chats, history, "ax".into(), &tiny).unwrap(),
        ["a"]
    );
    assert_eq!(tiny.cached_bytes(), 0);
}

#[test]
fn an_unreadable_chat_is_set_aside_and_leaves_the_list() {
    let dir = TestDir::new("open-broken-chat");
    let dirs = dirs(&dir);
    let images = Mutex::new(ChatImageStore::default());
    for id in ["kept", "broken"] {
        save_chat(&dirs, enabled_policy(), &images, chat_item(id)).unwrap();
    }
    fs::write(dirs.chats.join("broken.json"), b"{\"id\": ").unwrap();
    assert!(read_chat(&dirs.chats, "broken".into()).is_err());

    assert!(open_chat(&dirs, "broken".into()).unwrap().is_none());

    assert_eq!(ids(&dirs), ["kept"]);
    let kept_aside = fs::read_dir(&dirs.chats).unwrap().any(|entry| {
        let name = entry.unwrap().file_name();
        name.to_string_lossy().starts_with("broken.json.broken-")
    });
    assert!(kept_aside);
    assert_eq!(open_chat(&dirs, "kept".into()).unwrap().unwrap().id, "kept");
}

#[test]
fn saving_a_chat_past_the_retention_period_keeps_it() {
    let dir = TestDir::new("save-expired-chat");
    let dirs = dirs(&dir);
    let images = Mutex::new(ChatImageStore::default());
    let policy = ChatHistoryPolicy {
        is_enabled: true,
        retention_days: 30,
    };
    // a chat whose last message is from 1970, e.g. one only renamed
    save_chat(&dirs, policy, &images, chat_item("old")).unwrap();
    assert_eq!(ids(&dirs), ["old"]);
    assert!(dirs.chats.join("old.json").exists());
}

#[test]
fn the_list_is_ordered_by_the_last_message() {
    let dir = TestDir::new("chat-order");
    let dirs = dirs(&dir);
    let images = Mutex::new(ChatImageStore::default());
    for chat in [
        dated("oldest", 10),
        dated("newest", 30),
        dated("restored", 20),
    ] {
        save_chat(&dirs, enabled_policy(), &images, chat).unwrap();
    }
    assert_eq!(ids(&dirs), ["newest", "restored", "oldest"]);
    // a rename is not activity in the chat
    rename_chat(&dirs, "oldest".into(), "Renamed".into()).unwrap();
    assert_eq!(ids(&dirs), ["newest", "restored", "oldest"]);
    assert!(serde_json::to_value(&list_chats(&dirs).unwrap()[0])
        .unwrap()
        .get("messages")
        .is_none());
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
    let mut history = vec![
        ChatSummary::from(&dated("fresh", now - DAY_MS)),
        ChatSummary::from(&dated("old", now - 38 * DAY_MS)),
        ChatSummary::from(&dated("recent", now - 29 * DAY_MS)),
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
    let dirs = dirs(&dir);
    write_json(&dirs.chats.join("chat-1.json"), &chat_item("chat-1")).unwrap();

    let policy = ChatHistoryPolicy {
        is_enabled: false,
        retention_days: 0,
    };
    enforce_chat_history_policy(&dirs, policy).unwrap();
    assert_eq!(ids(&dirs), ["chat-1"]);
}

#[cfg(unix)]
#[test]
fn rebuilding_does_not_quarantine_a_chat_that_cannot_be_read() {
    use std::os::unix::fs::PermissionsExt;
    let dir = TestDir::new("rebuild-permission-denied");
    let dirs = dirs(&dir);
    let path = dirs.chats.join("unreadable.json");
    write_json(&path, &chat_item("unreadable")).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).unwrap();
    let result = load_chat_index(&dirs);
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    assert!(
        matches!(result, Err(AppError::Io(error)) if error.kind() == std::io::ErrorKind::PermissionDenied)
    );
    assert_eq!(
        read_chat(&dirs.chats, "unreadable".into())
            .unwrap()
            .unwrap()
            .id,
        "unreadable"
    );
    assert!(!dirs.index.exists());
    assert_eq!(fs::read_dir(&dirs.chats).unwrap().count(), 1);
}

#[test]
fn a_lost_or_broken_index_is_rebuilt_from_the_chat_files() {
    let dir = TestDir::new("rebuild");
    let dirs = dirs(&dir);
    write_json(&dirs.chats.join("older.json"), &dated("older", 10)).unwrap();
    write_json(&dirs.chats.join("newer.json"), &dated("newer", 20)).unwrap();

    assert_eq!(ids(&dirs), ["newer", "older"]);
    fs::write(&dirs.index, "broken").unwrap();
    assert_eq!(ids(&dirs), ["newer", "older"]);
    fs::remove_file(&dirs.index).unwrap();
    assert_eq!(ids(&dirs), ["newer", "older"]);
}

#[test]
fn a_chat_written_by_another_device_shows_without_a_save_here() {
    let dir = TestDir::new("chat-from-sync");
    let dirs = dirs(&dir);
    let images = Mutex::new(ChatImageStore::default());
    save_chat(&dirs, enabled_policy(), &images, dated("local", 10)).unwrap();
    assert_eq!(ids(&dirs), ["local"]);
    // a sync brings a chat and changes another
    write_json(&dirs.chats.join("synced.json"), &dated("synced", 20)).unwrap();
    let mut changed = dated("local", 30);
    changed.title = String::from("Changed elsewhere");
    write_json(&dirs.chats.join("local.json"), &changed).unwrap();
    let history = list_chats(&dirs).unwrap();
    assert_eq!(history[0].title, "Changed elsewhere");
    assert_eq!(ids(&dirs), ["local", "synced"]);
    // and removes one
    fs::remove_file(dirs.chats.join("synced.json")).unwrap();
    assert_eq!(ids(&dirs), ["local"]);
}

#[test]
fn an_index_of_an_earlier_version_and_copies_of_sync_tools_are_no_chats() {
    let dir = TestDir::new("chat-foreign-files");
    let dirs = dirs(&dir);
    write_json(&dirs.chats.join("a.json"), &chat_item("a")).unwrap();
    fs::write(dirs.chats.join("index.json"), "[]").unwrap();
    write_json(
        &dirs
            .chats
            .join("a.sync-conflict-20261101-120000-ABCDEFG.json"),
        &chat_item("a"),
    )
    .unwrap();
    write_json(
        &dirs.chats.join("a (conflicted copy 2026-11-01).json"),
        &chat_item("a"),
    )
    .unwrap();
    write_json(&dirs.chats.join(".tyco-tmp-a.json-1-1"), &chat_item("a")).unwrap();
    assert_eq!(ids(&dirs), ["a"]);
    // nothing of them is set aside as a broken chat
    assert!(dirs.chats.join("index.json").exists());
    assert!(dirs
        .chats
        .join("a.sync-conflict-20261101-120000-ABCDEFG.json")
        .exists());
}

#[test]
fn rebuilding_quarantines_mismatched_ids_without_losing_their_bytes() {
    let dir = TestDir::new("rebuild-mismatch");
    let dirs = dirs(&dir);
    let raw = serde_json::to_vec(&chat_item("other")).unwrap();
    fs::write(dirs.chats.join("named.json"), &raw).unwrap();

    assert!(list_chats(&dirs).unwrap().is_empty());
    let kept = fs::read_dir(&dirs.chats)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .find(|path| path.to_string_lossy().contains("named.json.broken-"))
        .unwrap();
    assert_eq!(fs::read(kept).unwrap(), raw);
}

#[test]
fn validate_chat_id_rejects_path_traversal_and_the_old_index() {
    for id in ["", "..", "../x", "a/b", "index"] {
        assert!(validate_chat_id(id).is_err(), "{id:?}");
    }
    assert!(validate_chat_id("2b9c0f4e-7d1a").is_ok());
}

#[test]
fn a_rename_stores_a_trimmed_title_and_refuses_empty_or_long_ones() {
    let dir = TestDir::new("rename-title");
    let dirs = dirs(&dir);
    write_json(&dirs.chats.join("a.json"), &chat_item("a")).unwrap();
    rename_chat(&dirs, "a".into(), "  New title  ".into()).unwrap();
    assert_eq!(
        read_chat(&dirs.chats, "a".into()).unwrap().unwrap().title,
        "New title"
    );
    assert!(rename_chat(&dirs, "a".into(), "   ".into()).is_err());
    let long = "x".repeat(MAX_CHAT_TITLE_CHARS + 1);
    assert!(rename_chat(&dirs, "a".into(), long).is_err());
    assert_eq!(list_chats(&dirs).unwrap()[0].title, "New title");
}

#[test]
fn a_new_chat_or_one_that_keeps_its_images_drops_none() {
    let dir = TestDir::new("drops-images");
    let chat = chat_item("a");
    assert!(!drops_images(&dir, &chat));
    write_json(&dir.join("a.json"), &chat).unwrap();
    assert!(!drops_images(&dir, &chat));
    fs::write(dir.join("a.json"), "broken").unwrap();
    assert!(drops_images(&dir, &chat));
}

#[test]
fn a_chat_whose_image_is_lost_can_still_be_saved() {
    let dir = TestDir::new("chat-lost-image");
    let dirs = dirs(&dir);
    let images = Mutex::new(ChatImageStore::default());
    let mut chat = chat_item("lost");
    chat.messages.push(crate::models::ChatMessage {
        role: crate::models::ChatRole::User,
        content: String::from("look"),
        attachments: Vec::new(),
        images: vec![crate::models::ChatImage {
            id: "a".repeat(64),
            media_type: crate::models::ChatImageMediaType::Webp,
            width_px: 1,
            height_px: 1,
            size_bytes: 1,
            name: None,
        }],
        parts: Vec::new(),
        status: None,
    });

    save_chat(&dirs, enabled_policy(), &images, chat).unwrap();

    assert_eq!(
        read_chat(&dirs.chats, "lost".into())
            .unwrap()
            .unwrap()
            .messages
            .len(),
        1
    );
}

#[test]
fn retention_applies_while_the_history_is_off() {
    let dir = TestDir::new("chat-retention-off");
    let dirs = dirs(&dir);
    let images = Mutex::new(ChatImageStore::default());
    save_chat(&dirs, enabled_policy(), &images, chat_item("old")).unwrap();
    save_chat(&dirs, enabled_policy(), &images, dated("fresh", now_ms())).unwrap();

    let removed = enforce_chat_history_policy(
        &dirs,
        ChatHistoryPolicy {
            is_enabled: false,
            retention_days: 30,
        },
    )
    .unwrap();

    assert_eq!(removed, ["old"]);
    assert_eq!(ids(&dirs), ["fresh"]);
    assert!(!dirs.chats.join("old.json").exists());
}

#[test]
fn clearing_removes_the_chats_their_images_and_the_index() {
    let dir = TestDir::new("chat-clear");
    let dirs = dirs(&dir);
    let images = Mutex::new(ChatImageStore::default());
    save_chat(&dirs, enabled_policy(), &images, chat_item("a")).unwrap();
    fs::create_dir_all(dirs.images()).unwrap();
    fs::write(dirs.images().join("x.webp"), "x").unwrap();
    fs::write(dirs.chats.join("notes.txt"), "kept").unwrap();

    clear_chats(&dirs).unwrap();

    assert!(list_chats(&dirs).unwrap().is_empty());
    assert!(!dirs.images().exists());
    assert!(dirs.chats.join("notes.txt").exists());
}

#[test]
fn renaming_an_unreadable_chat_sets_it_aside() {
    let dir = TestDir::new("chat-rename-broken");
    let dirs = dirs(&dir);
    let images = Mutex::new(ChatImageStore::default());
    save_chat(&dirs, enabled_policy(), &images, chat_item("broken")).unwrap();
    fs::write(dirs.chats.join("broken.json"), "{").unwrap();

    let result = rename_chat(&dirs, "broken".into(), "New".into());

    assert!(matches!(result, Err(AppError::NotFound(_))));
    assert!(list_chats(&dirs).unwrap().is_empty());
}

#[test]
fn every_vault_keeps_its_indexes_apart() {
    let dir = TestDir::new("vault-index-dirs");
    fs::create_dir_all(dir.join("one")).unwrap();
    fs::create_dir_all(dir.join("two")).unwrap();
    let index = dir.join("index");
    let one = vault_index_dir(&index, &dir.join("one"));
    assert_ne!(one, vault_index_dir(&index, &dir.join("two")));
    assert_eq!(one, vault_index_dir(&index, &dir.join("one/../one")));
    assert!(one.starts_with(index.join("ai-vault")));
}
