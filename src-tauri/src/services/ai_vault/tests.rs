use std::collections::HashMap;

use super::*;
use crate::services::test_support::TestDir;

fn profile(id: &str, created_at: u64) -> AiProfile {
    AiProfile {
        id: id.to_string(),
        name: format!("Profile {id}"),
        icon: None,
        model_id: None,
        temperature: None,
        max_output_tokens: None,
        project_permissions: HashMap::new(),
        tools: None,
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
    updated.icon = Some("mdi:robot-outline".into());
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
    for icon in ["robot", "mdi:", "mdi:Robot", "mdi:robot/../x"] {
        let mut odd_icon = updated.clone();
        odd_icon.icon = Some(icon.into());
        assert!(save_profile(&vault_root, odd_icon).is_err(), "{icon}");
    }
    let mut unnamed = updated;
    unnamed.name = "  ".into();
    assert!(save_profile(&vault_root, unnamed).is_err());
}

/// The limits are checked on both sides of the IPC boundary.
#[test]
fn profile_limits_match_the_shared_package() {
    let shared = include_str!("../../../../packages/shared/src/ai-profiles.ts");
    let declared = |name: &str| {
        shared
            .lines()
            .find_map(|line| line.strip_prefix(&format!("export const {name} = ")))
            .unwrap_or_else(|| panic!("{name} is not declared in @tyco/shared"))
            .trim()
            .to_owned()
    };
    assert_eq!(
        declared("MAX_PROFILE_TEMPERATURE").parse::<f64>().unwrap(),
        operations::MAX_TEMPERATURE
    );
    assert_eq!(
        declared("MAX_TOOL_STEP_COUNT").parse::<u32>().unwrap(),
        operations::MAX_TOOL_STEP_COUNT
    );
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

    for count in [0, 51] {
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
