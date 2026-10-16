use std::collections::HashMap;

use super::*;
use crate::models::{Chat, ChatMessage, ChatRole};
use crate::services::test_support::TestDir;

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
fn resolve_vault_path_rejects_relative_path_and_uses_fallback() {
    let test_dir = TestDir::new("ai_vault_relative");
    let fallback_path = test_dir.join("default-ai-vault");
    let fallback = || Ok(fallback_path.clone());

    let resolved =
        resolve_vault_path_from_config(Some("relative/path/to/vault"), fallback).unwrap();
    assert_eq!(resolved, fallback_path);
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
fn test_profile_crud_and_soul() {
    let test_dir = TestDir::new("ai_vault_profile_crud");
    let vault_root = test_dir.join("vault");

    let profile = AiProfile {
        id: "writer".to_string(),
        name: "Technical Writer".to_string(),
        icon: Some("mdi:fountain-pen-tip".to_string()),
        last_model_id: Some("gpt-4o".to_string()),
        project_permissions: HashMap::new(),
        created_at: 1000,
        updated_at: 1000,
    };

    save_profile(&vault_root, profile.clone()).unwrap();

    let profiles = list_profiles(&vault_root).unwrap();
    assert_eq!(profiles.len(), 1);
    assert_eq!(profiles[0].id, "writer");
    assert_eq!(profiles[0].name, "Technical Writer");

    // Check workspace dirs created
    let profile_dir = vault_root.join("profiles").join("writer");
    assert!(profile_dir.join("history").is_dir());
    assert!(profile_dir.join("workspace").join("uploads").is_dir());
    assert!(profile_dir.join("workspace").join("generated").is_dir());
    assert!(profile_dir.join("workspace").join("downloads").is_dir());

    // Check default SOUL.md
    let soul = read_profile_soul(&vault_root, "writer").unwrap();
    assert!(soul.contains("System Prompt"));

    // Write custom SOUL.md
    write_profile_soul(&vault_root, "writer", "# Custom Persona").unwrap();
    let updated_soul = read_profile_soul(&vault_root, "writer").unwrap();
    assert_eq!(updated_soul, "# Custom Persona");

    // Delete profile
    delete_profile(&vault_root, "writer").unwrap();
    assert!(!profile_dir.exists());
    assert_eq!(list_profiles(&vault_root).unwrap().len(), 0);
}

#[test]
fn test_project_crud() {
    let test_dir = TestDir::new("ai_vault_project_crud");
    let vault_root = test_dir.join("vault");
    let ext_dir = test_dir.join("external_folder");
    std::fs::create_dir_all(&ext_dir).unwrap();

    let internal_proj = AiProject {
        id: "internal".to_string(),
        name: "Internal Project".to_string(),
        description: Some("Description".to_string()),
        is_external: false,
        target_path: None,
        created_at: 1000,
        updated_at: 1000,
    };
    save_project(&vault_root, internal_proj).unwrap();

    let external_proj = AiProject {
        id: "external".to_string(),
        name: "External Project".to_string(),
        description: None,
        is_external: true,
        target_path: Some(ext_dir.to_str().unwrap().to_string()),
        created_at: 2000,
        updated_at: 2000,
    };
    save_project(&vault_root, external_proj).unwrap();

    let projects = list_projects(&vault_root).unwrap();
    assert_eq!(projects.len(), 2);
    assert_eq!(projects[0].id, "internal");
    assert_eq!(projects[1].id, "external");

    // Reject external project with non-existent or relative path
    let bad_ext = AiProject {
        id: "bad_ext".to_string(),
        name: "Bad".to_string(),
        description: None,
        is_external: true,
        target_path: Some("non_existent_folder".to_string()),
        created_at: 3000,
        updated_at: 3000,
    };
    assert!(save_project(&vault_root, bad_ext).is_err());

    // Delete external project does not delete target_path
    delete_project(&vault_root, "external").unwrap();
    assert!(ext_dir.is_dir());
    assert_eq!(list_projects(&vault_root).unwrap().len(), 1);
}

#[test]
fn test_profile_chat_history() {
    let test_dir = TestDir::new("ai_vault_profile_chats");
    let vault_root = test_dir.join("vault");

    let profile = AiProfile {
        id: "coder".to_string(),
        name: "Coder".to_string(),
        icon: None,
        last_model_id: None,
        project_permissions: HashMap::new(),
        created_at: 1000,
        updated_at: 1000,
    };
    save_profile(&vault_root, profile).unwrap();

    let chat = Chat {
        id: "chat-1".to_string(),
        title: "Hello world".to_string(),
        last_message_at: "2026-10-15T12:00:00Z".to_string(),
        messages: vec![ChatMessage {
            role: ChatRole::User,
            content: "Hi".to_string(),
            attachments: vec![],
            images: vec![],
            status: None,
        }],
    };

    save_profile_chat(&vault_root, "coder", chat.clone()).unwrap();

    let chats = list_profile_chats(&vault_root, "coder").unwrap();
    assert_eq!(chats.len(), 1);
    assert_eq!(chats[0].id, "chat-1");
    assert_eq!(chats[0].title, "Hello world");

    let loaded = get_profile_chat(&vault_root, "coder", "chat-1").unwrap();
    assert!(loaded.is_some());
    assert_eq!(loaded.unwrap().title, "Hello world");

    rename_profile_chat(&vault_root, "coder", "chat-1", "Renamed").unwrap();
    let renamed = get_profile_chat(&vault_root, "coder", "chat-1").unwrap();
    assert_eq!(renamed.unwrap().title, "Renamed");

    let found_by_title = search_profile_chats(&vault_root, "coder", "rename").unwrap();
    assert_eq!(found_by_title, vec!["chat-1"]);

    let found_by_msg = search_profile_chats(&vault_root, "coder", "Hi").unwrap();
    assert_eq!(found_by_msg, vec!["chat-1"]);

    let found_none = search_profile_chats(&vault_root, "coder", "nonexistent").unwrap();
    assert!(found_none.is_empty());

    delete_profile_chat(&vault_root, "coder", "chat-1").unwrap();
    assert_eq!(list_profile_chats(&vault_root, "coder").unwrap().len(), 0);
}
