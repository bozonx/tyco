use std::fs;
use std::path::{Path, PathBuf};

use super::types::{AiProfile, AiProject, ProfileSoul};
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

/// The revision of a file: the SHA-256 of its bytes, empty when there is none.
pub fn file_revision(path: &Path) -> Result<String, AppError> {
    match fs::read(path) {
        Ok(bytes) => Ok(crate::services::storage::watcher::content_hash(&bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(error.into()),
    }
}

/// Writes `content` over `path` when the file is still at `expected`, the
/// revision the caller read; no revision writes without a check. Returns the
/// new revision.
fn write_checked(path: &Path, content: &str, expected: Option<&str>) -> Result<String, AppError> {
    if let Some(expected) = expected {
        if file_revision(path)? != expected {
            return Err(AppError::StaleRevision(format!(
                "{} was changed on another device or outside TyCo",
                path.display()
            )));
        }
    }
    write_private(path, content)?;
    Ok(crate::services::storage::watcher::content_hash(
        content.as_bytes(),
    ))
}

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

fn create_entity_dir(path: &Path) -> Result<(), AppError> {
    crate::services::storage::user_data::ensure_write_allowed(path)?;
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            AppError::AlreadyExists(format!("Entity already exists: {}", path.display()))
        } else {
            error.into()
        }
    })
}

fn not_found(what: &str, id: &str) -> AppError {
    AppError::NotFound(format!("{what} not found: {id}"))
}

/// Reads every `<dir>/<id>/<file>` of the folder; an unreadable one is
/// skipped and logged, leaving the file for the user to fix.
fn read_entries<T: serde::de::DeserializeOwned + serde::Serialize>(
    dir: &Path,
    file: &str,
) -> Result<Vec<(T, String)>, AppError> {
    let mut entries = Vec::new();
    let listing = match fs::read_dir(dir) {
        Ok(listing) => listing,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(entries),
        Err(error) => return Err(error.into()),
    };
    let listing = listing.collect::<Result<Vec<_>, _>>()?;
    for entry in listing {
        let Ok(id) = entry.file_name().into_string() else {
            continue;
        };
        if !entry.file_type()?.is_dir() || !is_file_id(&id) {
            continue;
        }
        let path = entry.path().join(file);
        if !path.is_file() {
            continue;
        }
        match fs::read_to_string(&path)
            .map_err(AppError::from)
            .and_then(|raw| {
                let revision = crate::services::storage::watcher::content_hash(raw.as_bytes());
                let value: T = serde_json::from_str(&raw)?;
                if serde_json::to_value(&value)?["id"].as_str() != Some(&id) {
                    return Err(AppError::InvalidInput(format!(
                        "Entity id does not match its folder: {}",
                        path.display()
                    )));
                }
                Ok((value, revision))
            }) {
            Ok(entry) => entries.push(entry),
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

fn profile_file_content(profile: &AiProfile) -> Result<String, AppError> {
    let stored = AiProfile {
        revision: None,
        ..profile.clone()
    };
    Ok(serde_json::to_string_pretty(&stored)?)
}

pub fn list_profiles(vault_root: &Path) -> Result<Vec<AiProfile>, AppError> {
    ensure_vault_dirs(vault_root)?;
    let mut profiles: Vec<AiProfile> = read_entries(&vault_root.join("profiles"), PROFILE_FILE)?
        .into_iter()
        .map(|(profile, revision)| AiProfile {
            revision: Some(revision),
            ..profile
        })
        .collect();
    profiles.sort_by_key(|a| a.created_at);
    Ok(profiles)
}

/// The profile as it is on disk now: the user may edit the file by hand.
pub fn get_profile(vault_root: &Path, id: &str) -> Result<AiProfile, AppError> {
    let dir = existing_profile_dir(vault_root, id)?;
    let raw = fs::read_to_string(dir.join(PROFILE_FILE))?;
    let profile: AiProfile = serde_json::from_str(&raw)?;
    if profile.id != id {
        return Err(AppError::InvalidInput(
            "Profile id does not match its folder".into(),
        ));
    }
    Ok(AiProfile {
        revision: Some(crate::services::storage::watcher::content_hash(
            raw.as_bytes(),
        )),
        ..profile
    })
}

/// Creates the profile folder with its root instruction. An existing folder
/// of that id is never written into: the caller picks another id.
pub fn create_profile(
    vault_root: &Path,
    profile: AiProfile,
    soul: &str,
) -> Result<String, AppError> {
    validate_profile(&profile)?;
    ensure_vault_dirs(vault_root)?;

    let dir = profile_dir(vault_root, &profile.id)?;
    // any folder of that id, e.g. one a sync is still bringing, is taken
    if dir.symlink_metadata().is_ok() {
        return Err(AppError::AlreadyExists(format!(
            "Profile already exists: {}",
            profile.id
        )));
    }
    create_entity_dir(&dir)?;
    create_private_dir(&dir.join(PROFILE_CHATS_DIR))?;
    let workspace = dir.join("workspace");
    for sub in ["generated", "downloads"] {
        create_private_dir(&workspace.join(sub))?;
    }
    let memory = dir.join(super::memory::PROFILE_MEMORY_DIR);
    super::memory::ensure_memory_dir_initialized(&memory)?;
    write_private(&dir.join(SOUL_FILE), soul)?;
    let content = profile_file_content(&profile)?;
    write_private(&dir.join(PROFILE_FILE), &content)?;
    Ok(crate::services::storage::watcher::content_hash(
        content.as_bytes(),
    ))
}

/// Updates a profile that exists; a deleted one is not brought back. With
/// `expected_revision` the file must be as the caller read it, see
/// [`write_checked`]. Returns the new revision.
pub fn save_profile(
    vault_root: &Path,
    profile: AiProfile,
    expected_revision: Option<&str>,
) -> Result<String, AppError> {
    validate_profile(&profile)?;
    let dir = existing_profile_dir(vault_root, &profile.id)?;
    write_checked(
        &dir.join(PROFILE_FILE),
        &profile_file_content(&profile)?,
        expected_revision,
    )
}

pub fn delete_profile(
    vault_root: &Path,
    versions: &super::memory::MemoryReadVersions,
    id: &str,
) -> Result<(), AppError> {
    let dir = profile_dir(vault_root, id)?;
    if dir.exists() {
        versions.clear_profile(vault_root, id);
        crate::services::storage::watcher::remove_tree(&dir)?;
    }
    Ok(())
}

/// The root instruction with its revision; an empty one for no file.
pub fn read_profile_soul_revision(vault_root: &Path, id: &str) -> Result<ProfileSoul, AppError> {
    let path = existing_profile_dir(vault_root, id)?.join(SOUL_FILE);
    match fs::read_to_string(path) {
        Ok(content) => {
            let revision = crate::services::storage::watcher::content_hash(content.as_bytes());
            Ok(ProfileSoul { content, revision })
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(ProfileSoul {
            content: String::new(),
            revision: String::new(),
        }),
        Err(error) => Err(error.into()),
    }
}

/// Writes the root instruction, checking `expected_revision` as
/// [`save_profile`] does; an empty revision expects no file.
pub fn write_profile_soul(
    vault_root: &Path,
    id: &str,
    content: &str,
    expected_revision: Option<&str>,
) -> Result<String, AppError> {
    let dir = existing_profile_dir(vault_root, id)?;
    write_checked(&dir.join(SOUL_FILE), content, expected_revision)
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
fn project_file_content(project: &AiProject) -> Result<String, AppError> {
    let shared = AiProject {
        target_path: None,
        revision: None,
        is_inside_synced_folder: None,
        ..project.clone()
    };
    Ok(serde_json::to_string_pretty(&shared)?)
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
/// device, if it has one. The folders of projects not found are kept: a
/// `project.json` a sync has not brought yet, or cannot be read now, is not a
/// deleted project. Only `delete_project` here forgets a folder.
pub fn list_projects(vault_root: &Path, paths: &ProjectPaths) -> Result<Vec<AiProject>, AppError> {
    ensure_vault_dirs(vault_root)?;
    let mut projects: Vec<AiProject> = read_entries(&vault_root.join("projects"), PROJECT_FILE)?
        .into_iter()
        .map(|(project, revision)| AiProject {
            revision: Some(revision),
            ..project
        })
        .collect();
    projects.sort_by_key(|a| a.created_at);
    for project in &mut projects {
        project.target_path = project
            .is_external
            .then(|| paths.get(&project.id))
            .flatten();
    }
    Ok(projects)
}

/// Creates the project; an external one needs its folder on this device.
pub fn create_project(
    vault_root: &Path,
    paths: &ProjectPaths,
    project: AiProject,
) -> Result<String, AppError> {
    validate_project(&project)?;
    let target = checked_target(&project)?;
    if project.is_external && target.is_none() {
        return Err(AppError::InvalidInput(
            "External project requires a target path".into(),
        ));
    }
    ensure_vault_dirs(vault_root)?;
    let dir = project_dir(vault_root, &project.id)?;
    if dir.symlink_metadata().is_ok() {
        return Err(AppError::AlreadyExists(format!(
            "Project already exists: {}",
            project.id
        )));
    }
    create_entity_dir(&dir)?;
    let content = project_file_content(&project)?;
    write_private(&dir.join(PROJECT_FILE), &content)?;
    if project.is_external {
        paths.set(&project.id, target)?;
    }
    Ok(crate::services::storage::watcher::content_hash(
        content.as_bytes(),
    ))
}

/// Updates the project. The folder given for an external project becomes
/// its folder on this device; none given leaves the one it has here. The
/// description is checked against `expected_revision` as [`save_profile`]
/// does. Returns the new revision.
pub fn save_project(
    vault_root: &Path,
    paths: &ProjectPaths,
    project: AiProject,
    expected_revision: Option<&str>,
) -> Result<String, AppError> {
    validate_project(&project)?;
    let target = checked_target(&project)?;
    let dir = project_dir(vault_root, &project.id)?;
    if !dir.join(PROJECT_FILE).is_file() {
        return Err(not_found("Project", &project.id));
    }
    if read_project(&dir)?.is_external != project.is_external {
        return Err(AppError::InvalidInput(
            "The type of a project is changed by converting it".into(),
        ));
    }
    let revision = write_checked(
        &dir.join(PROJECT_FILE),
        &project_file_content(&project)?,
        expected_revision,
    )?;
    match (project.is_external, target) {
        (true, Some(target)) => paths.set(&project.id, Some(target))?,
        (true, None) => {}
        (false, _) => paths.set(&project.id, None)?,
    }
    Ok(revision)
}

fn read_project(dir: &Path) -> Result<AiProject, AppError> {
    Ok(serde_json::from_str(&fs::read_to_string(
        dir.join(PROJECT_FILE),
    )?)?)
}

/// Turns an internal project into an external one with its folder at
/// `target_path`, or an external one into an internal one. With
/// `transfer_files` an internal project moves its files to the folder, and
/// an external one copies the files of its folder on this device into the
/// vault: the folder of the user is never removed. Files are copied first,
/// so a failure leaves the project as it was; a name taken in the
/// destination is refused, not overwritten. Returns the new revision.
pub fn convert_project(
    vault_root: &Path,
    paths: &ProjectPaths,
    id: &str,
    target_path: Option<&str>,
    transfer_files: bool,
    expected_revision: Option<&str>,
) -> Result<String, AppError> {
    let dir = project_dir(vault_root, id)?;
    if !dir.join(PROJECT_FILE).is_file() {
        return Err(not_found("Project", id));
    }
    if let Some(expected) = expected_revision {
        if file_revision(&dir.join(PROJECT_FILE))? != expected {
            return Err(AppError::StaleRevision(format!(
                "The project {id} was changed on another device or outside TyCo"
            )));
        }
    }
    let stored = read_project(&dir)?;
    let converted = AiProject {
        is_external: !stored.is_external,
        target_path: if stored.is_external {
            None
        } else {
            target_path.map(str::to_owned)
        },
        ..stored.clone()
    };

    if converted.is_external {
        let target = checked_target(&converted)?.ok_or_else(|| {
            AppError::InvalidInput("External project requires a target path".into())
        })?;
        let target = Path::new(target);
        if transfer_files {
            if fs::canonicalize(target)?.starts_with(fs::canonicalize(&dir)?) {
                return Err(AppError::InvalidInput(
                    "The folder of the project cannot be inside its vault folder".into(),
                ));
            }
            copy_project_files(&dir, target)?;
        }
        let revision = write_checked(
            &dir.join(PROJECT_FILE),
            &project_file_content(&converted)?,
            None,
        )?;
        paths.set(id, target.to_str())?;
        if transfer_files {
            remove_project_files(&dir)?;
        }
        Ok(revision)
    } else {
        if transfer_files {
            let source = project_files_dir(
                vault_root,
                &AiProject {
                    target_path: paths.get(id),
                    ..stored
                },
            )?;
            copy_project_files(&source, &dir)?;
        }
        let revision = write_checked(
            &dir.join(PROJECT_FILE),
            &project_file_content(&converted)?,
            None,
        )?;
        paths.set(id, None)?;
        Ok(revision)
    }
}

/// The entries of a project folder, without the description of the project.
fn project_entries(dir: &Path) -> Result<Vec<fs::DirEntry>, AppError> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        if entry.file_name() != PROJECT_FILE {
            entries.push(entry);
        }
    }
    Ok(entries)
}

/// Copies the files of the project folder `from` into `to`. Refuses before
/// copying anything when a name is taken in `to` or a link is found; on a
/// failure removes what it copied.
fn copy_project_files(from: &Path, to: &Path) -> Result<(), AppError> {
    let entries = project_entries(from)?;
    for entry in &entries {
        let destination = to.join(entry.file_name());
        if destination.symlink_metadata().is_ok() {
            return Err(AppError::AlreadyExists(format!(
                "{} already exists",
                destination.display()
            )));
        }
        check_no_links(&entry.path())?;
    }
    let mut copied = Vec::new();
    for entry in &entries {
        let destination = to.join(entry.file_name());
        copied.push(destination.clone());
        if let Err(error) = copy_tree(&entry.path(), &destination) {
            for path in &copied {
                let _ = if path.is_dir() {
                    fs::remove_dir_all(path)
                } else {
                    fs::remove_file(path)
                };
            }
            return Err(error);
        }
    }
    Ok(())
}

fn check_no_links(path: &Path) -> Result<(), AppError> {
    let kind = path.symlink_metadata()?.file_type();
    if kind.is_symlink() {
        return Err(AppError::InvalidInput(format!(
            "{} is a link: move it by hand",
            path.display()
        )));
    }
    if kind.is_dir() {
        for entry in fs::read_dir(path)? {
            check_no_links(&entry?.path())?;
        }
    }
    Ok(())
}

fn copy_tree(from: &Path, to: &Path) -> Result<(), AppError> {
    if from.is_dir() {
        fs::create_dir(to)?;
        for entry in fs::read_dir(from)? {
            let entry = entry?;
            copy_tree(&entry.path(), &to.join(entry.file_name()))?;
        }
    } else {
        fs::copy(from, to)?;
    }
    Ok(())
}

/// Removes the files of an internal project folder, keeping its description.
fn remove_project_files(dir: &Path) -> Result<(), AppError> {
    for entry in project_entries(dir)? {
        let path = entry.path();
        if entry.file_type()?.is_dir() {
            crate::services::storage::watcher::remove_tree(&path)?;
        } else {
            crate::services::storage::user_data::ensure_write_allowed(&path)?;
            fs::remove_file(&path)?;
            crate::services::storage::watcher::deleted(&path);
        }
    }
    Ok(())
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
            let expected = profile.revision.clone();
            save_profile(vault_root, profile, expected.as_deref())?;
        }
    }

    Ok(())
}
