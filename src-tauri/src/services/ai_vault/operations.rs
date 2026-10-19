use std::fs;
use std::path::{Path, PathBuf};

use super::types::{AiProfile, AiProject};
use crate::errors::AppError;
use crate::services::atomic_file::{create_private_dir, write_private};
use crate::services::file_ids::{is_file_id, MAX_FILE_ID_LEN};

const PROFILE_FILE: &str = "profile.json";
/// What an internal project keeps its settings in, next to its files.
pub const PROJECT_FILE: &str = "project.json";
const SOUL_FILE: &str = "SOUL.md";
/// The chats of a profile, laid out as the app's own `chats` folder.
const PROFILE_CHATS_DIR: &str = "chats";
const MAX_TEMPERATURE: f64 = 2.0;
/// Mirrors MAX_TOOL_STEP_COUNT in shared.
const MAX_TOOL_STEP_COUNT: u32 = 50;

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
    fs::create_dir_all(vault_root)?;
    create_private_dir(&vault_root.join("profiles"))?;
    create_private_dir(&vault_root.join("projects"))?;
    Ok(())
}

fn not_found(what: &str, id: &str) -> AppError {
    AppError::InvalidInput(format!("{what} not found: {id}"))
}

/// Reads every `<dir>/<id>/<file>` of the folder; an unreadable one is
/// skipped and logged, leaving the file for the user to fix.
fn read_entries<T: serde::de::DeserializeOwned>(
    dir: &Path,
    file: &str,
) -> Result<Vec<T>, AppError> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(dir)? {
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
fn existing_profile_dir(vault_root: &Path, id: &str) -> Result<PathBuf, AppError> {
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
    for sub in ["uploads", "generated", "downloads"] {
        create_private_dir(&workspace.join(sub))?;
    }
    write_private(&dir.join(SOUL_FILE), soul)?;
    write_profile_file(&dir, &profile)
}

/// Updates a profile that exists; a deleted one is not brought back.
pub fn save_profile(vault_root: &Path, profile: AiProfile) -> Result<(), AppError> {
    validate_profile(&profile)?;
    let dir = existing_profile_dir(vault_root, &profile.id)?;
    write_profile_file(&dir, &profile)
}

pub fn delete_profile(vault_root: &Path, id: &str) -> Result<(), AppError> {
    let dir = profile_dir(vault_root, id)?;
    if dir.exists() {
        fs::remove_dir_all(&dir)?;
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
    let dir = existing_profile_dir(vault_root, id)?.join(PROFILE_CHATS_DIR);
    create_private_dir(&dir)?;
    Ok(dir)
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

fn validate_project(project: &AiProject) -> Result<(), AppError> {
    validate_id(&project.id)?;
    if project.name.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "Project name cannot be empty".into(),
        ));
    }
    if project.is_external {
        let target = project
            .target_path
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                AppError::InvalidInput("External project requires a target path".into())
            })?;
        let target_path = Path::new(target);
        if !target_path.is_absolute() || !target_path.is_dir() {
            return Err(AppError::InvalidInput(
                "External target path must be an existing absolute directory".into(),
            ));
        }
    }
    Ok(())
}

fn write_project_file(dir: &Path, project: &AiProject) -> Result<(), AppError> {
    write_private(
        &dir.join(PROJECT_FILE),
        &serde_json::to_string_pretty(project)?,
    )
}

/// Where the files of a project are: its own folder in the vault, or the
/// folder an external project links to.
pub fn project_files_dir(vault_root: &Path, project: &AiProject) -> Result<PathBuf, AppError> {
    match project.target_path.as_deref().map(str::trim) {
        Some(target) if project.is_external && !target.is_empty() => Ok(PathBuf::from(target)),
        _ if project.is_external => Err(AppError::InvalidInput(format!(
            "External project {} has no target path",
            project.id
        ))),
        _ => project_dir(vault_root, &project.id),
    }
}

pub fn list_projects(vault_root: &Path) -> Result<Vec<AiProject>, AppError> {
    ensure_vault_dirs(vault_root)?;
    let mut projects: Vec<AiProject> = read_entries(&vault_root.join("projects"), PROJECT_FILE)?;
    projects.sort_by_key(|a| a.created_at);
    Ok(projects)
}

pub fn create_project(vault_root: &Path, project: AiProject) -> Result<(), AppError> {
    validate_project(&project)?;
    ensure_vault_dirs(vault_root)?;
    let dir = project_dir(vault_root, &project.id)?;
    if dir.join(PROJECT_FILE).exists() {
        return Err(AppError::InvalidInput(format!(
            "Project already exists: {}",
            project.id
        )));
    }
    create_private_dir(&dir)?;
    write_project_file(&dir, &project)
}

pub fn save_project(vault_root: &Path, project: AiProject) -> Result<(), AppError> {
    validate_project(&project)?;
    let dir = project_dir(vault_root, &project.id)?;
    if !dir.join(PROJECT_FILE).is_file() {
        return Err(not_found("Project", &project.id));
    }
    write_project_file(&dir, &project)
}

/// Removes the project and every profile's permissions for it. The files of
/// an external project stay where they are: only its link is removed.
pub fn delete_project(vault_root: &Path, id: &str) -> Result<(), AppError> {
    let dir = project_dir(vault_root, id)?;
    if dir.exists() {
        fs::remove_dir_all(&dir)?;
    }

    for mut profile in list_profiles(vault_root)? {
        if profile.project_permissions.remove(id).is_some() {
            let profile_dir = existing_profile_dir(vault_root, &profile.id)?;
            write_profile_file(&profile_dir, &profile)?;
        }
    }

    Ok(())
}
