//! The workspaces of this device: the main one in the data folder and the ones
//! attached from other folders. Which folders are attached is decided on each
//! device (`aiWorkspaces.attached` of `device.json`); the name of a workspace lives in
//! its marker and is the same everywhere.
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use super::marker::{self, AttachTarget, Workspace};
use crate::errors::AppError;
use crate::models::user_config::{attached_workspaces, AttachedWorkspace};
use crate::services::storage::sync_roots::{check_sync_roots, SyncRootKind};
use crate::state::AppState;

/// Where an attached workspace stands on this device.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceStatus {
    Connected,
    /// Its folder, or the marker in it, is not there now.
    NotConnected,
    /// A newer TyCo laid it out.
    Newer,
}

/// A workspace as the settings show it.
#[derive(Debug, Clone, Serialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    /// The workspace part of the references of its profiles and projects; empty
    /// for the main workspace.
    pub workspace_id: String,
    pub name: String,
    pub path: String,
    pub is_main: bool,
    pub status: WorkspaceStatus,
    /// Others may write to it: its profiles run the commands of this device.
    pub is_writable_by_others: bool,
    /// The chat history settings of its profiles; empty when not connected.
    pub chat_history: super::WorkspaceChatHistory,
}

/// What a folder offered for a workspace holds.
#[derive(Debug, Clone, Serialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum WorkspaceFolderKind {
    /// A workspace: it is attached as it is.
    Workspace { name: String },
    /// Missing or empty: a new workspace is made there.
    Empty,
    /// Other files: a subfolder is offered instead.
    Occupied { subfolder: String },
    /// A copy of a workspace that is here already, the main one included.
    Duplicate,
    /// Inside the data folder or another workspace, or holding one.
    Nested { message: String },
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFolder {
    pub path: String,
    pub kind: WorkspaceFolderKind,
}

/// The folder offered inside one that holds other files.
pub const WORKSPACE_SUBFOLDER: &str = "TyCo Workspace";

/// Every workspace this device knows of, the main one first. A workspace that is not
/// there is listed too: the user may point it to its folder or remove it.
pub fn list_workspaces(app: &AppHandle) -> Result<Vec<WorkspaceInfo>, AppError> {
    let state = app.state::<AppState>();
    let _access = state.read_workspace();
    Ok(list_workspaces_in(
        super::main_workspace(app),
        &attached_workspaces(&state.user_config()),
    ))
}

/// [`list_workspaces`] over the main workspace as it opened and the attached ones.
/// The main workspace away with the data folder is listed as not connected; the
/// attached ones are still listed and used.
pub fn list_workspaces_in(
    main: Result<Workspace, AppError>,
    attached: &[AttachedWorkspace],
) -> Vec<WorkspaceInfo> {
    let main = match main {
        Ok(main) => WorkspaceInfo {
            workspace_id: String::new(),
            name: String::new(),
            path: main.root.to_string_lossy().into_owned(),
            is_main: true,
            status: WorkspaceStatus::Connected,
            is_writable_by_others: false,
            chat_history: super::settings::read_chat_history(&main.root),
        },
        Err(error) => {
            log::warn!("The main workspace is unavailable: {error}");
            WorkspaceInfo {
                workspace_id: String::new(),
                name: String::new(),
                path: String::new(),
                is_main: true,
                status: WorkspaceStatus::NotConnected,
                is_writable_by_others: false,
                chat_history: super::WorkspaceChatHistory::default(),
            }
        }
    };
    std::iter::once(main)
        .chain(attached.iter().map(attached_info))
        .collect()
}

/// The workspaces that can be used now, each with the workspace part of its
/// references: the main one (empty) and every attached one that is there.
pub fn connected_workspaces(app: &AppHandle) -> Vec<(String, Workspace)> {
    let config = app.state::<AppState>().user_config();
    connected_workspaces_in(super::main_workspace(app), &attached_workspaces(&config))
}

/// [`connected_workspaces`] over the main workspace as it opened and the attached ones.
pub fn connected_workspaces_in(
    main: Result<Workspace, AppError>,
    attached: &[AttachedWorkspace],
) -> Vec<(String, Workspace)> {
    let mut workspaces = Vec::new();
    match main {
        Ok(workspace) => workspaces.push((String::new(), workspace)),
        Err(error) => log::warn!("The main workspace is unavailable: {error}"),
    }
    for attached in attached {
        if let Ok(workspace) = marker::open_attached(Path::new(&attached.path)) {
            if workspace.id == attached.workspace_id {
                workspaces.push((attached.workspace_id.clone(), workspace));
            }
        }
    }
    workspaces
}

fn attached_info(attached: &AttachedWorkspace) -> WorkspaceInfo {
    let path = Path::new(&attached.path);
    let (status, name) = match marker::open_attached(path) {
        Ok(workspace) if workspace.id == attached.workspace_id => (
            WorkspaceStatus::Connected,
            workspace.name.unwrap_or_default(),
        ),
        Ok(_) => (WorkspaceStatus::NotConnected, String::new()),
        Err(_) if marker::is_from_newer_version(path) => (WorkspaceStatus::Newer, String::new()),
        Err(_) => (WorkspaceStatus::NotConnected, String::new()),
    };
    WorkspaceInfo {
        workspace_id: attached.workspace_id.clone(),
        name,
        path: attached.path.clone(),
        is_main: false,
        status,
        is_writable_by_others: status == WorkspaceStatus::Connected
            && crate::services::storage::user_data::is_writable_by_others(path),
        chat_history: if status == WorkspaceStatus::Connected {
            super::settings::read_chat_history(path)
        } else {
            super::WorkspaceChatHistory::default()
        },
    }
}

/// The folders the external projects of every workspace must stay out of: the
/// data folder, which holds the main workspace and the commands this device
/// runs, and every attached workspace.
pub fn protected_roots(app: &AppHandle) -> Vec<PathBuf> {
    other_roots(app, None)
        .into_iter()
        .map(|(path, _)| path)
        .collect()
}

/// The roots a workspace folder must stay out of: the data folder and every
/// attached workspace but `except`.
fn other_roots(app: &AppHandle, except: Option<&str>) -> Vec<(PathBuf, SyncRootKind)> {
    let mut roots = Vec::new();
    if let Ok(user_dir) = crate::services::storage::user_data::user_dir_for(
        app,
        crate::services::storage::UserDirAccess::Read,
    ) {
        roots.push((user_dir, SyncRootKind::DataFolder));
    }
    let config = app.state::<AppState>().user_config();
    for attached in attached_workspaces(&config) {
        if Some(attached.workspace_id.as_str()) != except {
            roots.push((PathBuf::from(attached.path), SyncRootKind::Workspace));
        }
    }
    roots
}

/// Ids a workspace being attached must not have: the main one and those attached.
fn taken_ids(app: &AppHandle, except: Option<&str>) -> Vec<String> {
    let mut ids: Vec<String> = super::main_workspace(app)
        .map(|workspace| workspace.id)
        .into_iter()
        .collect();
    let config = app.state::<AppState>().user_config();
    ids.extend(
        attached_workspaces(&config)
            .into_iter()
            .map(|workspace| workspace.workspace_id)
            .filter(|id| Some(id.as_str()) != except),
    );
    ids
}

fn checked_path(path: &str) -> Result<PathBuf, AppError> {
    let path = PathBuf::from(path.trim());
    if !path.is_absolute() {
        return Err(AppError::InvalidInput(format!(
            "The AI workspace path is not absolute: {}",
            path.display()
        )));
    }
    Ok(path)
}

/// What `path` would be as a workspace of this device; `except` is a workspace whose
/// folder is being replaced.
fn classify(
    app: &AppHandle,
    path: &Path,
    except: Option<&str>,
) -> Result<WorkspaceFolderKind, AppError> {
    let roots = other_roots(app, except);
    let others: Vec<(&Path, SyncRootKind)> = roots
        .iter()
        .map(|(path, kind)| (path.as_path(), *kind))
        .collect();
    if let Err(error) = check_sync_roots(path, SyncRootKind::Workspace, &others) {
        return Ok(WorkspaceFolderKind::Nested {
            message: error.to_string(),
        });
    }
    Ok(match marker::inspect_attach_target(path)? {
        AttachTarget::Workspace(workspace) if taken_ids(app, except).contains(&workspace.id) => {
            WorkspaceFolderKind::Duplicate
        }
        AttachTarget::Workspace(workspace) => WorkspaceFolderKind::Workspace {
            name: workspace.name.unwrap_or_default(),
        },
        AttachTarget::Empty => WorkspaceFolderKind::Empty,
        AttachTarget::Occupied => WorkspaceFolderKind::Occupied {
            subfolder: path
                .join(WORKSPACE_SUBFOLDER)
                .to_string_lossy()
                .into_owned(),
        },
    })
}

/// What a folder holds as a workspace to attach.
pub fn inspect_workspace_folder(app: &AppHandle, path: &str) -> Result<WorkspaceFolder, AppError> {
    let state = app.state::<AppState>();
    let _access = state.read_workspace();
    let path = checked_path(path)?;
    Ok(WorkspaceFolder {
        kind: classify(app, &path, None)?,
        path: path.to_string_lossy().into_owned(),
    })
}

fn refusal(kind: &WorkspaceFolderKind, path: &Path) -> AppError {
    match kind {
        WorkspaceFolderKind::Duplicate => AppError::AlreadyExists(format!(
            "{} is a copy of an AI workspace that is here already",
            path.display()
        )),
        WorkspaceFolderKind::Nested { message } => AppError::InvalidInput(message.clone()),
        _ => AppError::InvalidInput(format!(
            "{} holds other files: use a subfolder for the AI workspace",
            path.display()
        )),
    }
}

/// Stores the list of attached workspaces of this device.
fn save_attached(
    app: &AppHandle,
    change: impl FnOnce(&mut Vec<AttachedWorkspace>),
) -> Result<(), AppError> {
    let state = app.state::<AppState>();
    let base = state.user_config().as_ref().clone();
    let mut attached = attached_workspaces(&base);
    change(&mut attached);
    let mut next = base.clone();
    if !next
        .get("aiVaults")
        .is_some_and(serde_json::Value::is_object)
    {
        next["aiVaults"] = serde_json::json!({});
    }
    next["aiVaults"]["attached"] = serde_json::to_value(attached)?;
    crate::services::settings::save_user_config_in_workspace(app, next, base).map(|_| ())
}

/// Attaches the folder `path`: a workspace there is used as it is, an empty or
/// missing folder gets a new workspace named `name`. A folder of other files, a
/// copy of a workspace here already, or a folder nested with the data folder or
/// another workspace is refused.
pub fn attach_workspace(
    app: &AppHandle,
    path: &str,
    name: &str,
) -> Result<WorkspaceInfo, AppError> {
    let state = app.state::<AppState>();
    let _access = state.write_workspace();
    let path = checked_path(path)?;
    let kind = classify(app, &path, None)?;
    let is_new = matches!(kind, WorkspaceFolderKind::Empty);
    let workspace = match kind {
        WorkspaceFolderKind::Workspace { .. } => marker::open_attached(&path)?,
        WorkspaceFolderKind::Empty => marker::create_attached(&path, name)?,
        _ => return Err(refusal(&kind, &path)),
    };
    let entry = AttachedWorkspace {
        path: path.to_string_lossy().into_owned(),
        workspace_id: workspace.id.clone(),
    };
    if let Err(error) = save_attached(app, |attached| attached.push(entry.clone())) {
        // a workspace made just now is not left behind half attached
        if is_new {
            marker::remove_created(&path);
        }
        return Err(error);
    }
    crate::services::storage::watcher::check_now(app);
    Ok(attached_info(&entry))
}

/// Points the attached workspace `workspace_id` to the folder it has on this device
/// now: the folder must hold that very workspace.
pub fn relink_workspace(
    app: &AppHandle,
    workspace_id: &str,
    path: &str,
) -> Result<WorkspaceInfo, AppError> {
    let state = app.state::<AppState>();
    let _access = state.write_workspace();
    let path = checked_path(path)?;
    let kind = classify(app, &path, Some(workspace_id))?;
    if !matches!(kind, WorkspaceFolderKind::Workspace { .. }) {
        return Err(match kind {
            WorkspaceFolderKind::Empty | WorkspaceFolderKind::Occupied { .. } => {
                AppError::InvalidInput(format!("{} holds no AI workspace", path.display()))
            }
            _ => refusal(&kind, &path),
        });
    }
    let workspace = marker::open_attached(&path)?;
    if workspace.id != workspace_id {
        return Err(AppError::InvalidInput(format!(
            "{} holds another AI workspace",
            path.display()
        )));
    }
    let entry = AttachedWorkspace {
        path: path.to_string_lossy().into_owned(),
        workspace_id: workspace_id.to_owned(),
    };
    save_attached(app, |attached| {
        for item in attached
            .iter_mut()
            .filter(|item| item.workspace_id == workspace_id)
        {
            item.path.clone_from(&entry.path);
        }
    })?;
    crate::services::storage::watcher::check_now(app);
    Ok(attached_info(&entry))
}

/// Removes the workspace from this device; its files stay where they are. The
/// indexes of its chats go: they are rebuilt if it is attached again.
pub fn detach_workspace(app: &AppHandle, workspace_id: &str) -> Result<(), AppError> {
    let state = app.state::<AppState>();
    let _access = state.write_workspace();
    save_attached(app, |attached| {
        attached.retain(|item| item.workspace_id != workspace_id)
    })?;
    if let Err(error) = crate::services::storage::remove_workspace_indexes(app, workspace_id) {
        log::warn!("Could not remove the chat indexes of the AI workspace {workspace_id}: {error}");
    }
    crate::services::storage::watcher::check_now(app);
    Ok(())
}

/// Renames an attached workspace, on every device that syncs it.
pub fn rename_workspace(app: &AppHandle, workspace_id: &str, name: &str) -> Result<(), AppError> {
    super::with_workspace_of(app, workspace_id, |workspace| {
        if workspace_id.is_empty() {
            return Err(AppError::InvalidInput(
                "The main AI workspace has no name of its own".into(),
            ));
        }
        marker::rename_attached(&workspace.root, name)
    })
}

/// Stores the chat history settings of a workspace, on every device that syncs
/// it; its chats are brought in line with them in the background.
pub fn set_workspace_chat_history(
    app: &AppHandle,
    workspace_id: &str,
    chat_history: super::WorkspaceChatHistory,
) -> Result<(), AppError> {
    super::with_workspace_of(app, workspace_id, |workspace| {
        super::settings::write_chat_history(&workspace.root, chat_history)
    })?;
    app.state::<AppState>().history.mark_chat_cleanup_pending();
    Ok(())
}

/// The profile as the webview names it: its id and the projects it may use
/// are references with the workspace part.
pub fn profile_to_ref(workspace_id: &str, profile: super::AiProfile) -> super::AiProfile {
    super::AiProfile {
        id: super::join_ref(workspace_id, &profile.id),
        project_permissions: profile
            .project_permissions
            .into_iter()
            .map(|(project, permission)| (super::join_ref(workspace_id, &project), permission))
            .collect(),
        ..profile
    }
}

/// The profile as stored in its workspace. A permission for a project of another
/// workspace is refused: the workspaces are kept apart.
pub fn profile_from_ref(
    workspace_id: &str,
    profile: super::AiProfile,
) -> Result<super::AiProfile, AppError> {
    let (_, id) = super::split_ref(&profile.id);
    let mut permissions = std::collections::HashMap::new();
    for (key, permission) in profile.project_permissions {
        let (project_workspace, project) = super::split_ref(&key);
        if project_workspace != workspace_id {
            return Err(AppError::InvalidInput(format!(
                "The profile {id} cannot use the project {key} of another AI workspace"
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
pub fn project_to_ref(workspace_id: &str, project: super::AiProject) -> super::AiProject {
    super::AiProject {
        id: super::join_ref(workspace_id, &project.id),
        ..project
    }
}

/// The project as stored in its workspace.
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

/// The profiles of every workspace that is there, by reference.
pub fn list_all_profiles(app: &AppHandle) -> Result<Vec<super::AiProfile>, AppError> {
    let state = app.state::<AppState>();
    let _access = state.read_workspace();
    let mut profiles = Vec::new();
    for (workspace_id, workspace) in connected_workspaces(app) {
        let lock = super::locking::workspace_lock(&workspace.root);
        use crate::locks::MutexExt;
        let _io = lock.locked();
        match super::list_profiles(&workspace.root) {
            Ok(listed) => profiles.extend(
                listed
                    .into_iter()
                    .map(|profile| profile_to_ref(&workspace_id, profile)),
            ),
            // one workspace that cannot be read hides no other
            Err(error) => log::warn!("Could not read the AI workspace {workspace_id}: {error}"),
        }
    }
    Ok(profiles)
}

/// The projects of every workspace that is there, by reference.
pub fn list_all_projects(app: &AppHandle) -> Result<Vec<super::AiProject>, AppError> {
    let state = app.state::<AppState>();
    let _access = state.read_workspace();
    let device = app.state::<crate::services::storage::device::DeviceStore>();
    let mut projects = Vec::new();
    let workspaces = connected_workspaces(app);
    let mut synced_roots: Vec<PathBuf> = workspaces
        .iter()
        .map(|(_, workspace)| workspace.root.clone())
        .collect();
    if let Ok(user_dir) = crate::services::storage::user_data::user_dir_for(
        app,
        crate::services::storage::UserDirAccess::Read,
    ) {
        synced_roots.push(user_dir);
    }
    for (workspace_id, workspace) in workspaces {
        let paths = super::ProjectPaths {
            device: &device,
            workspace_id: &workspace.id,
            protected_roots: Vec::new(),
        };
        let lock = super::locking::workspace_lock(&workspace.root);
        use crate::locks::MutexExt;
        let _io = lock.locked();
        match super::list_projects(&workspace.root, &paths) {
            Ok(listed) => projects.extend(
                listed
                    .into_iter()
                    .map(|project| mark_synced(project, &synced_roots))
                    .map(|project| project_to_ref(&workspace_id, project)),
            ),
            Err(error) => log::warn!("Could not read the AI workspace {workspace_id}: {error}"),
        }
    }
    Ok(projects)
}

#[cfg(test)]
mod tests {
    use super::super::{join_ref, split_ref, AiProfile, ProfileMemoryMode, ProjectPermission};
    use super::*;
    use crate::services::ai_workspace::ProjectAccessMode;

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
                            delete: ProjectAccessMode::Ask,
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
        let roots = [PathBuf::from("/data"), PathBuf::from("/work/workspace")];
        assert!(mark_synced(project("/data/code"), &roots)
            .is_inside_synced_folder
            .is_some());
        assert!(mark_synced(project("/work/workspace/x"), &roots)
            .is_inside_synced_folder
            .is_some());
        assert!(!mark_synced(project("/home/me/code"), &roots)
            .is_inside_synced_folder
            .is_some());
    }

    #[test]
    fn references_name_the_workspace_except_the_main_one() {
        assert_eq!(join_ref("", "profile-1"), "profile-1");
        assert_eq!(join_ref("w1", "profile-1"), "w1:profile-1");
        assert_eq!(split_ref("w1:profile-1"), ("w1", "profile-1"));
        assert_eq!(split_ref("profile-1"), ("", "profile-1"));
    }

    #[test]
    fn a_profile_reaches_the_projects_of_its_own_workspace_only() {
        let listed = profile_to_ref("w1", profile("writer", &["docs"]));
        assert_eq!(listed.id, "w1:writer");
        assert!(listed.project_permissions.contains_key("w1:docs"));

        let stored = profile_from_ref("w1", listed).unwrap();
        assert_eq!(stored.id, "writer");
        assert!(stored.project_permissions.contains_key("docs"));

        // a project of the main workspace, or of another one, is refused
        for other in ["docs", "w2:docs"] {
            assert!(matches!(
                profile_from_ref("w1", profile("w1:writer", &[other])),
                Err(AppError::InvalidInput(_))
            ));
        }
        // in the main workspace references are the bare ids
        let main = profile_from_ref("", profile("writer", &["docs"])).unwrap();
        assert!(main.project_permissions.contains_key("docs"));
    }
}
