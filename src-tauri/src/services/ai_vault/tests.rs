use std::collections::HashMap;
use std::fs;

use super::*;
use crate::services::storage::device::{DeviceFile, DeviceStore};
use crate::services::test_support::TestDir;

thread_local! {
    /// The device file of a test: each test runs on a thread of its own.
    static DEVICE: &'static DeviceStore =
        Box::leak(Box::new(DeviceStore::in_memory(DeviceFile::default())));
}

/// The folders of the external projects of the vault `v` on the device of
/// the test.
fn paths() -> ProjectPaths<'static> {
    ProjectPaths {
        device: DEVICE.with(|device| *device),
        vault_id: "v",
    }
}

fn profile(id: &str, created_at: u64) -> AiProfile {
    AiProfile {
        id: id.to_string(),
        name: format!("Profile {id}"),
        model_id: None,
        temperature: None,
        quick_request_model_id: None,
        max_output_tokens: None,
        project_permissions: HashMap::new(),
        tools: None,
        memory_mode: ProfileMemoryMode::Auto,
        created_at,
        updated_at: created_at,
        revision: None,
    }
}

/// The profile without the revision it was read with.
fn without_revision(profile: AiProfile) -> AiProfile {
    AiProfile {
        revision: None,
        ..profile
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
        revision: None,
        is_inside_synced_folder: None,
    }
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
    for sub in ["generated", "downloads"] {
        assert!(dir.join("workspace").join(sub).is_dir());
    }
    assert_eq!(
        read_profile_soul_revision(&vault_root, "writer")
            .unwrap()
            .content,
        "# Writer\n"
    );
    assert_eq!(
        list_profiles(&vault_root)
            .unwrap()
            .into_iter()
            .map(without_revision)
            .collect::<Vec<_>>(),
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
        read_profile_soul_revision(&vault_root, "writer")
            .unwrap()
            .content,
        "original"
    );
}

#[test]
fn creating_never_writes_into_a_folder_of_the_same_id() {
    let test_dir = TestDir::new("ai_vault_profile_folder_taken");
    let vault_root = test_dir.join("vault");
    // a folder a sync is still bringing: no profile.json yet
    fs::create_dir_all(vault_root.join("profiles/profile-1a2b3c4d/chats")).unwrap();
    assert!(matches!(
        create_profile(&vault_root, profile("profile-1a2b3c4d", 1000), ""),
        Err(AppError::AlreadyExists(_))
    ));
    assert!(!vault_root
        .join("profiles/profile-1a2b3c4d/profile.json")
        .exists());

    fs::create_dir_all(vault_root.join("projects/project-1a2b3c4d")).unwrap();
    assert!(matches!(
        create_project(&vault_root, &paths(), project("project-1a2b3c4d", 1000)),
        Err(AppError::AlreadyExists(_))
    ));
    // ids of any form are still read and used
    create_profile(&vault_root, profile("assistant", 1000), "").unwrap();
    assert_eq!(
        get_profile(&vault_root, "assistant").unwrap().id,
        "assistant"
    );
}

#[test]
fn a_save_over_an_outside_edit_is_refused() {
    let test_dir = TestDir::new("ai_vault_profile_revision");
    let vault_root = test_dir.join("vault");
    create_profile(&vault_root, profile("writer", 1000), "soul").unwrap();
    let read = get_profile(&vault_root, "writer").unwrap();
    let revision = read.revision.clone().unwrap();
    assert_eq!(
        list_profiles(&vault_root).unwrap()[0].revision.as_deref(),
        Some(revision.as_str())
    );

    // no edit meanwhile: the save passes and returns the next revision
    let mut edited = read.clone();
    edited.name = "First".into();
    let next = save_profile(&vault_root, edited.clone(), Some(&revision)).unwrap();
    assert_eq!(
        get_profile(&vault_root, "writer").unwrap().revision,
        Some(next.clone())
    );
    // the revision is not stored in the file
    let raw = fs::read_to_string(vault_root.join("profiles/writer/profile.json")).unwrap();
    assert!(!raw.contains("revision"));
    // a second save from the same form, with the returned revision
    edited.name = "Second".into();
    let next = save_profile(&vault_root, edited.clone(), Some(&next)).unwrap();

    // another device changes the file
    let path = vault_root.join("profiles/writer/profile.json");
    let outside = fs::read_to_string(&path)
        .unwrap()
        .replace("Second", "Remote");
    fs::write(&path, &outside).unwrap();
    edited.name = "Mine".into();
    assert!(matches!(
        save_profile(&vault_root, edited.clone(), Some(&next)),
        Err(AppError::StaleRevision(_))
    ));
    assert_eq!(fs::read_to_string(&path).unwrap(), outside);
    // without a revision, e.g. an internal write, there is no check
    save_profile(&vault_root, edited, None).unwrap();
}

#[test]
fn the_soul_and_the_project_check_their_revision() {
    let test_dir = TestDir::new("ai_vault_soul_revision");
    let vault_root = test_dir.join("vault");
    create_profile(&vault_root, profile("writer", 1000), "soul").unwrap();
    let soul = read_profile_soul_revision(&vault_root, "writer").unwrap();
    assert_eq!(soul.content, "soul");
    fs::write(vault_root.join("profiles/writer/SOUL.md"), "remote").unwrap();
    assert!(matches!(
        write_profile_soul(&vault_root, "writer", "mine", Some(&soul.revision)),
        Err(AppError::StaleRevision(_))
    ));
    // a missing file has the empty revision
    fs::remove_file(vault_root.join("profiles/writer/SOUL.md")).unwrap();
    let missing = read_profile_soul_revision(&vault_root, "writer").unwrap();
    assert_eq!(missing.revision, "");
    let written = write_profile_soul(&vault_root, "writer", "new", Some("")).unwrap();
    assert!(!written.is_empty());
    assert!(matches!(
        write_profile_soul(&vault_root, "writer", "again", Some("")),
        Err(AppError::StaleRevision(_))
    ));

    create_project(&vault_root, &paths(), project("docs", 1000)).unwrap();
    let listed = list_projects(&vault_root, &paths()).unwrap().remove(0);
    let revision = listed.revision.clone().unwrap();
    let mut renamed = listed.clone();
    renamed.name = "Renamed".into();
    let next = save_project(&vault_root, &paths(), renamed, Some(&revision)).unwrap();
    assert!(matches!(
        save_project(&vault_root, &paths(), listed, Some(&revision)),
        Err(AppError::StaleRevision(_))
    ));
    assert_eq!(
        list_projects(&vault_root, &paths()).unwrap()[0].revision,
        Some(next)
    );
}

#[test]
fn saving_never_brings_back_a_deleted_profile() {
    let versions = MemoryReadVersions::default();
    let test_dir = TestDir::new("ai_vault_profile_resurrect");
    let vault_root = test_dir.join("vault");
    create_profile(&vault_root, profile("writer", 1000), "").unwrap();
    delete_profile(&vault_root, &versions, "writer").unwrap();

    assert!(save_profile(&vault_root, profile("writer", 1000), None).is_err());
    assert!(write_profile_soul(&vault_root, "writer", "soul", None).is_err());
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
    save_profile(&vault_root, updated.clone(), None).unwrap();
    assert_eq!(
        without_revision(get_profile(&vault_root, "writer").unwrap()),
        updated
    );

    let mut hot = updated.clone();
    hot.temperature = Some(2.5);
    assert!(save_profile(&vault_root, hot, None).is_err());
    let mut empty = updated.clone();
    empty.max_output_tokens = Some(0);
    assert!(save_profile(&vault_root, empty, None).is_err());
    let mut unnamed = updated;
    unnamed.name = "  ".into();
    assert!(save_profile(&vault_root, unnamed, None).is_err());
}

#[test]
fn profile_temperature_accepts_the_contract_boundary_and_rejects_larger_values() {
    let test_dir = TestDir::new("ai_vault_temperature_boundary");
    let vault_root = test_dir.join("vault");
    create_profile(&vault_root, profile("writer", 1000), "").unwrap();
    let mut updated = profile("writer", 1000);
    updated.temperature = Some(operations::MAX_TEMPERATURE);
    save_profile(&vault_root, updated.clone(), None).unwrap();
    assert_eq!(
        without_revision(get_profile(&vault_root, "writer").unwrap()),
        updated
    );
    updated.temperature = Some(operations::MAX_TEMPERATURE + 0.1);
    assert!(save_profile(&vault_root, updated, None).is_err());
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
                command_ids: None,
            },
        )]),
        max_step_count: Some(8),
    });
    save_profile(&vault_root, updated.clone(), None).unwrap();
    assert_eq!(
        without_revision(get_profile(&vault_root, "writer").unwrap()),
        updated
    );
    let stored: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(vault_root.join("profiles/writer/profile.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(
        stored["tools"],
        serde_json::json!({"groups": {"debug": {"isEnabled": true, "access": "ask"}}, "maxStepCount": 8})
    );

    updated.tools.as_mut().unwrap().max_step_count = Some(operations::MAX_TOOL_STEP_COUNT);
    save_profile(&vault_root, updated.clone(), None).unwrap();
    assert_eq!(
        without_revision(get_profile(&vault_root, "writer").unwrap()),
        updated
    );

    for count in [0, operations::MAX_TOOL_STEP_COUNT + 1] {
        let mut invalid = updated.clone();
        invalid.tools.as_mut().unwrap().max_step_count = Some(count);
        assert!(save_profile(&vault_root, invalid, None).is_err());
    }
}

#[test]
fn a_missing_soul_is_an_empty_instruction() {
    let test_dir = TestDir::new("ai_vault_soul_missing");
    let vault_root = test_dir.join("vault");
    create_profile(&vault_root, profile("writer", 1000), "soul").unwrap();
    std::fs::remove_file(vault_root.join("profiles/writer/SOUL.md")).unwrap();

    assert_eq!(
        read_profile_soul_revision(&vault_root, "writer")
            .unwrap()
            .content,
        ""
    );
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
    let versions = MemoryReadVersions::default();
    let test_dir = TestDir::new("ai_vault_profile_delete");
    let vault_root = test_dir.join("vault");
    create_profile(&vault_root, profile("writer", 1000), "").unwrap();

    delete_profile(&vault_root, &versions, "writer").unwrap();

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

    create_project(&vault_root, &paths(), project("internal", 1000)).unwrap();
    assert!(create_project(&vault_root, &paths(), project("internal", 1500)).is_err());

    let mut external = project("external", 2000);
    external.is_external = true;
    external.target_path = Some(ext_dir.to_str().unwrap().to_string());
    create_project(&vault_root, &paths(), external).unwrap();

    let ids: Vec<_> = list_projects(&vault_root, &paths())
        .unwrap()
        .into_iter()
        .map(|p| p.id)
        .collect();
    assert_eq!(ids, vec!["internal", "external"]);

    let mut bad_ext = project("bad_ext", 3000);
    bad_ext.is_external = true;
    bad_ext.target_path = Some("non_existent_folder".to_string());
    assert!(create_project(&vault_root, &paths(), bad_ext).is_err());
    assert!(save_project(&vault_root, &paths(), project("missing", 3000), None).is_err());

    // the folder is the device's own: the file holds the description only
    let file = std::fs::read_to_string(vault_root.join("projects/external/project.json")).unwrap();
    assert!(!file.contains("targetPath"), "{file}");
    assert_eq!(
        paths().device.snapshot().ai_project_paths["v"]["external"],
        ext_dir.to_str().unwrap()
    );

    // Delete external project does not delete target_path
    delete_project(&vault_root, &paths(), "external").unwrap();
    assert!(ext_dir.is_dir());
    assert_eq!(list_projects(&vault_root, &paths()).unwrap().len(), 1);
    assert!(paths().device.snapshot().ai_project_paths.is_empty());
}

#[test]
fn an_external_project_has_its_folder_on_each_device() {
    let test_dir = TestDir::new("ai_vault_project_devices");
    let vault_root = test_dir.join("vault");
    let ext_dir = test_dir.join("site");
    std::fs::create_dir_all(&ext_dir).unwrap();
    let mut external = project("site", 1);
    external.is_external = true;
    external.target_path = Some(ext_dir.to_str().unwrap().into());
    create_project(&vault_root, &paths(), external).unwrap();

    // another device of the same vault knows the project, not its folder
    let laptop = DeviceStore::in_memory(DeviceFile::default());
    let laptop_paths = ProjectPaths {
        device: &laptop,
        vault_id: "v",
    };
    let listed = list_projects(&vault_root, &laptop_paths).unwrap();
    assert_eq!(listed[0].target_path, None);
    let error = project_files_dir(&vault_root, &listed[0]).unwrap_err();
    assert!(matches!(error, AppError::ProjectUnavailable(_)), "{error}");

    // renaming it there needs no folder and keeps that of the first device
    let mut renamed = listed[0].clone();
    renamed.name = "Site".into();
    save_project(&vault_root, &laptop_paths, renamed.clone(), None).unwrap();
    assert_eq!(
        list_projects(&vault_root, &paths()).unwrap()[0]
            .target_path
            .as_deref(),
        ext_dir.to_str()
    );
    // setting the folder there checks it
    renamed.target_path = Some("relative".into());
    assert!(save_project(&vault_root, &laptop_paths, renamed.clone(), None).is_err());
    renamed.target_path = Some(test_dir.to_str().unwrap().into());
    save_project(&vault_root, &laptop_paths, renamed, None).unwrap();
    assert_eq!(
        list_projects(&vault_root, &laptop_paths).unwrap()[0]
            .target_path
            .as_deref(),
        test_dir.to_str()
    );

    // a description a sync has not brought yet, or cannot be read now, keeps
    // the folder of this device
    let description = vault_root.join("projects/site/project.json");
    let raw = std::fs::read_to_string(&description).unwrap();
    std::fs::write(&description, "{ half written").unwrap();
    assert!(list_projects(&vault_root, &laptop_paths)
        .unwrap()
        .is_empty());
    std::fs::remove_dir_all(vault_root.join("projects/site")).unwrap();
    assert!(list_projects(&vault_root, &laptop_paths)
        .unwrap()
        .is_empty());
    std::fs::create_dir_all(vault_root.join("projects/site")).unwrap();
    std::fs::write(&description, raw).unwrap();
    assert_eq!(
        list_projects(&vault_root, &laptop_paths).unwrap()[0]
            .target_path
            .as_deref(),
        test_dir.to_str()
    );
}

#[test]
fn deleting_a_project_removes_the_permissions_for_it() {
    let test_dir = TestDir::new("ai_vault_project_permissions");
    let vault_root = test_dir.join("vault");
    create_project(&vault_root, &paths(), project("docs", 1000)).unwrap();
    let mut writer = profile("writer", 1000);
    writer.project_permissions.insert(
        "docs".into(),
        ProjectPermission {
            read: ProjectAccessMode::Allow,
            write: ProjectAccessMode::Deny,
        },
    );
    create_profile(&vault_root, writer, "").unwrap();

    delete_project(&vault_root, &paths(), "docs").unwrap();

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

    let path = existing_profile_chats_path(&vault_root, "writer").unwrap();
    assert!(matches!(
        existing_profile_chats_path(&vault_root, "missing"),
        Err(AppError::NotFound(_))
    ));
    let chats = profile_chats_dir(&vault_root, "writer").unwrap();
    assert_eq!(chats, path);
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
        write_profile_soul(&vault_root, "missing", "soul", None),
        Err(AppError::NotFound(_))
    ));
    for id in ["../escape", "a/b", ".", ""] {
        assert!(get_profile(&vault_root, id).is_err(), "{id}");
        assert!(profile_chats_dir(&vault_root, id).is_err(), "{id}");
        assert!(delete_project(&vault_root, &paths(), id).is_err(), "{id}");
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
    for target in [
        Some(String::from("   ")),
        None,
        Some(test_dir.join("gone").display().to_string()),
    ] {
        external.target_path = target;
        assert!(matches!(
            project_files_dir(&vault_root, &external),
            Err(AppError::ProjectUnavailable(_))
        ));
    }
}

#[test]
fn projects_need_a_name_and_an_absolute_existing_external_folder() {
    let test_dir = TestDir::new("ai_vault_project_validation");
    let vault_root = test_dir.join("vault");
    let mut blank = project("blank", 1);
    blank.name = "  ".into();
    assert!(create_project(&vault_root, &paths(), blank).is_err());

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
        assert!(
            create_project(&vault_root, &paths(), external).is_err(),
            "{target:?}"
        );
    }
    assert!(list_projects(&vault_root, &paths()).unwrap().is_empty());
}

#[test]
fn memory_directories_and_core_are_created_with_profile() {
    let test_dir = TestDir::new("ai_vault_memory_init");
    let vault_root = test_dir.join("vault");

    create_profile(&vault_root, profile("assistant", 1000), "soul instruction").unwrap();
    let memory_dir = vault_root.join("profiles/assistant/memory");
    let core_file = memory_dir.join("core.md");
    let topics_dir = memory_dir.join("topics");

    assert!(memory_dir.is_dir());
    assert!(topics_dir.is_dir());
    assert!(core_file.is_file());
    assert_eq!(fs::read_to_string(&core_file).unwrap(), DEFAULT_MEMORY_CORE);
}

#[test]
fn reading_profile_does_not_recreate_missing_memory() {
    let test_dir = TestDir::new("ai_vault_memory_read");
    let vault_root = test_dir.join("vault");
    let saved = profile("assistant", 1000);
    create_profile(&vault_root, saved.clone(), "soul instruction").unwrap();
    let memory_dir = vault_root.join("profiles/assistant/memory");
    fs::remove_dir_all(&memory_dir).unwrap();

    assert_eq!(
        without_revision(get_profile(&vault_root, "assistant").unwrap()),
        saved
    );
    assert_eq!(
        profile_memory_dir(&vault_root, "assistant").unwrap(),
        memory_dir
    );
    assert!(!memory_dir.exists());
}

#[test]
fn memory_path_isolation_and_file_name_validation() {
    let versions = MemoryReadVersions::default();
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
            read_profile_memory(&vault_root, &versions, "writer", invalid).is_err(),
            "{invalid}"
        );
        assert!(
            add_profile_memory_fact(&vault_root, &versions, "writer", None, invalid, "fact")
                .is_err(),
            "{invalid}"
        );
    }
}

#[test]
fn memory_crud_add_replace_rewrite_and_search() {
    let versions = MemoryReadVersions::default();
    let test_dir = TestDir::new("ai_vault_memory_crud");
    let vault_root = test_dir.join("vault");
    create_profile(&vault_root, profile("doc", 1000), "").unwrap();

    // 1. Read core
    let core = read_profile_memory(&vault_root, &versions, "doc", "core.md").unwrap();
    assert_eq!(core, DEFAULT_MEMORY_CORE);

    // 2. Add fact to core
    let change = add_profile_memory_fact(
        &vault_root,
        &versions,
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
        &versions,
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
        &versions,
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
        &versions,
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
    let rewritten = rewrite_profile_memory(
        &vault_root,
        &versions,
        "doc",
        Some("chat-1"),
        "health.md",
        compacted,
    )
    .unwrap();
    assert_eq!(rewritten.after, compacted);

    // List topics again: description is parsed from line 2
    let updated_topics = list_profile_memory_topics(&vault_root, "doc").unwrap();
    let health_topic = updated_topics
        .iter()
        .find(|t| t.file == "health.md")
        .unwrap();
    assert_eq!(health_topic.description.as_deref(), Some("Medical history"));

    // 9. Clear memory
    clear_profile_memory(&vault_root, &versions, "doc").unwrap();
    let cleared_topics = list_profile_memory_topics(&vault_root, "doc").unwrap();
    assert_eq!(cleared_topics.len(), 1);
    assert_eq!(cleared_topics[0].file, "core.md");
    assert_eq!(
        read_profile_memory(&vault_root, &versions, "doc", "core.md").unwrap(),
        DEFAULT_MEMORY_CORE
    );
}

#[test]
fn memory_limits_are_enforced() {
    let versions = MemoryReadVersions::default();
    let test_dir = TestDir::new("ai_vault_memory_limits");
    let vault_root = test_dir.join("vault");
    create_profile(&vault_root, profile("limited", 1000), "").unwrap();

    // 1. Fact exceeds MAX_MEMORY_FACT_LEN
    let oversized_fact = "a".repeat(MAX_MEMORY_FACT_LEN + 1);
    assert!(add_profile_memory_fact(
        &vault_root,
        &versions,
        "limited",
        None,
        "core.md",
        &oversized_fact
    )
    .is_err());

    // 2. File size exceeds MAX_MEMORY_FILE_BYTES
    let huge_content = "a".repeat(MAX_MEMORY_FILE_BYTES + 1);
    assert!(rewrite_profile_memory(
        &vault_root,
        &versions,
        "limited",
        None,
        "health.md",
        &huge_content
    )
    .is_err());

    // 3. Max topic files limit
    for i in 0..MAX_MEMORY_TOPIC_FILES {
        let file = format!("topic_{i}.md");
        assert!(
            add_profile_memory_fact(&vault_root, &versions, "limited", None, &file, "fact").is_ok()
        );
    }
    // 51st topic file is rejected
    assert!(add_profile_memory_fact(
        &vault_root,
        &versions,
        "limited",
        None,
        "topic_extra.md",
        "fact"
    )
    .is_err());
}

#[test]
fn memory_optimistic_locking_rejects_concurrent_edits() {
    let versions = MemoryReadVersions::default();
    let test_dir = TestDir::new("ai_vault_memory_lock");
    let vault_root = test_dir.join("vault");
    create_profile(&vault_root, profile("locked", 1000), "").unwrap();

    // 1. Read file to record its current version
    let _ = read_profile_memory(&vault_root, &versions, "locked", "core.md").unwrap();

    // 2. User modifies file directly on disk
    let core_path = vault_root.join("profiles/locked/memory/core.md");
    fs::write(&core_path, "# Modified by user in editor\n").unwrap();

    // 3. Model attempts to modify: rejected because disk != recorded hash
    let add_result = add_profile_memory_fact(
        &vault_root,
        &versions,
        "locked",
        None,
        "core.md",
        "Should fail due to conflict",
    );
    assert!(add_result.is_err());

    // 4. Model re-reads file to update its recorded version
    let re_read = read_profile_memory(&vault_root, &versions, "locked", "core.md").unwrap();
    assert_eq!(re_read, "# Modified by user in editor\n");

    // 5. Subsequent write succeeds
    assert!(add_profile_memory_fact(
        &vault_root,
        &versions,
        "locked",
        None,
        "core.md",
        "Now succeeds",
    )
    .is_ok());
}

#[test]
fn memory_undo_restores_snapshots_per_chat() {
    let versions = MemoryReadVersions::default();
    let test_dir = TestDir::new("ai_vault_memory_undo");
    let vault_root = test_dir.join("vault");
    create_profile(&vault_root, profile("undo_prof", 1000), "").unwrap();

    // Case 1: Modification of existing file (core.md)
    add_profile_memory_fact(
        &vault_root,
        &versions,
        "undo_prof",
        Some("chat-1"),
        "core.md",
        "First fact",
    )
    .unwrap();
    add_profile_memory_fact(
        &vault_root,
        &versions,
        "undo_prof",
        Some("chat-1"),
        "core.md",
        "Second fact",
    )
    .unwrap();

    let current_core = read_profile_memory(&vault_root, &versions, "undo_prof", "core.md").unwrap();
    assert!(current_core.contains("First fact") && current_core.contains("Second fact"));

    // Undo chat-1: restores core.md to pre-chat state (DEFAULT_MEMORY_CORE)
    let undone = undo_profile_memory(
        &vault_root,
        &versions,
        "undo_prof",
        Some("chat-1"),
        "core.md",
    )
    .unwrap();
    assert_eq!(undone.after, DEFAULT_MEMORY_CORE);
    assert_eq!(
        read_profile_memory(&vault_root, &versions, "undo_prof", "core.md").unwrap(),
        DEFAULT_MEMORY_CORE
    );

    // Case 2: Creation of a new topic file in chat-2
    add_profile_memory_fact(
        &vault_root,
        &versions,
        "undo_prof",
        Some("chat-2"),
        "allergies.md",
        "Pollen allergy",
    )
    .unwrap();
    assert!(read_profile_memory(&vault_root, &versions, "undo_prof", "allergies.md").is_ok());

    // Undo chat-2: deletes the newly created allergies.md
    let undone_topic = undo_profile_memory(
        &vault_root,
        &versions,
        "undo_prof",
        Some("chat-2"),
        "allergies.md",
    )
    .unwrap();
    assert_eq!(undone_topic.after, "");
    assert!(read_profile_memory(&vault_root, &versions, "undo_prof", "allergies.md").is_err());

    // Case 3: Undo when no snapshot exists returns NotFound
    assert!(matches!(
        undo_profile_memory(
            &vault_root,
            &versions,
            "undo_prof",
            Some("chat-nonexistent"),
            "core.md"
        ),
        Err(AppError::NotFound(_))
    ));

    // Case 4: Search results are bounded by MAX_MEMORY_SEARCH_RESULTS
    let mut large_topic_content = String::new();
    for i in 0..150 {
        large_topic_content.push_str(&format!("- repeated entry {}\n", i));
    }
    rewrite_profile_memory(
        &vault_root,
        &versions,
        "undo_prof",
        None,
        "large_topic.md",
        &large_topic_content,
    )
    .unwrap();
    let search_capped = search_profile_memory(&vault_root, "undo_prof", "repeated entry").unwrap();
    assert_eq!(
        search_capped.len(),
        crate::services::ai_vault::memory::MAX_MEMORY_SEARCH_RESULTS
    );
}

#[test]
fn entity_listings_ignore_conflict_folders_and_mismatched_ids() {
    let dir = TestDir::new("vault-conflict-folders");
    create_profile(&dir, profile("writer", 1), "").unwrap();
    create_project(&dir, &paths(), project("notes", 1)).unwrap();
    for (folder, file, id) in [
        ("profiles", "profile.json", "writer"),
        ("projects", "project.json", "notes"),
    ] {
        let raw = fs::read(dir.join(folder).join(id).join(file)).unwrap();
        for name in [
            format!("{id}.sync-conflict-20261110-XYZ"),
            format!("{id}-LAPTOP"),
            "other".into(),
        ] {
            let copy = dir.join(folder).join(name);
            fs::create_dir(&copy).unwrap();
            fs::write(copy.join(file), &raw).unwrap();
        }
    }
    assert_eq!(list_profiles(&dir).unwrap().len(), 1);
    assert_eq!(list_projects(&dir, &paths()).unwrap().len(), 1);
    assert!(get_profile(&dir, "other").is_err());
    // A distinct legacy id is legitimate even when its name resembles a sync copy.
    create_profile(&dir, profile("writer-DESKTOP", 2), "").unwrap();
    assert_eq!(list_profiles(&dir).unwrap().len(), 2);
}

#[test]
fn creation_returns_the_revision_of_the_bytes_written() {
    let dir = TestDir::new("vault-create-revision");
    let revision = create_profile(&dir, profile("writer", 1), "Instructions").unwrap();
    assert_eq!(
        get_profile(&dir, "writer").unwrap().revision,
        Some(revision)
    );
    let revision = create_project(&dir, &paths(), project("notes", 1)).unwrap();
    assert_eq!(
        list_projects(&dir, &paths()).unwrap()[0].revision,
        Some(revision)
    );
    let soul = read_profile_soul_revision(&dir, "writer").unwrap();
    assert_eq!(soul.revision, memory::hash_content(&soul.content));
    fs::remove_file(dir.join("profiles/writer/SOUL.md")).unwrap();
    assert_eq!(
        read_profile_soul_revision(&dir, "writer").unwrap(),
        ProfileSoul {
            content: String::new(),
            revision: String::new()
        }
    );
    fs::write(dir.join("profiles/writer/SOUL.md"), "").unwrap();
    assert_eq!(
        read_profile_soul_revision(&dir, "writer").unwrap().revision,
        memory::hash_content("")
    );
}

#[test]
fn concurrent_creation_reserves_a_folder_without_overwriting_it() {
    let dir = TestDir::new("vault-create-reservation");
    let barrier = std::sync::Barrier::new(2);
    let results = std::thread::scope(|scope| {
        let create = || {
            barrier.wait();
            create_profile(&dir, profile("writer", 1), "")
        };
        let first = scope.spawn(create);
        let second = scope.spawn(create);
        [first.join().unwrap(), second.join().unwrap()]
    });
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert!(results
        .iter()
        .any(|result| matches!(result, Err(AppError::AlreadyExists(_)))));
}

#[test]
fn memory_revision_checks_are_isolated_by_vault_even_for_equal_profile_ids() {
    let personal = TestDir::new("vault-memory-personal");
    let work = TestDir::new("vault-memory-work");
    let versions = MemoryReadVersions::default();
    for root in [&personal, &work] {
        create_profile(root, profile("writer", 1), "").unwrap();
    }
    rewrite_profile_memory(&personal, &versions, "writer", None, "core.md", "Personal").unwrap();
    rewrite_profile_memory(&work, &versions, "writer", None, "core.md", "Work").unwrap();
    read_profile_memory(&personal, &versions, "writer", "core.md").unwrap();
    read_profile_memory(&work, &versions, "writer", "core.md").unwrap();
    fs::write(personal.join("profiles/writer/memory/core.md"), "External").unwrap();
    delete_profile(&work, &versions, "writer").unwrap();
    assert!(
        rewrite_profile_memory(&personal, &versions, "writer", None, "core.md", "Mine").is_err()
    );
    assert_eq!(
        fs::read_to_string(personal.join("profiles/writer/memory/core.md")).unwrap(),
        "External"
    );
}

#[test]
fn memory_bullet_goes_to_the_end_of_its_section() {
    let text = "# Core\n\n## About the user\n\n- Lives in Kazan\n\n## Standing rules\n";
    let next = append_memory_bullet(text, "- Has a dog", Some("about the USER"));
    assert_eq!(
        next,
        "# Core\n\n## About the user\n\n- Lives in Kazan\n- Has a dog\n\n## Standing rules\n"
    );
    let rules = append_memory_bullet(&next, "- Answer briefly", Some("## Standing rules"));
    assert!(rules.ends_with("## Standing rules\n\n- Answer briefly\n"));
}

#[test]
fn memory_bullet_creates_a_missing_section_or_appends_without_one() {
    assert_eq!(
        append_memory_bullet("# Core\n\n- a\n", "- b", Some("Work")),
        "# Core\n\n- a\n\n## Work\n\n- b\n"
    );
    assert_eq!(
        append_memory_bullet("# Core\n- a", "- b", None),
        "# Core\n- a\n- b\n"
    );
    // A deeper heading inside the section stays part of it.
    assert_eq!(
        append_memory_bullet("## A\n- a\n### A1\n- a1\n## B\n", "- x", Some("A")),
        "## A\n- a\n### A1\n- a1\n- x\n\n## B\n"
    );
}

#[test]
fn new_memory_topic_keeps_its_description_for_the_outline() {
    let versions = MemoryReadVersions::default();
    let test_dir = TestDir::new("ai_vault_memory_description");
    let vault_root = test_dir.join("vault");
    create_profile(&vault_root, profile("desc", 1000), "").unwrap();

    let change = add_profile_memory_fact(
        &vault_root,
        &versions,
        "desc",
        None,
        "health.md",
        MemoryEntry {
            fact: "Lactose intolerance",
            section: None,
            description: Some("Diet,\n allergies and conditions"),
        },
    )
    .unwrap();
    assert_eq!(
        change.after,
        "# Health\n\nDiet, allergies and conditions\n\n- Lactose intolerance\n"
    );
    let topics = list_profile_memory_topics(&vault_root, "desc").unwrap();
    assert_eq!(
        topics[1].description.as_deref(),
        Some("Diet, allergies and conditions")
    );
}
