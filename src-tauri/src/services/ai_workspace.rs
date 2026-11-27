#[cfg(test)]
mod tests;

pub mod config_refs;
pub(crate) mod entity_files;
pub mod marker;
pub mod memory;
pub mod operations;
pub mod settings;
pub mod transfer;
pub mod types;

pub use marker::Workspace;
pub use memory::*;
pub use operations::*;
pub use settings::{WorkspaceChatHistory, WorkspaceHistoryStorage};
pub use transfer::MovedEntity;
pub use types::*;

use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::errors::AppError;

mod locking;
mod registry;
pub use registry::*;

/// The folder of the main workspace inside the user data folder.
pub const WORKSPACE_DIR_NAME: &str = "ai-vault";

/// Separates the workspace from the id in a reference `[workspaceId:]id` the webview
/// uses for a profile or a project: ids never hold it.
pub const REF_SEPARATOR: char = ':';

/// The workspace and the id of a reference; an empty workspace is the main one.
pub fn split_ref(key: &str) -> (&str, &str) {
    key.split_once(REF_SEPARATOR).unwrap_or(("", key))
}

/// The reference of `id` in the workspace `workspace_id`, empty for the main one.
pub fn join_ref(workspace_id: &str, id: &str) -> String {
    if workspace_id.is_empty() {
        id.to_owned()
    } else {
        format!("{workspace_id}{REF_SEPARATOR}{id}")
    }
}

/// The main workspace of the app: always `ai-vault` inside the user data folder,
/// moved only with it.
pub fn main_workspace(app: &AppHandle) -> Result<Workspace, AppError> {
    let user_dir = crate::services::storage::user_data::user_dir_for(
        app,
        crate::services::storage::UserDirAccess::Read,
    )
    .map_err(|_| AppError::UserDataUnavailable("The data folder is not connected".into()))?;
    marker::open_default(&user_dir.join(WORKSPACE_DIR_NAME))
}

/// The workspace a reference names: empty for the main one, else one this
/// device attached. A workspace not attached, or not there now, is an error;
/// nothing is made in its place.
pub fn resolve_workspace(app: &AppHandle, workspace_id: &str) -> Result<Workspace, AppError> {
    let config = app.state::<crate::state::AppState>().user_config();
    resolve_workspace_in(
        main_workspace(app),
        &crate::models::user_config::attached_workspaces(&config),
        workspace_id,
    )
}

/// [`resolve_workspace`] over the main workspace as it opened and the workspaces this
/// device attached.
pub fn resolve_workspace_in(
    main: Result<Workspace, AppError>,
    attached: &[crate::models::user_config::AttachedWorkspace],
    workspace_id: &str,
) -> Result<Workspace, AppError> {
    if workspace_id.is_empty() {
        return main;
    }
    // the main workspace named by its own id, e.g. in a reference written by hand
    if let Ok(main) = main {
        if main.id == workspace_id {
            return Ok(main);
        }
    }
    let attached = attached
        .iter()
        .find(|workspace| workspace.workspace_id == workspace_id)
        .ok_or_else(|| {
            AppError::WorkspaceUnavailable(format!(
                "The workspace {workspace_id} is not attached on this device"
            ))
        })?;
    let workspace = marker::open_attached(std::path::Path::new(&attached.path))?;
    if workspace.id != workspace_id {
        return Err(AppError::WorkspaceUnavailable(format!(
            "The folder {} holds another workspace now",
            attached.path
        )));
    }
    Ok(workspace)
}

/// The workspace part of the references to `workspace`, reached by `workspace_id`: empty
/// for the main workspace, also when it is named by its own id.
pub fn canonical_workspace_ref(
    app: &AppHandle,
    workspace_id: &str,
    workspace: &Workspace,
) -> String {
    if workspace_id.is_empty() || main_workspace(app).is_ok_and(|main| main.id == workspace.id) {
        String::new()
    } else {
        workspace_id.to_owned()
    }
}

/// Runs `operation` on the root of the workspace `workspace_id` (empty: the main one);
/// access is held until all I/O using the path has completed.
pub fn with_workspace<T>(
    app: &AppHandle,
    workspace_id: &str,
    operation: impl FnOnce(&std::path::Path) -> Result<T, AppError>,
) -> Result<T, AppError> {
    with_workspace_of(app, workspace_id, |workspace| operation(&workspace.root))
}

/// [`with_workspace`] with the workspace and its id.
pub fn with_workspace_of<T>(
    app: &AppHandle,
    workspace_id: &str,
    operation: impl FnOnce(&Workspace) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let state = app.state::<crate::state::AppState>();
    let _access = state.read_workspace();
    let workspace = resolve_workspace(app, workspace_id)?;
    let lock = locking::workspace_lock(&workspace.root);
    use crate::locks::MutexExt;
    let _io = lock.locked();
    operation(&workspace)
}

/// [`with_workspace`] with the folders the external projects of the workspace have
/// on this device.
pub fn with_projects<T>(
    app: &AppHandle,
    workspace_id: &str,
    operation: impl FnOnce(&std::path::Path, &ProjectPaths) -> Result<T, AppError>,
) -> Result<T, AppError> {
    with_workspace_of(app, workspace_id, |workspace| {
        let device = app.state::<crate::services::storage::device::DeviceStore>();
        operation(
            &workspace.root,
            &ProjectPaths {
                device: &device,
                workspace_id: &workspace.id,
                protected_roots: protected_roots(app),
            },
        )
    })
}

/// [`with_projects`] for work that may take long, such as a file tool
/// searching a large project: `load` runs under the lock of the workspace,
/// `then` only with the workspace access held, so that it holds up no other
/// work on the workspace while the folders cannot move away.
pub fn with_projects_then<L, T>(
    app: &AppHandle,
    workspace_id: &str,
    load: impl FnOnce(&std::path::Path, &ProjectPaths) -> Result<L, AppError>,
    then: impl FnOnce(L) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let state = app.state::<crate::state::AppState>();
    let _access = state.read_workspace();
    let workspace = resolve_workspace(app, workspace_id)?;
    let loaded = {
        let lock = locking::workspace_lock(&workspace.root);
        use crate::locks::MutexExt;
        let _io = lock.locked();
        let device = app.state::<crate::services::storage::device::DeviceStore>();
        load(
            &workspace.root,
            &ProjectPaths {
                device: &device,
                workspace_id: &workspace.id,
                protected_roots: protected_roots(app),
            },
        )?
    };
    then(loaded)
}

/// Runs `operation` on two different workspaces, each locked as by
/// [`with_workspace_of`]; the locks are taken in the order of their folders, so
/// two moves in opposite directions cannot wait on each other.
fn with_two_workspaces<T>(
    app: &AppHandle,
    from_id: &str,
    to_id: &str,
    operation: impl FnOnce(&Workspace, &Workspace) -> Result<T, AppError>,
) -> Result<T, AppError> {
    use crate::locks::MutexExt;
    let state = app.state::<crate::state::AppState>();
    let _access = state.read_workspace();
    let from = resolve_workspace(app, from_id)?;
    let to = resolve_workspace(app, to_id)?;
    if from.id == to.id {
        return Err(AppError::InvalidInput(
            "The destination is the workspace the item is in already".into(),
        ));
    }
    let (first, second) = if from.root <= to.root {
        (&from, &to)
    } else {
        (&to, &from)
    };
    let first_lock = locking::workspace_lock(&first.root);
    let second_lock = locking::workspace_lock(&second.root);
    let _first = first_lock.locked();
    let _second = second_lock.locked();
    operation(&from, &to)
}

/// Moves a profile, named by its reference, to the workspace `to_id` (empty: the
/// main one). Returns its reference there; the webview rewrites the
/// references in the settings.
pub fn move_profile_to_workspace(
    app: &AppHandle,
    profile_ref: &str,
    to_id: &str,
) -> Result<MovedEntity, AppError> {
    let (from_id, id) = split_ref(profile_ref);
    let (from_ref, moved) = with_two_workspaces(app, from_id, to_id, |from, to| {
        let moved = crate::services::storage::while_chats_locked_in_workspace(app, || {
            transfer::move_profile(&from.root, &to.root, id)
        })?;
        app.state::<MemoryReadVersions>()
            .clear_profile(&from.root, id);
        if let Err(error) = crate::services::storage::remove_profile_index(app, &from.id, id) {
            log::warn!("Could not remove the chat index of the profile {id}: {error}");
        }
        Ok((
            join_ref(&canonical_workspace_ref(app, from_id, from), id),
            MovedEntity {
                id: join_ref(&canonical_workspace_ref(app, to_id, to), &moved.id),
            },
        ))
    })?;
    crate::services::storage::move_session_chats(app, &from_ref, Some(&moved.id));
    // after the workspace locks are released: a settings save takes workspace access
    // itself. The profile is moved already, so a failure here is only logged
    // and leaves the settings naming a profile that is gone.
    let mut probe = Value::clone(&app.state::<crate::state::AppState>().user_config());
    if !config_refs::rewrite_profile_refs(&mut probe, &from_ref, &moved.id) {
        return Ok(moved);
    }
    if let Err(error) = crate::services::settings::update_user_config(app, |config| {
        config_refs::rewrite_profile_refs(config, &from_ref, &moved.id);
    }) {
        log::error!("Could not point the settings to the moved profile {id}: {error}");
    }
    Ok(moved)
}

/// Moves a project, named by its reference, to the workspace `to_id` (empty: the
/// main one). Returns its reference there.
pub fn move_project_to_workspace(
    app: &AppHandle,
    project_ref: &str,
    to_id: &str,
) -> Result<MovedEntity, AppError> {
    let (from_id, id) = split_ref(project_ref);
    with_two_workspaces(app, from_id, to_id, |from, to| {
        let device = app.state::<crate::services::storage::device::DeviceStore>();
        let from_paths = ProjectPaths {
            device: &device,
            workspace_id: &from.id,
            protected_roots: protected_roots(app),
        };
        let to_paths = ProjectPaths {
            device: &device,
            workspace_id: &to.id,
            protected_roots: protected_roots(app),
        };
        let moved = transfer::move_project(&from.root, &from_paths, &to.root, &to_paths, id)?;
        Ok(MovedEntity {
            id: join_ref(&canonical_workspace_ref(app, to_id, to), &moved.id),
        })
    })
}
