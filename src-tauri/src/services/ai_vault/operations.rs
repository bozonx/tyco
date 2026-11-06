use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use super::types::{AiProfile, AiProject};
use crate::errors::AppError;
use crate::services::atomic_file::{create_private_dir, write_private};
use crate::services::file_ids::{is_file_id, MAX_FILE_ID_LEN};
use crate::services::storage::device::DeviceStore;

const PROFILE_FILE: &str = "profile.json";
/// What an internal project keeps its settings in, next to its files.
pub const PROJECT_FILE: &str = "project.json";
const SOUL_FILE: &str = "SOUL.md";
/// The chats of a profile, laid out as the app's own `chats` folder.
const PROFILE_CHATS_DIR: &str = "chats";
pub(super) use crate::desktop_contract::{
    MAX_PROFILE_TEMPERATURE as MAX_TEMPERATURE, MAX_TOOL_STEP_COUNT,
};

pub fn validate_id(id: &str) -> Result<(), AppError> {
    if id.is_empty() {
        return Err(AppError::InvalidInput("ID cannot be empty".into()));
    }
    if id.len() > MAX_FILE_ID_LEN {
        return Err(AppError::InvalidInput(format!(
            "ID cannot exceed {MAX_FILE_ID_LEN} characters"
        )));
    }
    if !is_file_id(id) {
        return Err(AppError::InvalidInput(
            "ID may only contain alphanumeric characters, hyphens, and underscores".into(),
        ));
    }
    Ok(())
}

/// The root may be a folder of the user's own: only the vault's own
/// subfolders are closed to other users.
pub fn ensure_vault_dirs(vault_root: &Path) -> Result<(), AppError> {
    if crate::services::storage::user_data::ensure_write_allowed(vault_root).is_err() {
        crate::services::storage::user_data::ensure_read_allowed(vault_root)?;
        return Ok(());
    }
    fs::create_dir_all(vault_root)?;
    create_private_dir(&vault_root.join("profiles"))?;
    create_private_dir(&vault_root.join("projects"))?;
    Ok(())
}

fn not_found(what: &str, id: &str) -> AppError {
    AppError::NotFound(format!("{what} not found: {id}"))
}

/// Reads every `<dir>/<id>/<file>` of the folder; an unreadable one is
/// skipped and logged, leaving the file for the user to fix.
fn read_entries<T: serde::de::DeserializeOwned>(
    dir: &Path,
    file: &str,
) -> Result<Vec<T>, AppError> {
    let mut entries = Vec::new();
    let listing = match fs::read_dir(dir) {
        Ok(listing) => listing,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(entries),
        Err(error) => return Err(error.into()),
    };
    for entry in listing {
        let path = entry?.path().join(file);
        if !path.is_file() {
            continue;
        }
        match fs::read_to_string(&path)
            .map_err(AppError::from)
            .and_then(|raw| Ok(serde_json::from_str::<T>(&raw)?))
        {
            Ok(value) => entries.push(value),
            Err(error) => log::warn!("Skipping unreadable {}: {error}", path.display()),
        }
    }
    Ok(entries)
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

fn profile_dir(vault_root: &Path, id: &str) -> Result<PathBuf, AppError> {
    validate_id(id)?;
    Ok(vault_root.join("profiles").join(id))
}

/// The folder of a profile that exists; nothing is created for an unknown id.
pub(super) fn existing_profile_dir(vault_root: &Path, id: &str) -> Result<PathBuf, AppError> {
    let dir = profile_dir(vault_root, id)?;
    if !dir.join(PROFILE_FILE).is_file() {
        return Err(not_found("Profile", id));
    }
    Ok(dir)
}

fn validate_profile(profile: &AiProfile) -> Result<(), AppError> {
    validate_id(&profile.id)?;
    if profile.name.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "Profile name cannot be empty".into(),
        ));
    }
    if profile
        .temperature
        .is_some_and(|value| !(0.0..=MAX_TEMPERATURE).contains(&value))
    {
        return Err(AppError::InvalidInput(
            "Temperature must be between 0 and 2".into(),
        ));
    }
    if profile
        .tools
        .as_ref()
        .and_then(|tools| tools.max_step_count)
        .is_some_and(|count| !(1..=MAX_TOOL_STEP_COUNT).contains(&count))
    {
        return Err(AppError::InvalidInput(format!(
            "Tool step count must be between 1 and {MAX_TOOL_STEP_COUNT}"
        )));
    }
    if profile.max_output_tokens == Some(0) {
        return Err(AppError::InvalidInput(
            "Maximum output tokens must be positive".into(),
        ));
    }
    Ok(())
}

fn write_profile_file(dir: &Path, profile: &AiProfile) -> Result<(), AppError> {
    write_private(
        &dir.join(PROFILE_FILE),
        &serde_json::to_string_pretty(profile)?,
    )
}

pub fn list_profiles(vault_root: &Path) -> Result<Vec<AiProfile>, AppError> {
    ensure_vault_dirs(vault_root)?;
    let mut profiles: Vec<AiProfile> = read_entries(&vault_root.join("profiles"), PROFILE_FILE)?;
    profiles.sort_by_key(|a| a.created_at);
    Ok(profiles)
}

/// The profile as it is on disk now: the user may edit the file by hand.
pub fn get_profile(vault_root: &Path, id: &str) -> Result<AiProfile, AppError> {
    let dir = existing_profile_dir(vault_root, id)?;
    Ok(serde_json::from_str(&fs::read_to_string(
        dir.join(PROFILE_FILE),
    )?)?)
}

/// Creates the profile folder with its root instruction. An existing profile
/// is never overwritten.
pub fn create_profile(vault_root: &Path, profile: AiProfile, soul: &str) -> Result<(), AppError> {
    validate_profile(&profile)?;
    ensure_vault_dirs(vault_root)?;

    let dir = profile_dir(vault_root, &profile.id)?;
    if dir.join(PROFILE_FILE).exists() {
        return Err(AppError::InvalidInput(format!(
            "Profile already exists: {}",
            profile.id
        )));
    }
    create_private_dir(&dir)?;
    create_private_dir(&dir.join(PROFILE_CHATS_DIR))?;
    let workspace = dir.join("workspace");
    for sub in ["generated", "downloads"] {
        create_private_dir(&workspace.join(sub))?;
    }
    let memory = dir.join(super::memory::PROFILE_MEMORY_DIR);
    super::memory::ensure_memory_dir_initialized(&memory)?;
    write_private(&dir.join(SOUL_FILE), soul)?;
    write_profile_file(&dir, &profile)
}

/// Updates a profile that exists; a deleted one is not brought back.
pub fn save_profile(vault_root: &Path, profile: AiProfile) -> Result<(), AppError> {
    validate_profile(&profile)?;
    let dir = existing_profile_dir(vault_root, &profile.id)?;
    write_profile_file(&dir, &profile)
}

pub fn delete_profile(
    vault_root: &Path,
    versions: &super::memory::MemoryReadVersions,
    id: &str,
) -> Result<(), AppError> {
    let dir = profile_dir(vault_root, id)?;
    if dir.exists() {
        versions.clear_profile(id);
        crate::services::storage::watcher::remove_tree(&dir)?;
    }
    Ok(())
}

/// The root instruction; a missing file is an empty one.
pub fn read_profile_soul(vault_root: &Path, id: &str) -> Result<String, AppError> {
    let soul_file = existing_profile_dir(vault_root, id)?.join(SOUL_FILE);
    match fs::read_to_string(soul_file) {
        Ok(content) => Ok(content),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(error.into()),
    }
}

pub fn write_profile_soul(vault_root: &Path, id: &str, content: &str) -> Result<(), AppError> {
    let dir = existing_profile_dir(vault_root, id)?;
    write_private(&dir.join(SOUL_FILE), content)
}

/// Where the profile keeps its chats; only an existing profile has one.
pub fn profile_chats_dir(vault_root: &Path, id: &str) -> Result<PathBuf, AppError> {
    let dir = existing_profile_chats_path(vault_root, id)?;
    create_private_dir(&dir)?;
    Ok(dir)
}

/// The chat folder of an existing profile, which may not exist yet: reading
/// chats creates nothing.
pub fn existing_profile_chats_path(vault_root: &Path, id: &str) -> Result<PathBuf, AppError> {
    Ok(existing_profile_dir(vault_root, id)?.join(PROFILE_CHATS_DIR))
}

/// The chat folders of every profile in the vault, for the history settings
/// all profiles share. Nothing is created: a vault or a profile without one
/// has no chats to keep.
pub fn all_profile_chats_dirs(vault_root: &Path) -> Result<Vec<PathBuf>, AppError> {
    let entries = match fs::read_dir(vault_root.join("profiles")) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    let mut dirs = Vec::new();
    for entry in entries {
        let dir = entry?.path();
        let is_profile = dir
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(is_file_id)
            && dir.join(PROFILE_FILE).is_file();
        let chats = dir.join(PROFILE_CHATS_DIR);
        if is_profile && chats.is_dir() {
            dirs.push(chats);
        }
    }
    dirs.sort();
    Ok(dirs)
}

/// The folder of the profile's own files, the one its file tools always reach.
pub fn profile_workspace_dir(vault_root: &Path, id: &str) -> Result<PathBuf, AppError> {
    let dir = existing_profile_dir(vault_root, id)?.join("workspace");
    create_private_dir(&dir)?;
    Ok(dir)
}

/// The folder to show the user: the vault, or one profile in it.
pub fn vault_dir_to_open(vault_root: &Path, profile_id: Option<&str>) -> Result<PathBuf, AppError> {
    ensure_vault_dirs(vault_root)?;
    match profile_id {
        Some(id) => existing_profile_dir(vault_root, id),
        None => Ok(vault_root.to_path_buf()),
    }
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

fn project_dir(vault_root: &Path, id: &str) -> Result<PathBuf, AppError> {
    validate_id(id)?;
    Ok(vault_root.join("projects").join(id))
}

/// The folders of the external projects of one vault on this device: the
/// description of a project is synced with the vault, its folder is set on
/// each device. Kept in `device.json`, see `DeviceFile::ai_project_paths`.
pub struct ProjectPaths<'a> {
    pub device: &'a DeviceStore,
    pub vault_id: &'a str,
}

impl ProjectPaths<'_> {
    fn get(&self, project_id: &str) -> Option<String> {
        self.device
            .snapshot()
            .ai_project_paths
            .get(self.vault_id)
            .and_then(|paths| paths.get(project_id))
            .cloned()
    }

    fn set(&self, project_id: &str, path: Option<&str>) -> Result<(), AppError> {
        self.device.update(|file| {
            let paths = file
                .ai_project_paths
                .entry(self.vault_id.to_owned())
                .or_default();
            match path {
                Some(path) => {
                    paths.insert(project_id.to_owned(), path.to_owned());
                }
                None => {
                    paths.remove(project_id);
                }
            }
            if paths.is_empty() {
                file.ai_project_paths.remove(self.vault_id);
            }
        })
    }

    /// Drops the folders of the projects that are gone, e.g. removed on
    /// another device.
    fn retain(&self, ids: &HashSet<&str>) -> Result<(), AppError> {
        self.device.update(|file| {
            if let Some(paths) = file.ai_project_paths.get_mut(self.vault_id) {
                paths.retain(|id, _| ids.contains(id.as_str()));
                if paths.is_empty() {
                    file.ai_project_paths.remove(self.vault_id);
                }
            }
        })
    }
}

fn validate_project(project: &AiProject) -> Result<(), AppError> {
    validate_id(&project.id)?;
    if project.name.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "Project name cannot be empty".into(),
        ));
    }
    Ok(())
}

/// The folder an external project is given on this device, checked to be an
/// existing absolute folder; `None` when none is given.
fn checked_target(project: &AiProject) -> Result<Option<&str>, AppError> {
    let Some(target) = project
        .target_path
        .as_deref()
        .map(str::trim)
        .filter(|target| !target.is_empty())
    else {
        return Ok(None);
    };
    let target_path = Path::new(target);
    if !target_path.is_absolute() || !target_path.is_dir() {
        return Err(AppError::InvalidInput(
            "External target path must be an existing absolute directory".into(),
        ));
    }
    Ok(Some(target))
}

/// The file holds the description only: the folder of an external project
/// belongs to the device.
fn write_project_file(dir: &Path, project: &AiProject) -> Result<(), AppError> {
    let shared = AiProject {
        target_path: None,
        ..project.clone()
    };
    write_private(
        &dir.join(PROJECT_FILE),
        &serde_json::to_string_pretty(&shared)?,
    )
}

/// Where the files of a project are: its own folder in the vault, or the
/// folder an external project has on this device. An external project
/// without one here is not connected: the model gets that as the result of
/// its tool, not as a failure of the chat.
pub fn project_files_dir(vault_root: &Path, project: &AiProject) -> Result<PathBuf, AppError> {
    if !project.is_external {
        return project_dir(vault_root, &project.id);
    }
    match project.target_path.as_deref().map(str::trim) {
        Some(target) if !target.is_empty() && Path::new(target).is_dir() => {
            Ok(PathBuf::from(target))
        }
        Some(target) if !target.is_empty() => Err(AppError::ProjectUnavailable(format!(
            "The project {} is not connected on this device: its folder {target} is not there",
            project.id
        ))),
        _ => Err(AppError::ProjectUnavailable(format!(
            "The project {} is not connected on this device: its folder is not set here",
            project.id
        ))),
    }
}

/// The projects of the vault, each external one with its folder on this
/// device, if it has one.
pub fn list_projects(vault_root: &Path, paths: &ProjectPaths) -> Result<Vec<AiProject>, AppError> {
    ensure_vault_dirs(vault_root)?;
    let mut projects: Vec<AiProject> = read_entries(&vault_root.join("projects"), PROJECT_FILE)?;
    projects.sort_by_key(|a| a.created_at);
    for project in &mut projects {
        project.target_path = project
            .is_external
            .then(|| paths.get(&project.id))
            .flatten();
    }
    let ids: HashSet<&str> = projects.iter().map(|project| project.id.as_str()).collect();
    if let Err(error) = paths.retain(&ids) {
        log::warn!("Could not drop the folders of removed projects: {error}");
    }
    Ok(projects)
}

/// Creates the project; an external one needs its folder on this device.
pub fn create_project(
    vault_root: &Path,
    paths: &ProjectPaths,
    project: AiProject,
) -> Result<(), AppError> {
    validate_project(&project)?;
    let target = checked_target(&project)?;
    if project.is_external && target.is_none() {
        return Err(AppError::InvalidInput(
            "External project requires a target path".into(),
        ));
    }
    ensure_vault_dirs(vault_root)?;
    let dir = project_dir(vault_root, &project.id)?;
    if dir.join(PROJECT_FILE).exists() {
        return Err(AppError::InvalidInput(format!(
            "Project already exists: {}",
            project.id
        )));
    }
    create_private_dir(&dir)?;
    write_project_file(&dir, &project)?;
    if project.is_external {
        paths.set(&project.id, target)?;
    }
    Ok(())
}

/// Updates the project. The folder given for an external project becomes
/// its folder on this device; none given leaves the one it has here.
pub fn save_project(
    vault_root: &Path,
    paths: &ProjectPaths,
    project: AiProject,
) -> Result<(), AppError> {
    validate_project(&project)?;
    let target = checked_target(&project)?;
    let dir = project_dir(vault_root, &project.id)?;
    if !dir.join(PROJECT_FILE).is_file() {
        return Err(not_found("Project", &project.id));
    }
    write_project_file(&dir, &project)?;
    match (project.is_external, target) {
        (true, Some(target)) => paths.set(&project.id, Some(target)),
        (true, None) => Ok(()),
        (false, _) => paths.set(&project.id, None),
    }
}

/// Removes the project and every profile's permissions for it. The files of
/// an external project stay where they are: only its link is removed.
pub fn delete_project(vault_root: &Path, paths: &ProjectPaths, id: &str) -> Result<(), AppError> {
    let dir = project_dir(vault_root, id)?;
    if dir.exists() {
        crate::services::storage::watcher::remove_tree(&dir)?;
    }
    paths.set(id, None)?;

    for mut profile in list_profiles(vault_root)? {
        if profile.project_permissions.remove(id).is_some() {
            let profile_dir = existing_profile_dir(vault_root, &profile.id)?;
            write_profile_file(&profile_dir, &profile)?;
        }
    }

    Ok(())
}
