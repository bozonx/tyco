use std::fs;

use super::relocation::*;
use super::*;
use crate::services::test_support::TestDir;

fn vault_with_profile(root: &std::path::Path) {
    let profile = AiProfile {
        id: "writer".into(),
        name: "Writer".into(),
        model_id: None,
        temperature: None,
        max_output_tokens: None,
        project_permissions: Default::default(),
        tools: None,
        created_at: 1,
        updated_at: 1,
    };
    create_profile(root, profile, "soul").unwrap();
}

#[test]
fn a_target_is_told_apart_by_what_it_holds() {
    let dir = TestDir::new("vault_target_kinds");
    let current = dir.join("current");
    vault_with_profile(&current);

    assert_eq!(
        inspect_target(&current, &current).unwrap(),
        VaultTargetKind::Current
    );
    assert_eq!(
        inspect_target(&current, &dir.join("missing/deep")).unwrap(),
        VaultTargetKind::Empty
    );
    fs::create_dir_all(dir.join("empty")).unwrap();
    assert_eq!(
        inspect_target(&current, &dir.join("empty")).unwrap(),
        VaultTargetKind::Empty
    );

    let other = dir.join("other");
    vault_with_profile(&other);
    assert_eq!(
        inspect_target(&current, &other).unwrap(),
        VaultTargetKind::Vault {
            profile_count: 1,
            project_count: 0
        }
    );

    let documents = dir.join("documents");
    fs::create_dir_all(&documents).unwrap();
    fs::write(documents.join("notes.txt"), "x").unwrap();
    assert_eq!(
        inspect_target(&current, &documents).unwrap(),
        VaultTargetKind::Occupied {
            subfolder_path: documents
                .canonicalize()
                .unwrap()
                .join(VAULT_SUBFOLDER_NAME)
                .to_string_lossy()
                .into_owned()
        }
    );

    assert_eq!(
        inspect_target(&current, &current.join("profiles")).unwrap(),
        VaultTargetKind::Nested
    );
    assert_eq!(
        inspect_target(&current, &dir.join(".")).unwrap(),
        VaultTargetKind::Nested
    );
    assert!(inspect_target(&current, std::path::Path::new("relative")).is_err());
}

#[test]
fn moving_takes_every_file_along() {
    let dir = TestDir::new("vault_move");
    let from = dir.join("from");
    vault_with_profile(&from);
    fs::write(from.join("profiles/writer/workspace/note.md"), "hello").unwrap();
    let to = dir.join("to");

    move_vault(&from, &to).unwrap();

    assert_eq!(
        fs::read_to_string(to.join("profiles/writer/workspace/note.md")).unwrap(),
        "hello"
    );
    assert_eq!(list_profiles(&to).unwrap().len(), 1);
    assert!(!from.join("profiles").exists());
}

#[test]
fn moving_into_a_folder_with_files_is_refused() {
    let dir = TestDir::new("vault_move_refused");
    let from = dir.join("from");
    vault_with_profile(&from);
    let to = dir.join("to");
    fs::create_dir_all(&to).unwrap();
    fs::write(to.join("keep.txt"), "x").unwrap();

    assert!(move_vault(&from, &to).is_err());
    assert!(from.join("profiles/writer/profile.json").is_file());
    assert!(move_vault(&from, &from.join("profiles/inner")).is_err());
}

#[test]
fn moving_a_vault_that_was_never_created_is_nothing_to_do() {
    let dir = TestDir::new("vault_move_missing");
    move_vault(&dir.join("never"), &dir.join("to")).unwrap();
    assert!(dir.join("to").is_dir());
}
