//! The vaults of this device: the main one in the data folder and the ones
//! attached from other folders. Which folders are attached is decided on each
//! device (`aiVaults.attached` of `device.json`); the name of a vault lives in
//! its marker and is the same everywhere.
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use super::marker::{self, AttachTarget, Vault};
use crate::errors::AppError;
use crate::models::user_config::{attached_vaults, AttachedVault};
use crate::services::storage::sync_roots::{check_sync_roots, SyncRootKind};
use crate::state::AppState;

/// Where an attached vault stands on this device.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum VaultStatus {
    Connected,
    /// Its folder, or the marker in it, is not there now.
    NotConnected,
    /// A newer TyCo laid it out.
    Newer,
}

/// A vault as the settings show it.
#[derive(Debug, Clone, Serialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct VaultInfo {
    /// The vault part of the references of its profiles and projects; empty
    /// for the main vault.
    pub vault_id: String,
    pub name: String,
    pub path: String,
    pub is_main: bool,
    pub status: VaultStatus,
    /// Others may write to it: its profiles run the commands of this device.
    pub is_writable_by_others: bool,
}

/// What a folder offered for a vault holds.
#[derive(Debug, Clone, Serialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum VaultFolderKind {
    /// A vault: it is attached as it is.
    Vault { name: String },
    /// Missing or empty: a new vault is made there.
    Empty,
    /// Other files: a subfolder is offered instead.
    Occupied { subfolder: String },
    /// A copy of a vault that is here already, the main one included.
    Duplicate,
    /// Inside the data folder or another vault, or holding one.
    Nested { message: String },
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct VaultFolder {
    pub path: String,
    pub kind: VaultFolderKind,
}

/// The folder offered inside one that holds other files.
pub const VAULT_SUBFOLDER: &str = "TyCo Vault";

/// Every vault this device knows of, the main one first. A vault that is not
/// there is listed too: the user may point it to its folder or remove it.
pub fn list_vaults(app: &AppHandle) -> Result<Vec<VaultInfo>, AppError> {
    let state = app.state::<AppState>();
    let _access = state.read_vault();
    let main = super::main_vault(app)?;
    let mut vaults = vec![VaultInfo {
        vault_id: String::new(),
        name: String::new(),
        path: main.root.to_string_lossy().into_owned(),
        is_main: true,
        status: VaultStatus::Connected,
        is_writable_by_others: false,
    }];
    for attached in attached_vaults(&state.user_config()) {
        vaults.push(attached_info(&attached));
    }
    Ok(vaults)
}

fn attached_info(attached: &AttachedVault) -> VaultInfo {
    let path = Path::new(&attached.path);
    let (status, name) = match marker::open_attached(path) {
        Ok(vault) if vault.id == attached.vault_id => {
            (VaultStatus::Connected, vault.name.unwrap_or_default())
        }
        Ok(_) => (VaultStatus::NotConnected, String::new()),
        Err(error) if error.to_string().contains("newer") => (VaultStatus::Newer, String::new()),
        Err(_) => (VaultStatus::NotConnected, String::new()),
    };
    VaultInfo {
        vault_id: attached.vault_id.clone(),
        name,
        path: attached.path.clone(),
        is_main: false,
        status,
        is_writable_by_others: status == VaultStatus::Connected
            && crate::services::storage::user_data::is_writable_by_others(path),
    }
}

/// The vaults that can be used now, each with the vault part of its
/// references: the main one (empty) and every attached one that is there.
pub fn connected_vaults(app: &AppHandle) -> Vec<(String, Vault)> {
    let mut vaults = Vec::new();
    match super::main_vault(app) {
        Ok(vault) => vaults.push((String::new(), vault)),
        Err(error) => log::warn!("The main AI vault is unavailable: {error}"),
    }
    let config = app.state::<AppState>().user_config();
    for attached in attached_vaults(&config) {
        match marker::open_attached(Path::new(&attached.path)) {
            Ok(vault) if vault.id == attached.vault_id => {
                vaults.push((attached.vault_id.clone(), vault));
            }
            Ok(_) | Err(_) => {}
        }
    }
    vaults
}

/// The roots a vault folder must stay out of: the data folder and every
/// attached vault but `except`.
fn other_roots(app: &AppHandle, except: Option<&str>) -> Vec<(PathBuf, SyncRootKind)> {
    let mut roots = Vec::new();
    if let Ok(user_dir) = crate::services::storage::user_data::user_dir_for(
        app,
        crate::services::storage::UserDirAccess::Read,
    ) {
        roots.push((user_dir, SyncRootKind::DataFolder));
    }
    let config = app.state::<AppState>().user_config();
    for attached in attached_vaults(&config) {
        if Some(attached.vault_id.as_str()) != except {
            roots.push((PathBuf::from(attached.path), SyncRootKind::Vault));
        }
    }
    roots
}

/// Ids a vault being attached must not have: the main one and those attached.
fn taken_ids(app: &AppHandle, except: Option<&str>) -> Vec<String> {
    let mut ids: Vec<String> = super::main_vault(app)
        .map(|vault| vault.id)
        .into_iter()
        .collect();
    let config = app.state::<AppState>().user_config();
    ids.extend(
        attached_vaults(&config)
            .into_iter()
            .map(|vault| vault.vault_id)
            .filter(|id| Some(id.as_str()) != except),
    );
    ids
}

fn checked_path(path: &str) -> Result<PathBuf, AppError> {
    let path = PathBuf::from(path.trim());
    if !path.is_absolute() {
        return Err(AppError::InvalidInput(format!(
            "The AI vault path is not absolute: {}",
            path.display()
        )));
    }
    Ok(path)
}

/// What `path` would be as a vault of this device; `except` is a vault whose
/// folder is being replaced.
fn classify(
    app: &AppHandle,
    path: &Path,
    except: Option<&str>,
) -> Result<VaultFolderKind, AppError> {
    let roots = other_roots(app, except);
    let others: Vec<(&Path, SyncRootKind)> = roots
        .iter()
        .map(|(path, kind)| (path.as_path(), *kind))
        .collect();
    if let Err(error) = check_sync_roots(path, SyncRootKind::Vault, &others) {
        return Ok(VaultFolderKind::Nested {
            message: error.to_string(),
        });
    }
    Ok(match marker::inspect_attach_target(path)? {
        AttachTarget::Vault(vault) if taken_ids(app, except).contains(&vault.id) => {
            VaultFolderKind::Duplicate
        }
        AttachTarget::Vault(vault) => VaultFolderKind::Vault {
            name: vault.name.unwrap_or_default(),
        },
        AttachTarget::Empty => VaultFolderKind::Empty,
        AttachTarget::Occupied => VaultFolderKind::Occupied {
            subfolder: path.join(VAULT_SUBFOLDER).to_string_lossy().into_owned(),
        },
    })
}

/// What a folder holds as a vault to attach.
pub fn inspect_vault_folder(app: &AppHandle, path: &str) -> Result<VaultFolder, AppError> {
    let state = app.state::<AppState>();
    let _access = state.read_vault();
    let path = checked_path(path)?;
    Ok(VaultFolder {
        kind: classify(app, &path, None)?,
        path: path.to_string_lossy().into_owned(),
    })
}

fn refusal(kind: &VaultFolderKind, path: &Path) -> AppError {
    match kind {
        VaultFolderKind::Duplicate => AppError::AlreadyExists(format!(
            "{} is a copy of an AI vault that is here already",
            path.display()
        )),
        VaultFolderKind::Nested { message } => AppError::InvalidInput(message.clone()),
        _ => AppError::InvalidInput(format!(
            "{} holds other files: use a subfolder for the AI vault",
            path.display()
        )),
    }
}

/// Stores the list of attached vaults of this device.
fn save_attached(
    app: &AppHandle,
    change: impl FnOnce(&mut Vec<AttachedVault>),
) -> Result<(), AppError> {
    let state = app.state::<AppState>();
    let base = state.user_config().as_ref().clone();
    let mut attached = attached_vaults(&base);
    change(&mut attached);
    let mut next = base.clone();
    if !next
        .get("aiVaults")
        .is_some_and(serde_json::Value::is_object)
    {
        next["aiVaults"] = serde_json::json!({});
    }
    next["aiVaults"]["attached"] = serde_json::to_value(attached)?;
    crate::services::settings::save_user_config_in_vault(app, next, base).map(|_| ())
}

/// Attaches the folder `path`: a vault there is used as it is, an empty or
/// missing folder gets a new vault named `name`. A folder of other files, a
/// copy of a vault here already, or a folder nested with the data folder or
/// another vault is refused.
pub fn attach_vault(app: &AppHandle, path: &str, name: &str) -> Result<VaultInfo, AppError> {
    let state = app.state::<AppState>();
    let _access = state.write_vault();
    let path = checked_path(path)?;
    let kind = classify(app, &path, None)?;
    let vault = match kind {
        VaultFolderKind::Vault { .. } => marker::open_attached(&path)?,
        VaultFolderKind::Empty => marker::create_attached(&path, name)?,
        _ => return Err(refusal(&kind, &path)),
    };
    let entry = AttachedVault {
        path: path.to_string_lossy().into_owned(),
        vault_id: vault.id.clone(),
    };
    save_attached(app, |attached| attached.push(entry.clone()))?;
    crate::services::storage::watcher::check_now(app);
    Ok(attached_info(&entry))
}

/// Points the attached vault `vault_id` to the folder it has on this device
/// now: the folder must hold that very vault.
pub fn relink_vault(app: &AppHandle, vault_id: &str, path: &str) -> Result<VaultInfo, AppError> {
    let state = app.state::<AppState>();
    let _access = state.write_vault();
    let path = checked_path(path)?;
    let kind = classify(app, &path, Some(vault_id))?;
    if !matches!(kind, VaultFolderKind::Vault { .. }) {
        return Err(match kind {
            VaultFolderKind::Empty | VaultFolderKind::Occupied { .. } => {
                AppError::InvalidInput(format!("{} holds no AI vault", path.display()))
            }
            _ => refusal(&kind, &path),
        });
    }
    let vault = marker::open_attached(&path)?;
    if vault.id != vault_id {
        return Err(AppError::InvalidInput(format!(
            "{} holds another AI vault",
            path.display()
        )));
    }
    let entry = AttachedVault {
        path: path.to_string_lossy().into_owned(),
        vault_id: vault_id.to_owned(),
    };
    save_attached(app, |attached| {
        for item in attached.iter_mut().filter(|item| item.vault_id == vault_id) {
            item.path.clone_from(&entry.path);
        }
    })?;
    crate::services::storage::watcher::check_now(app);
    Ok(attached_info(&entry))
}

/// Removes the vault from this device; its files stay where they are. The
/// indexes of its chats go: they are rebuilt if it is attached again.
pub fn detach_vault(app: &AppHandle, vault_id: &str) -> Result<(), AppError> {
    let state = app.state::<AppState>();
    let _access = state.write_vault();
    save_attached(app, |attached| {
        attached.retain(|item| item.vault_id != vault_id)
    })?;
    if let Err(error) = crate::services::storage::remove_vault_indexes(app, vault_id) {
        log::warn!("Could not remove the chat indexes of the AI vault {vault_id}: {error}");
    }
    crate::services::storage::watcher::check_now(app);
    Ok(())
}

/// Renames an attached vault, on every device that syncs it.
pub fn rename_vault(app: &AppHandle, vault_id: &str, name: &str) -> Result<(), AppError> {
    super::with_vault_of(app, vault_id, |vault| {
        if vault_id.is_empty() {
            return Err(AppError::InvalidInput(
                "The main AI vault has no name of its own".into(),
            ));
        }
        marker::rename_attached(&vault.root, name)
    })
}

/// The profile as the webview names it: its id and the projects it may use
/// are references with the vault part.
pub fn profile_to_ref(vault_id: &str, profile: super::AiProfile) -> super::AiProfile {
    super::AiProfile {
        id: super::join_ref(vault_id, &profile.id),
        project_permissions: profile
            .project_permissions
            .into_iter()
            .map(|(project, permission)| (super::join_ref(vault_id, &project), permission))
            .collect(),
        ..profile
    }
}

/// The profile as stored in its vault. A permission for a project of another
/// vault is refused: the vaults are kept apart.
pub fn profile_from_ref(
    vault_id: &str,
    profile: super::AiProfile,
) -> Result<super::AiProfile, AppError> {
    let (_, id) = super::split_ref(&profile.id);
    let mut permissions = std::collections::HashMap::new();
    for (key, permission) in profile.project_permissions {
        let (project_vault, project) = super::split_ref(&key);
        if project_vault != vault_id {
            return Err(AppError::InvalidInput(format!(
                "The profile {id} cannot use the project {key} of another AI vault"
            )));
        }
        permissions.insert(project.to_owned(), permission);
    }
    Ok(super::AiProfile {
        id: id.to_owned(),
        project_permissions: permissions,
        ..profile
    })
}

/// The project as the webview names it.
pub fn project_to_ref(vault_id: &str, project: super::AiProject) -> super::AiProject {
    super::AiProject {
        id: super::join_ref(vault_id, &project.id),
        ..project
    }
}

/// The project as stored in its vault.
pub fn project_from_ref(project: super::AiProject) -> super::AiProject {
    let id = super::split_ref(&project.id).1.to_owned();
    super::AiProject { id, ..project }
}

/// Marks an external project whose folder is synced with a root, see
/// [`super::AiProject::is_inside_synced_folder`]. It is not refused: the user
/// may want that.
pub fn mark_synced(project: super::AiProject, synced_roots: &[PathBuf]) -> super::AiProject {
    let is_inside = project.is_external
        && project.target_path.as_deref().is_some_and(|target| {
            synced_roots.iter().any(|root| {
                crate::services::storage::sync_roots::is_inside(Path::new(target), root)
            })
        });
    super::AiProject {
        is_inside_synced_folder: is_inside.then_some(true),
        ..project
    }
}

/// The profiles of every vault that is there, by reference.
pub fn list_all_profiles(app: &AppHandle) -> Result<Vec<super::AiProfile>, AppError> {
    let state = app.state::<AppState>();
    let _access = state.read_vault();
    let mut profiles = Vec::new();
    for (vault_id, vault) in connected_vaults(app) {
        let lock = super::locking::vault_lock(&vault.root);
        use crate::locks::MutexExt;
        let _io = lock.locked();
        match super::list_profiles(&vault.root) {
            Ok(listed) => profiles.extend(
                listed
                    .into_iter()
                    .map(|profile| profile_to_ref(&vault_id, profile)),
            ),
            // the main vault must be readable; an attached one may be away
            Err(error) if vault_id.is_empty() => return Err(error),
            Err(error) => log::warn!("Could not read the AI vault {vault_id}: {error}"),
        }
    }
    Ok(profiles)
}

/// The projects of every vault that is there, by reference.
pub fn list_all_projects(app: &AppHandle) -> Result<Vec<super::AiProject>, AppError> {
    let state = app.state::<AppState>();
    let _access = state.read_vault();
    let device = app.state::<crate::services::storage::device::DeviceStore>();
    let mut projects = Vec::new();
    let vaults = connected_vaults(app);
    let mut synced_roots: Vec<PathBuf> =
        vaults.iter().map(|(_, vault)| vault.root.clone()).collect();
    if let Ok(user_dir) = crate::services::storage::user_data::user_dir_for(
        app,
        crate::services::storage::UserDirAccess::Read,
    ) {
        synced_roots.push(user_dir);
    }
    for (vault_id, vault) in vaults {
        let paths = super::ProjectPaths {
            device: &device,
            vault_id: &vault.id,
        };
        let lock = super::locking::vault_lock(&vault.root);
        use crate::locks::MutexExt;
        let _io = lock.locked();
        match super::list_projects(&vault.root, &paths) {
            Ok(listed) => projects.extend(
                listed
                    .into_iter()
                    .map(|project| mark_synced(project, &synced_roots))
                    .map(|project| project_to_ref(&vault_id, project)),
            ),
            Err(error) if vault_id.is_empty() => return Err(error),
            Err(error) => log::warn!("Could not read the AI vault {vault_id}: {error}"),
        }
    }
    Ok(projects)
}

#[cfg(test)]
mod tests {
    use super::super::{join_ref, split_ref, AiProfile, ProfileMemoryMode, ProjectPermission};
    use super::*;
    use crate::services::ai_vault::ProjectAccessMode;

    fn profile(id: &str, projects: &[&str]) -> AiProfile {
        AiProfile {
            id: id.into(),
            name: "P".into(),
            model_id: None,
            quick_request_model_id: None,
            temperature: None,
            max_output_tokens: None,
            project_permissions: projects
                .iter()
                .map(|project| {
                    (
                        (*project).to_owned(),
                        ProjectPermission {
                            read: ProjectAccessMode::Allow,
                            write: ProjectAccessMode::Ask,
                        },
                    )
                })
                .collect(),
            tools: None,
            memory_mode: ProfileMemoryMode::Auto,
            created_at: 1,
            updated_at: 1,
            revision: None,
        }
    }

    #[test]
    fn an_external_project_inside_a_synced_root_is_marked() {
        let project = |target: &str| super::super::AiProject {
            id: "p".into(),
            name: "P".into(),
            description: None,
            is_external: true,
            target_path: Some(target.into()),
            created_at: 1,
            updated_at: 1,
            revision: None,
            is_inside_synced_folder: None,
        };
        let roots = [PathBuf::from("/data"), PathBuf::from("/work/vault")];
        assert!(mark_synced(project("/data/code"), &roots)
            .is_inside_synced_folder
            .is_some());
        assert!(mark_synced(project("/work/vault/x"), &roots)
            .is_inside_synced_folder
            .is_some());
        assert!(!mark_synced(project("/home/me/code"), &roots)
            .is_inside_synced_folder
            .is_some());
    }

    #[test]
    fn references_name_the_vault_except_the_main_one() {
        assert_eq!(join_ref("", "profile-1"), "profile-1");
        assert_eq!(join_ref("w1", "profile-1"), "w1:profile-1");
        assert_eq!(split_ref("w1:profile-1"), ("w1", "profile-1"));
        assert_eq!(split_ref("profile-1"), ("", "profile-1"));
    }

    #[test]
    fn a_profile_reaches_the_projects_of_its_own_vault_only() {
        let listed = profile_to_ref("w1", profile("writer", &["docs"]));
        assert_eq!(listed.id, "w1:writer");
        assert!(listed.project_permissions.contains_key("w1:docs"));

        let stored = profile_from_ref("w1", listed).unwrap();
        assert_eq!(stored.id, "writer");
        assert!(stored.project_permissions.contains_key("docs"));

        // a project of the main vault, or of another one, is refused
        for other in ["docs", "w2:docs"] {
            assert!(matches!(
                profile_from_ref("w1", profile("w1:writer", &[other])),
                Err(AppError::InvalidInput(_))
            ));
        }
        // in the main vault references are the bare ids
        let main = profile_from_ref("", profile("writer", &["docs"])).unwrap();
        assert!(main.project_permissions.contains_key("docs"));
    }
}
