//! Moving a profile or a project to another vault. The entity is copied into
//! a hidden folder of the destination and moved into place whole; the source
//! is removed only then, so a failure never loses it. Links inside the entity
//! are copied as links; one leading out of it refuses the move. Vaults are kept apart:
//! a moved profile drops its permissions for the projects it leaves behind,
//! and the profiles left behind drop theirs for a moved project.
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

use super::entity_files::{check_links, copy_tree};
use super::operations::{
    create_entity_dir, delete_project, ensure_vault_dirs, existing_profile_dir, profile_dir,
    project_dir, read_project, remove_stale_staging, ProjectPaths, PROFILE_FILE, PROJECT_FILE,
    STAGING_PREFIX,
};
use crate::errors::AppError;
use crate::services::atomic_file::write_private;

/// Where a moved entity landed: its id in the destination vault, which is
/// the old one unless that was taken there.
#[derive(Debug, Clone, Serialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct MovedEntity {
    pub id: String,
}

/// A fresh id with the prefix of `id` (`profile`, `project`).
fn fresh_id(id: &str) -> String {
    let prefix = id.split_once('-').map_or("item", |(prefix, _)| prefix);
    let suffix: String = crate::services::random_id::new_uuid()
        .chars()
        .filter(char::is_ascii_hexdigit)
        .take(8)
        .collect();
    format!("{prefix}-{suffix}")
}

/// The id `id` keeps in the destination, or a fresh one when it is taken.
fn free_id(
    id: &str,
    dir_of: impl Fn(&str) -> Result<PathBuf, AppError>,
) -> Result<String, AppError> {
    if dir_of(id)?.symlink_metadata().is_err() {
        return Ok(id.to_owned());
    }
    loop {
        let candidate = fresh_id(id);
        if dir_of(&candidate)?.symlink_metadata().is_err() {
            return Ok(candidate);
        }
    }
}

/// Rewrites the description file of an entity copied into `dir`: its `id`,
/// and whatever `edit` changes. Fields this build does not know are kept.
fn rewrite_description(
    dir: &Path,
    file: &str,
    id: &str,
    edit: impl FnOnce(&mut serde_json::Map<String, Value>),
) -> Result<(), AppError> {
    let path = dir.join(file);
    let mut value: Value = serde_json::from_str(&fs::read_to_string(&path)?)?;
    let Value::Object(object) = &mut value else {
        return Err(AppError::InvalidInput(format!(
            "{} is not an object",
            path.display()
        )));
    };
    object.insert("id".into(), Value::from(id));
    edit(object);
    write_private(&path, &serde_json::to_string_pretty(&value)?)
}

/// Copies `source` into the folder `parent/<id>` of the destination through a
/// hidden folder, applying `prepare` to the copy before it takes its place.
/// Without `source` only an empty folder is laid out for `prepare` to fill.
fn place_copy(
    parent: &Path,
    id: &str,
    source: Option<&Path>,
    prepare: impl FnOnce(&Path) -> Result<(), AppError>,
) -> Result<PathBuf, AppError> {
    remove_stale_staging(parent);
    let staging = parent.join(format!(
        "{STAGING_PREFIX}{id}-{}",
        crate::services::random_id::new_uuid()
    ));
    let target = parent.join(id);
    let laid_out = (|| -> Result<(), AppError> {
        match source {
            Some(source) => copy_tree(source, source, &staging)?,
            None => create_entity_dir(&staging)?,
        }
        prepare(&staging)?;
        if target.symlink_metadata().is_ok() {
            return Err(AppError::AlreadyExists(format!(
                "{} already exists",
                target.display()
            )));
        }
        fs::rename(&staging, &target)?;
        Ok(())
    })();
    if let Err(error) = laid_out {
        if let Err(cleanup) = crate::services::storage::watcher::remove_tree(&staging) {
            log::warn!("Could not remove {}: {cleanup}", staging.display());
        }
        return Err(error);
    }
    Ok(target)
}

fn check_other_vault(from_root: &Path, to_root: &Path) -> Result<(), AppError> {
    let same = match (fs::canonicalize(from_root), fs::canonicalize(to_root)) {
        (Ok(from), Ok(to)) => from == to,
        _ => from_root == to_root,
    };
    if same {
        return Err(AppError::InvalidInput(
            "The destination is the workspace the item is in already".into(),
        ));
    }
    Ok(())
}

/// Moves the profile `id` with its instructions, memory, files and chats from
/// the vault at `from_root` to the one at `to_root`. Its permissions for the
/// projects of the old vault are dropped. The caller holds the locks of both
/// vaults and of the chat history, and forgets the memory reads and the chat
/// index of the old profile.
pub fn move_profile(from_root: &Path, to_root: &Path, id: &str) -> Result<MovedEntity, AppError> {
    check_other_vault(from_root, to_root)?;
    let source = existing_profile_dir(from_root, id)?;
    check_links(&source)?;
    ensure_vault_dirs(to_root)?;
    let new_id = free_id(id, |id| profile_dir(to_root, id))?;
    place_copy(&to_root.join("profiles"), &new_id, Some(&source), |copy| {
        rewrite_description(copy, PROFILE_FILE, &new_id, |profile| {
            profile.insert(
                "projectPermissions".into(),
                Value::Object(Default::default()),
            );
        })
    })?;
    // the copy is in place: a failure now leaves the profile in both vaults,
    // never in none
    crate::services::storage::watcher::remove_tree(&source)?;
    Ok(MovedEntity { id: new_id })
}

/// Moves the project `id` from the vault of `from_paths` to that of
/// `to_paths`. An internal project brings its files; an external one keeps
/// its folder, which this device now knows under the new vault (other devices
/// set it again). The profiles of the old vault drop their permissions for it.
pub fn move_project(
    from_root: &Path,
    from_paths: &ProjectPaths,
    to_root: &Path,
    to_paths: &ProjectPaths,
    id: &str,
) -> Result<MovedEntity, AppError> {
    check_other_vault(from_root, to_root)?;
    let source = project_dir(from_root, id)?;
    if !source.join(PROJECT_FILE).is_file() {
        return Err(AppError::NotFound(format!("Project not found: {id}")));
    }
    let project = read_project(&source)?;
    if !project.is_external {
        check_links(&source)?;
    }
    ensure_vault_dirs(to_root)?;
    let new_id = free_id(id, |id| project_dir(to_root, id))?;
    let description = fs::read_to_string(source.join(PROJECT_FILE))?;
    let copied_source = (!project.is_external).then_some(source.as_path());
    place_copy(&to_root.join("projects"), &new_id, copied_source, |copy| {
        if project.is_external {
            write_private(&copy.join(PROJECT_FILE), &description)?;
        }
        rewrite_description(copy, PROJECT_FILE, &new_id, |_| {})
    })?;
    if project.is_external {
        if let Some(path) = from_paths.get(id) {
            to_paths.set(&new_id, Some(&path))?;
        }
    }
    delete_project(from_root, from_paths, id)?;
    Ok(MovedEntity { id: new_id })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::ai_vault::{
        create_profile, create_project, get_profile, list_profiles, list_projects, save_profile,
        AiProfile, AiProject, ProfileMemoryMode, ProjectAccessMode, ProjectPermission,
    };
    use crate::services::storage::device::{DeviceFile, DeviceStore};
    use crate::services::test_support::TestDir;
    use std::collections::HashMap;

    fn profile(id: &str) -> AiProfile {
        AiProfile {
            id: id.into(),
            name: format!("Profile {id}"),
            model_id: None,
            temperature: None,
            quick_request_model_id: None,
            max_output_tokens: None,
            project_permissions: HashMap::new(),
            tools: None,
            memory_mode: ProfileMemoryMode::Auto,
            created_at: 1,
            updated_at: 1,
            revision: None,
        }
    }

    fn project(id: &str, target: Option<&str>) -> AiProject {
        AiProject {
            id: id.into(),
            name: format!("Project {id}"),
            description: None,
            is_external: target.is_some(),
            target_path: target.map(str::to_owned),
            created_at: 1,
            updated_at: 1,
            revision: None,
            is_inside_synced_folder: None,
        }
    }

    fn paths<'a>(device: &'a DeviceStore, vault_id: &'a str) -> ProjectPaths<'a> {
        ProjectPaths {
            device,
            vault_id,
            protected_roots: Vec::new(),
        }
    }

    fn allow() -> ProjectPermission {
        ProjectPermission {
            read: ProjectAccessMode::Allow,
            write: ProjectAccessMode::Allow,
            delete: ProjectAccessMode::Ask,
        }
    }

    #[test]
    fn a_profile_moves_with_its_files_and_drops_old_permissions() {
        let dir = TestDir::new("transfer-profile");
        let (from, to) = (dir.join("from"), dir.join("to"));
        create_profile(&from, profile("profile-aaaaaaaa"), "soul").unwrap();
        let mut stored = get_profile(&from, "profile-aaaaaaaa").unwrap();
        stored
            .project_permissions
            .insert("project-bbbbbbbb".into(), allow());
        let revision = stored.revision.clone();
        save_profile(&from, stored, revision.as_deref()).unwrap();
        let note = from.join("profiles/profile-aaaaaaaa/workspace/note.md");
        fs::write(&note, "kept").unwrap();

        let moved = move_profile(&from, &to, "profile-aaaaaaaa").unwrap();

        assert_eq!(moved.id, "profile-aaaaaaaa");
        assert!(list_profiles(&from).unwrap().is_empty());
        let landed = get_profile(&to, "profile-aaaaaaaa").unwrap();
        assert!(landed.project_permissions.is_empty());
        assert_eq!(
            fs::read_to_string(to.join("profiles/profile-aaaaaaaa/workspace/note.md")).unwrap(),
            "kept"
        );
        assert_eq!(
            fs::read_to_string(to.join("profiles/profile-aaaaaaaa/SOUL.md")).unwrap(),
            "soul"
        );
    }

    #[test]
    fn a_taken_id_gets_a_fresh_one() {
        let dir = TestDir::new("transfer-profile-taken");
        let (from, to) = (dir.join("from"), dir.join("to"));
        create_profile(&from, profile("profile-aaaaaaaa"), "").unwrap();
        create_profile(&to, profile("profile-aaaaaaaa"), "").unwrap();
        let moved = move_profile(&from, &to, "profile-aaaaaaaa").unwrap();
        assert_ne!(moved.id, "profile-aaaaaaaa");
        assert!(moved.id.starts_with("profile-"));
        assert_eq!(get_profile(&to, &moved.id).unwrap().id, moved.id);
        assert_eq!(list_profiles(&to).unwrap().len(), 2);
    }

    #[test]
    fn moving_into_the_same_vault_is_refused() {
        let dir = TestDir::new("transfer-same");
        let from = dir.join("from");
        create_profile(&from, profile("profile-aaaaaaaa"), "").unwrap();
        assert!(move_profile(&from, &from, "profile-aaaaaaaa").is_err());
        assert_eq!(list_profiles(&from).unwrap().len(), 1);
    }

    #[test]
    fn an_internal_project_moves_its_files_and_old_profiles_lose_it() {
        let dir = TestDir::new("transfer-project");
        let (from, to) = (dir.join("from"), dir.join("to"));
        let device = DeviceStore::in_memory(DeviceFile::default());
        let (from_paths, to_paths) = (paths(&device, "a"), paths(&device, "b"));
        create_project(&from, &from_paths, project("project-bbbbbbbb", None)).unwrap();
        fs::write(
            from.join("projects/project-bbbbbbbb/main.rs"),
            "fn main() {}",
        )
        .unwrap();
        let mut owner = profile("profile-aaaaaaaa");
        owner
            .project_permissions
            .insert("project-bbbbbbbb".into(), allow());
        create_profile(&from, owner, "").unwrap();

        let moved = move_project(&from, &from_paths, &to, &to_paths, "project-bbbbbbbb").unwrap();

        assert!(list_projects(&from, &from_paths).unwrap().is_empty());
        assert_eq!(list_projects(&to, &to_paths).unwrap()[0].id, moved.id);
        assert!(to.join("projects/project-bbbbbbbb/main.rs").is_file());
        assert!(get_profile(&from, "profile-aaaaaaaa")
            .unwrap()
            .project_permissions
            .is_empty());
    }

    #[test]
    fn an_external_project_keeps_its_folder_on_this_device() {
        let dir = TestDir::new("transfer-project-external");
        let (from, to) = (dir.join("from"), dir.join("to"));
        let code = dir.join("code");
        fs::create_dir_all(&code).unwrap();
        fs::write(code.join("main.rs"), "").unwrap();
        let device = DeviceStore::in_memory(DeviceFile::default());
        let (from_paths, to_paths) = (paths(&device, "a"), paths(&device, "b"));
        let code_path = code.to_string_lossy().into_owned();
        create_project(
            &from,
            &from_paths,
            project("project-cccccccc", Some(&code_path)),
        )
        .unwrap();

        move_project(&from, &from_paths, &to, &to_paths, "project-cccccccc").unwrap();

        let landed = &list_projects(&to, &to_paths).unwrap()[0];
        assert!(landed.is_external);
        assert_eq!(landed.target_path.as_deref(), Some(code_path.as_str()));
        assert_eq!(from_paths.get("project-cccccccc"), None);
        assert!(code.join("main.rs").is_file());
        assert!(!to.join("projects/project-cccccccc/main.rs").exists());
    }
}
