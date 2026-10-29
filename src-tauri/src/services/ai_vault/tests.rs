use std::collections::HashMap;

use super::*;
use crate::services::test_support::TestDir;

fn profile(id: &str, created_at: u64) -> AiProfile {
    AiProfile {
        id: id.to_string(),
        name: format!("Profile {id}"),
        model_id: None,
        temperature: None,
        max_output_tokens: None,
        project_permissions: HashMap::new(),
        tools: None,
        memory_mode: ProfileMemoryMode::Auto,
        created_at,
        updated_at: created_at,
    }
}

fn project(id: &str, created_at: u64) -> AiProject {
    AiProject {
        id: id.to_string(),
        name: format!("Project {id}"),
        description: None,
        is_external: false,
        target_path: None,
        created_at,
        updated_at: created_at,
    }
}

#[test]
fn resolve_vault_path_uses_fallback_when_unconfigured_or_empty() {
    let test_dir = TestDir::new("ai_vault_fallback");
    let fallback_path = test_dir.join("default-ai-vault");
    let fallback = || Ok(fallback_path.clone());

    let resolved = resolve_vault_path_from_config(None, fallback).unwrap();
    assert_eq!(resolved, fallback_path);

    let resolved_empty = resolve_vault_path_from_config(Some(""), fallback).unwrap();
    assert_eq!(resolved_empty, fallback_path);

    let resolved_whitespace = resolve_vault_path_from_config(Some("   "), fallback).unwrap();
    assert_eq!(resolved_whitespace, fallback_path);
}

#[test]
fn resolve_vault_path_rejects_a_relative_path_instead_of_falling_back() {
    let test_dir = TestDir::new("ai_vault_relative");
    let fallback_path = test_dir.join("default-ai-vault");

    let resolved =
        resolve_vault_path_from_config(Some("relative/path/to/vault"), || Ok(fallback_path));
    assert!(resolved.is_err());
}

#[test]
fn resolve_vault_path_rejects_an_unusable_folder_instead_of_falling_back() {
    let test_dir = TestDir::new("ai_vault_unusable");
    let blocker = test_dir.join("file");
    std::fs::write(&blocker, "not a folder").unwrap();
    let configured = blocker.join("vault");
    let fallback_path = test_dir.join("default-ai-vault");

    let resolved =
        resolve_vault_path_from_config(Some(configured.to_str().unwrap()), || Ok(fallback_path));
    assert!(resolved.is_err());
}

#[test]
fn resolve_vault_path_accepts_valid_absolute_path() {
    let test_dir = TestDir::new("ai_vault_custom");
    let custom_vault = test_dir.join("my-custom-vault");
    let fallback_path = test_dir.join("default-ai-vault");
    let fallback = || Ok(fallback_path.clone());

    let resolved =
        resolve_vault_path_from_config(Some(custom_vault.to_str().unwrap()), fallback).unwrap();
    assert_eq!(resolved, custom_vault);
    assert!(custom_vault.is_dir());
}

#[cfg(unix)]
#[test]
fn the_vault_root_keeps_the_permissions_of_the_users_folder() {
    use std::os::unix::fs::PermissionsExt;
    let test_dir = TestDir::new("ai_vault_root_mode");
    let vault_root = test_dir.join("documents");
    std::fs::create_dir_all(&vault_root).unwrap();
    std::fs::set_permissions(&vault_root, std::fs::Permissions::from_mode(0o755)).unwrap();

    ensure_vault_dirs(&vault_root).unwrap();

    let mode = std::fs::metadata(&vault_root).unwrap().permissions().mode();
    assert_eq!(mode & 0o777, 0o755);
}

#[test]
fn test_validate_id() {
    assert!(validate_id("tech-writer").is_ok());
    assert!(validate_id("writer_1").is_ok());
    assert!(validate_id("").is_err());
    assert!(validate_id("..").is_err());
    assert!(validate_id(".").is_err());
    assert!(validate_id("foo/bar").is_err());
    assert!(validate_id("foo\\bar").is_err());
    assert!(validate_id("foo:bar").is_err());
    let too_long = "a".repeat(65);
    assert!(validate_id(&too_long).is_err());
}

#[test]
fn a_created_profile_has_its_folders_and_soul() {
    let test_dir = TestDir::new("ai_vault_profile_create");
    let vault_root = test_dir.join("vault");

    create_profile(&vault_root, profile("writer", 1000), "# Writer\n").unwrap();

    let dir = vault_root.join("profiles").join("writer");
    assert!(dir.join("chats").is_dir());
    for sub in ["uploads", "generated", "downloads"] {
        assert!(dir.join("workspace").join(sub).is_dir());
    }
    assert_eq!(
        read_profile_soul(&vault_root, "writer").unwrap(),
        "# Writer\n"
    );
    assert_eq!(
        list_profiles(&vault_root).unwrap(),
        vec![profile("writer", 1000)]
    );
}

#[test]
fn creating_never_overwrites_an_existing_profile() {
    let test_dir = TestDir::new("ai_vault_profile_duplicate");
    let vault_root = test_dir.join("vault");
    create_profile(&vault_root, profile("writer", 1000), "original").unwrap();

    let mut other = profile("writer", 2000);
    other.name = "Other".into();
    assert!(create_profile(&vault_root, other, "replaced").is_err());

    assert_eq!(
        get_profile(&vault_root, "writer").unwrap().name,
        "Profile writer"
    );
    assert_eq!(
        read_profile_soul(&vault_root, "writer").unwrap(),
        "original"
    );
}

#[test]
fn saving_never_brings_back_a_deleted_profile() {
    let test_dir = TestDir::new("ai_vault_profile_resurrect");
    let vault_root = test_dir.join("vault");
    create_profile(&vault_root, profile("writer", 1000), "").unwrap();
    delete_profile(&vault_root, "writer").unwrap();

    assert!(save_profile(&vault_root, profile("writer", 1000)).is_err());
    assert!(write_profile_soul(&vault_root, "writer", "soul").is_err());
    assert!(profile_chats_dir(&vault_root, "writer").is_err());
    assert!(!vault_root.join("profiles").join("writer").exists());
}

#[test]
fn profile_settings_round_trip_and_are_validated() {
    let test_dir = TestDir::new("ai_vault_profile_settings");
    let vault_root = test_dir.join("vault");
    create_profile(&vault_root, profile("writer", 1000), "").unwrap();

    let mut updated = profile("writer", 1000);
    updated.model_id = Some("model-a".into());
    updated.temperature = Some(0.4);
    updated.max_output_tokens = Some(2048);
    save_profile(&vault_root, updated.clone()).unwrap();
    assert_eq!(get_profile(&vault_root, "writer").unwrap(), updated);

    let mut hot = updated.clone();
    hot.temperature = Some(2.5);
    assert!(save_profile(&vault_root, hot).is_err());
    let mut empty = updated.clone();
    empty.max_output_tokens = Some(0);
    assert!(save_profile(&vault_root, empty).is_err());
    let mut unnamed = updated;
    unnamed.name = "  ".into();
    assert!(save_profile(&vault_root, unnamed).is_err());
}

#[test]
fn profile_temperature_accepts_the_contract_boundary_and_rejects_larger_values() {
    let test_dir = TestDir::new("ai_vault_temperature_boundary");
    let vault_root = test_dir.join("vault");
    create_profile(&vault_root, profile("writer", 1000), "").unwrap();
    let mut updated = profile("writer", 1000);
    updated.temperature = Some(operations::MAX_TEMPERATURE);
    save_profile(&vault_root, updated.clone()).unwrap();
    assert_eq!(get_profile(&vault_root, "writer").unwrap(), updated);
    updated.temperature = Some(operations::MAX_TEMPERATURE + 0.1);
    assert!(save_profile(&vault_root, updated).is_err());
}

#[test]
fn profile_tool_settings_round_trip_and_the_step_count_is_bounded() {
    let test_dir = TestDir::new("ai_vault_profile_tools");
    let vault_root = test_dir.join("vault");
    create_profile(&vault_root, profile("writer", 1000), "").unwrap();

    let mut updated = profile("writer", 1000);
    updated.tools = Some(ProfileToolSettings {
        groups: HashMap::from([(
            "debug".to_string(),
            ToolGroupSettings {
                is_enabled: true,
                access: ProjectAccessMode::Ask,
            },
        )]),
        max_step_count: Some(8),
    });
    save_profile(&vault_root, updated.clone()).unwrap();
    assert_eq!(get_profile(&vault_root, "writer").unwrap(), updated);
    let stored: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(vault_root.join("profiles/writer/profile.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(
        stored["tools"],
        serde_json::json!({"groups": {"debug": {"isEnabled": true, "access": "ask"}}, "maxStepCount": 8})
    );

    updated.tools.as_mut().unwrap().max_step_count = Some(operations::MAX_TOOL_STEP_COUNT);
    save_profile(&vault_root, updated.clone()).unwrap();
    assert_eq!(get_profile(&vault_root, "writer").unwrap(), updated);

    for count in [0, operations::MAX_TOOL_STEP_COUNT + 1] {
        let mut invalid = updated.clone();
        invalid.tools.as_mut().unwrap().max_step_count = Some(count);
        assert!(save_profile(&vault_root, invalid).is_err());
    }
}

#[test]
fn a_profile_written_with_the_last_used_model_keeps_it() {
    let test_dir = TestDir::new("ai_vault_profile_legacy");
    let vault_root = test_dir.join("vault");
    create_profile(&vault_root, profile("writer", 1000), "").unwrap();
    std::fs::write(
        vault_root.join("profiles/writer/profile.json"),
        r#"{"id":"writer","name":"Writer","icon":"mdi:pen","lastModelId":"model-a","projectPermissions":{},"createdAt":1,"updatedAt":1}"#,
    )
    .unwrap();

    let loaded = get_profile(&vault_root, "writer").unwrap();
    assert_eq!(loaded.model_id.as_deref(), Some("model-a"));
}

#[test]
fn a_missing_soul_is_an_empty_instruction() {
    let test_dir = TestDir::new("ai_vault_soul_missing");
    let vault_root = test_dir.join("vault");
    create_profile(&vault_root, profile("writer", 1000), "soul").unwrap();
    std::fs::remove_file(vault_root.join("profiles/writer/SOUL.md")).unwrap();

    assert_eq!(read_profile_soul(&vault_root, "writer").unwrap(), "");
}

#[test]
fn an_unreadable_profile_file_is_skipped() {
    let test_dir = TestDir::new("ai_vault_profile_broken");
    let vault_root = test_dir.join("vault");
    create_profile(&vault_root, profile("writer", 1000), "").unwrap();
    create_profile(&vault_root, profile("broken", 2000), "").unwrap();
    std::fs::write(vault_root.join("profiles/broken/profile.json"), "{").unwrap();

    let ids: Vec<_> = list_profiles(&vault_root)
        .unwrap()
        .into_iter()
        .map(|p| p.id)
        .collect();
    assert_eq!(ids, vec!["writer"]);
}

#[test]
fn deleting_a_profile_removes_its_folder() {
    let test_dir = TestDir::new("ai_vault_profile_delete");
    let vault_root = test_dir.join("vault");
    create_profile(&vault_root, profile("writer", 1000), "").unwrap();

    delete_profile(&vault_root, "writer").unwrap();

    assert!(!vault_root.join("profiles").join("writer").exists());
    assert!(list_profiles(&vault_root).unwrap().is_empty());
}

#[test]
fn the_folder_to_open_is_the_vault_or_an_existing_profile() {
    let test_dir = TestDir::new("ai_vault_open_dir");
    let vault_root = test_dir.join("vault");
    create_profile(&vault_root, profile("writer", 1000), "").unwrap();

    assert_eq!(vault_dir_to_open(&vault_root, None).unwrap(), vault_root);
    assert_eq!(
        vault_dir_to_open(&vault_root, Some("writer")).unwrap(),
        vault_root.join("profiles").join("writer")
    );
    assert!(vault_dir_to_open(&vault_root, Some("missing")).is_err());
    assert!(vault_dir_to_open(&vault_root, Some("../writer")).is_err());
}

#[test]
fn test_project_crud() {
    let test_dir = TestDir::new("ai_vault_project_crud");
    let vault_root = test_dir.join("vault");
    let ext_dir = test_dir.join("external_folder");
    std::fs::create_dir_all(&ext_dir).unwrap();

    create_project(&vault_root, project("internal", 1000)).unwrap();
    assert!(create_project(&vault_root, project("internal", 1500)).is_err());

    let mut external = project("external", 2000);
    external.is_external = true;
    external.target_path = Some(ext_dir.to_str().unwrap().to_string());
    create_project(&vault_root, external).unwrap();

    let ids: Vec<_> = list_projects(&vault_root)
        .unwrap()
        .into_iter()
        .map(|p| p.id)
        .collect();
    assert_eq!(ids, vec!["internal", "external"]);

    let mut bad_ext = project("bad_ext", 3000);
    bad_ext.is_external = true;
    bad_ext.target_path = Some("non_existent_folder".to_string());
    assert!(create_project(&vault_root, bad_ext).is_err());
    assert!(save_project(&vault_root, project("missing", 3000)).is_err());

    // Delete external project does not delete target_path
    delete_project(&vault_root, "external").unwrap();
    assert!(ext_dir.is_dir());
    assert_eq!(list_projects(&vault_root).unwrap().len(), 1);
}

#[test]
fn deleting_a_project_removes_the_permissions_for_it() {
    let test_dir = TestDir::new("ai_vault_project_permissions");
    let vault_root = test_dir.join("vault");
    create_project(&vault_root, project("docs", 1000)).unwrap();
    let mut writer = profile("writer", 1000);
    writer.project_permissions.insert(
        "docs".into(),
        ProjectPermission {
            read: ProjectAccessMode::Allow,
            write: ProjectAccessMode::Deny,
        },
    );
    create_profile(&vault_root, writer, "").unwrap();

    delete_project(&vault_root, "docs").unwrap();

    assert!(get_profile(&vault_root, "writer")
        .unwrap()
        .project_permissions
        .is_empty());
}

#[test]
fn profile_folders_exist_only_for_existing_profiles_with_valid_ids() {
    let test_dir = TestDir::new("ai_vault_profile_dirs");
    let vault_root = test_dir.join("vault");
    create_profile(&vault_root, profile("writer", 1000), "").unwrap();

    let chats = profile_chats_dir(&vault_root, "writer").unwrap();
    let workspace = profile_workspace_dir(&vault_root, "writer").unwrap();
    assert!(chats.is_dir() && chats.starts_with(vault_root.join("profiles/writer")));
    assert!(workspace.is_dir() && workspace.starts_with(vault_root.join("profiles/writer")));

    for result in [
        profile_chats_dir(&vault_root, "missing"),
        profile_workspace_dir(&vault_root, "missing"),
    ] {
        assert!(matches!(result, Err(AppError::NotFound(_))));
    }
    assert!(!vault_root.join("profiles/missing").exists());
    assert!(matches!(
        write_profile_soul(&vault_root, "missing", "soul"),
        Err(AppError::NotFound(_))
    ));
    for id in ["../escape", "a/b", ".", ""] {
        assert!(get_profile(&vault_root, id).is_err(), "{id}");
        assert!(profile_chats_dir(&vault_root, id).is_err(), "{id}");
        assert!(delete_project(&vault_root, id).is_err(), "{id}");
    }
}

#[test]
fn every_profile_chat_folder_is_listed_without_creating_any() {
    let test_dir = TestDir::new("ai_vault_all_profile_chats");
    let vault_root = test_dir.join("vault");
    assert!(all_profile_chats_dirs(&vault_root).unwrap().is_empty());
    assert!(!vault_root.exists());

    create_profile(&vault_root, profile("writer", 1000), "").unwrap();
    create_profile(&vault_root, profile("coder", 2000), "").unwrap();
    // a folder that is no profile, and a profile whose chats were never made
    fs::create_dir_all(vault_root.join("profiles/stray/chats")).unwrap();
    create_profile(&vault_root, profile("bare", 3000), "").unwrap();
    fs::remove_dir_all(vault_root.join("profiles/bare/chats")).unwrap();

    assert_eq!(
        all_profile_chats_dirs(&vault_root).unwrap(),
        vec![
            vault_root.join("profiles/coder/chats"),
            vault_root.join("profiles/writer/chats"),
        ]
    );
    assert!(!vault_root.join("profiles/bare/chats").exists());
}

#[test]
fn project_files_are_in_the_vault_or_the_linked_folder() {
    let test_dir = TestDir::new("ai_vault_project_files");
    let vault_root = test_dir.join("vault");
    assert_eq!(
        project_files_dir(&vault_root, &project("docs", 1)).unwrap(),
        vault_root.join("projects/docs")
    );

    let mut external = project("site", 1);
    external.is_external = true;
    external.target_path = Some(format!("  {}  ", test_dir.display()));
    assert_eq!(
        project_files_dir(&vault_root, &external).unwrap(),
        test_dir.to_path_buf()
    );
    external.target_path = Some("   ".into());
    assert!(project_files_dir(&vault_root, &external).is_err());
    external.target_path = None;
    assert!(project_files_dir(&vault_root, &external).is_err());
}

#[test]
fn projects_need_a_name_and_an_absolute_existing_external_folder() {
    let test_dir = TestDir::new("ai_vault_project_validation");
    let vault_root = test_dir.join("vault");
    let mut blank = project("blank", 1);
    blank.name = "  ".into();
    assert!(create_project(&vault_root, blank).is_err());

    let file = test_dir.join("file.txt");
    std::fs::write(&file, "").unwrap();
    for target in [
        None,
        Some("relative".to_string()),
        Some(file.display().to_string()),
    ] {
        let mut external = project("external", 1);
        external.is_external = true;
        external.target_path = target.clone();
        assert!(create_project(&vault_root, external).is_err(), "{target:?}");
    }
    assert!(list_projects(&vault_root).unwrap().is_empty());
}

#[test]
fn memory_directories_and_core_are_created_with_profile_and_lazily_for_existing() {
    let test_dir = TestDir::new("ai_vault_memory_init");
    let vault_root = test_dir.join("vault");

    // 1. New profile gets memory/ and core.md
    create_profile(&vault_root, profile("assistant", 1000), "soul instruction").unwrap();
    let memory_dir = vault_root.join("profiles/assistant/memory");
    let core_file = memory_dir.join("core.md");
    let topics_dir = memory_dir.join("topics");

    assert!(memory_dir.is_dir());
    assert!(topics_dir.is_dir());
    assert!(core_file.is_file());
    assert_eq!(fs::read_to_string(&core_file).unwrap(), DEFAULT_MEMORY_CORE);

    // 2. Existing profile without memory directory gets it lazily on get_profile / profile_memory_dir
    let legacy_profile_dir = vault_root.join("profiles/legacy");
    fs::create_dir_all(&legacy_profile_dir).unwrap();
    // Legacy profile.json without memoryMode field
    fs::write(
        legacy_profile_dir.join("profile.json"),
        r#"{"id":"legacy","name":"Legacy","projectPermissions":{},"createdAt":500,"updatedAt":500}"#,
    )
    .unwrap();
    fs::write(legacy_profile_dir.join("SOUL.md"), "legacy soul").unwrap();

    let legacy = get_profile(&vault_root, "legacy").unwrap();
    assert_eq!(legacy.memory_mode, ProfileMemoryMode::Auto);

    let legacy_mem = profile_memory_dir(&vault_root, "legacy").unwrap();
    assert!(legacy_mem.join("core.md").is_file());
    assert_eq!(
        fs::read_to_string(legacy_mem.join("core.md")).unwrap(),
        DEFAULT_MEMORY_CORE
    );
}

#[test]
fn memory_path_isolation_and_file_name_validation() {
    let test_dir = TestDir::new("ai_vault_memory_validation");
    let vault_root = test_dir.join("vault");
    create_profile(&vault_root, profile("writer", 1000), "").unwrap();

    // Valid file names
    for valid in ["core.md", "health.md", "my_notes-1.md", "topics/diet.md"] {
        assert!(normalize_and_validate_memory_file(valid).is_ok(), "{valid}");
    }

    // Invalid file names: path traversal, nested folders, upper case, invalid extensions
    for invalid in [
        "",
        "   ",
        "../core.md",
        "topics/../core.md",
        "nested/topic.md",
        "topics/nested/file.md",
        "Health.md",
        "CORE.MD",
        "notes.txt",
        "notes",
        "bad$char.md",
        ".md",
    ] {
        assert!(
            normalize_and_validate_memory_file(invalid).is_err(),
            "{invalid}"
        );
        assert!(
            read_profile_memory(&vault_root, "writer", invalid).is_err(),
            "{invalid}"
        );
        assert!(
            add_profile_memory_fact(&vault_root, "writer", None, invalid, "fact").is_err(),
            "{invalid}"
        );
    }
}

#[test]
fn memory_crud_add_replace_rewrite_and_search() {
    let test_dir = TestDir::new("ai_vault_memory_crud");
    let vault_root = test_dir.join("vault");
    create_profile(&vault_root, profile("doc", 1000), "").unwrap();

    // 1. Read core
    let core = read_profile_memory(&vault_root, "doc", "core.md").unwrap();
    assert_eq!(core, DEFAULT_MEMORY_CORE);

    // 2. Add fact to core
    let change = add_profile_memory_fact(
        &vault_root,
        "doc",
        Some("chat-1"),
        "core.md",
        "User prefers concise answers",
    )
    .unwrap();
    assert_eq!(change.file, "core.md");
    assert!(change.after.contains("- User prefers concise answers"));

    // 3. Add fact to a new topic file (creates health.md)
    let topic_change = add_profile_memory_fact(
        &vault_root,
        "doc",
        Some("chat-1"),
        "health.md",
        "Lactose intolerance",
    )
    .unwrap();
    assert_eq!(topic_change.file, "health.md");
    assert!(topic_change.after.starts_with("# Health\n\n"));
    assert!(topic_change.after.contains("- Lactose intolerance"));

    // 4. List memory topics
    let topics = list_profile_memory_topics(&vault_root, "doc").unwrap();
    assert_eq!(topics.len(), 2);
    assert_eq!(topics[0].file, "core.md");
    assert_eq!(topics[0].title, "Ядро памяти");
    assert_eq!(topics[1].file, "health.md");
    assert_eq!(topics[1].title, "Health");

    // 5. Search
    let search_results = search_profile_memory(&vault_root, "doc", "lactose").unwrap();
    assert_eq!(search_results.len(), 1);
    assert_eq!(search_results[0].file, "health.md");
    assert!(search_results[0].text.contains("Lactose intolerance"));

    // 6. Replace fact in health.md
    let replaced = replace_profile_memory(
        &vault_root,
        "doc",
        Some("chat-1"),
        "health.md",
        "- Lactose intolerance",
        "- Severe lactose intolerance (2026-10)",
    )
    .unwrap();
    assert!(replaced
        .after
        .contains("- Severe lactose intolerance (2026-10)"));
    assert!(!replaced.after.contains("- Lactose intolerance\n"));

    // 7. Delete fact via replace with empty string
    let deleted = replace_profile_memory(
        &vault_root,
        "doc",
        Some("chat-1"),
        "health.md",
        "- Severe lactose intolerance (2026-10)",
        "",
    )
    .unwrap();
    assert!(!deleted.after.contains("lactose"));

    // 8. Rewrite health.md
    let compacted = "# Health\nMedical history\n\n- No allergies\n";
    let rewritten =
        rewrite_profile_memory(&vault_root, "doc", Some("chat-1"), "health.md", compacted).unwrap();
    assert_eq!(rewritten.after, compacted);

    // List topics again: description is parsed from line 2
    let updated_topics = list_profile_memory_topics(&vault_root, "doc").unwrap();
    let health_topic = updated_topics
        .iter()
        .find(|t| t.file == "health.md")
        .unwrap();
    assert_eq!(health_topic.description.as_deref(), Some("Medical history"));

    // 9. Clear memory
    clear_profile_memory(&vault_root, "doc").unwrap();
    let cleared_topics = list_profile_memory_topics(&vault_root, "doc").unwrap();
    assert_eq!(cleared_topics.len(), 1);
    assert_eq!(cleared_topics[0].file, "core.md");
    assert_eq!(
        read_profile_memory(&vault_root, "doc", "core.md").unwrap(),
        DEFAULT_MEMORY_CORE
    );
}

#[test]
fn memory_limits_are_enforced() {
    let test_dir = TestDir::new("ai_vault_memory_limits");
    let vault_root = test_dir.join("vault");
    create_profile(&vault_root, profile("limited", 1000), "").unwrap();

    // 1. Fact exceeds MAX_MEMORY_FACT_LEN
    let oversized_fact = "a".repeat(MAX_MEMORY_FACT_LEN + 1);
    assert!(
        add_profile_memory_fact(&vault_root, "limited", None, "core.md", &oversized_fact).is_err()
    );

    // 2. File size exceeds MAX_MEMORY_FILE_BYTES
    let huge_content = "a".repeat(MAX_MEMORY_FILE_BYTES + 1);
    assert!(
        rewrite_profile_memory(&vault_root, "limited", None, "health.md", &huge_content).is_err()
    );

    // 3. Max topic files limit
    for i in 0..MAX_MEMORY_TOPIC_FILES {
        let file = format!("topic_{i}.md");
        assert!(add_profile_memory_fact(&vault_root, "limited", None, &file, "fact").is_ok());
    }
    // 51st topic file is rejected
    assert!(
        add_profile_memory_fact(&vault_root, "limited", None, "topic_extra.md", "fact").is_err()
    );
}

#[test]
fn memory_optimistic_locking_rejects_concurrent_edits() {
    let test_dir = TestDir::new("ai_vault_memory_lock");
    let vault_root = test_dir.join("vault");
    create_profile(&vault_root, profile("locked", 1000), "").unwrap();

    // 1. Read file to record its current version
    let _ = read_profile_memory(&vault_root, "locked", "core.md").unwrap();

    // 2. User modifies file directly on disk
    let core_path = vault_root.join("profiles/locked/memory/core.md");
    fs::write(&core_path, "# Modified by user in editor\n").unwrap();

    // 3. Model attempts to modify: rejected because disk != recorded hash
    let add_result = add_profile_memory_fact(
        &vault_root,
        "locked",
        None,
        "core.md",
        "Should fail due to conflict",
    );
    assert!(add_result.is_err());

    // 4. Model re-reads file to update its recorded version
    let re_read = read_profile_memory(&vault_root, "locked", "core.md").unwrap();
    assert_eq!(re_read, "# Modified by user in editor\n");

    // 5. Subsequent write succeeds
    assert!(
        add_profile_memory_fact(&vault_root, "locked", None, "core.md", "Now succeeds",).is_ok()
    );
}

#[test]
fn memory_undo_restores_snapshots_per_chat() {
    let test_dir = TestDir::new("ai_vault_memory_undo");
    let vault_root = test_dir.join("vault");
    create_profile(&vault_root, profile("undo_prof", 1000), "").unwrap();

    // Case 1: Modification of existing file (core.md)
    add_profile_memory_fact(
        &vault_root,
        "undo_prof",
        Some("chat-1"),
        "core.md",
        "First fact",
    )
    .unwrap();
    add_profile_memory_fact(
        &vault_root,
        "undo_prof",
        Some("chat-1"),
        "core.md",
        "Second fact",
    )
    .unwrap();

    let current_core = read_profile_memory(&vault_root, "undo_prof", "core.md").unwrap();
    assert!(current_core.contains("First fact") && current_core.contains("Second fact"));

    // Undo chat-1: restores core.md to pre-chat state (DEFAULT_MEMORY_CORE)
    let undone = undo_profile_memory(&vault_root, "undo_prof", Some("chat-1"), "core.md").unwrap();
    assert_eq!(undone.after, DEFAULT_MEMORY_CORE);
    assert_eq!(
        read_profile_memory(&vault_root, "undo_prof", "core.md").unwrap(),
        DEFAULT_MEMORY_CORE
    );

    // Case 2: Creation of a new topic file in chat-2
    add_profile_memory_fact(
        &vault_root,
        "undo_prof",
        Some("chat-2"),
        "allergies.md",
        "Pollen allergy",
    )
    .unwrap();
    assert!(read_profile_memory(&vault_root, "undo_prof", "allergies.md").is_ok());

    // Undo chat-2: deletes the newly created allergies.md
    let undone_topic =
        undo_profile_memory(&vault_root, "undo_prof", Some("chat-2"), "allergies.md").unwrap();
    assert_eq!(undone_topic.after, "");
    assert!(read_profile_memory(&vault_root, "undo_prof", "allergies.md").is_err());

    // Case 3: Undo when no snapshot exists returns NotFound
    assert!(matches!(
        undo_profile_memory(
            &vault_root,
            "undo_prof",
            Some("chat-nonexistent"),
            "core.md"
        ),
        Err(AppError::NotFound(_))
    ));
}
