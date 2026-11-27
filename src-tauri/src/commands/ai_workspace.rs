use tauri::AppHandle;
use tauri::Manager;

use super::run_blocking;
use crate::{
    errors::AppError,
    services::ai_workspace::{
        self, AiProfile, AiProject, ProfileMemoryChange, ProfileMemorySearchResult,
        ProfileMemoryTopic, ProfileSoul, ProjectConversion, ProjectTransferPreview,
        WorkspaceFolder, WorkspaceInfo,
    },
    services::storage,
};

// Profiles and projects are named by references `[workspaceId:]id`: the workspace
// part is empty for the main workspace, see `ai_workspace::split_ref`.

/// Shows a workspace, or one profile folder in it, in the file manager. The path
/// is built here: the webview never names a folder to open.
#[tauri::command]
pub async fn open_ai_workspace_location(
    app: AppHandle,
    workspace_id: Option<String>,
    profile_id: Option<String>,
) -> Result<(), AppError> {
    run_blocking(move || {
        let (workspace_id, profile_id) = match profile_id.as_deref().map(ai_workspace::split_ref) {
            Some((workspace_id, id)) => (workspace_id.to_owned(), Some(id.to_owned())),
            None => (workspace_id.unwrap_or_default(), None),
        };
        ai_workspace::with_workspace(&app, &workspace_id, |dir| {
            let target = ai_workspace::workspace_dir_to_open(dir, profile_id.as_deref())?;
            crate::services::platform::open_dir(&target)
        })
    })
    .await?
}

/// The main workspace and the attached ones of this device.
#[tauri::command]
pub async fn list_ai_workspaces(app: AppHandle) -> Result<Vec<WorkspaceInfo>, AppError> {
    run_blocking(move || ai_workspace::list_workspaces(&app)).await?
}

/// What a folder holds as a workspace to attach.
#[tauri::command]
pub async fn inspect_ai_workspace_folder(
    app: AppHandle,
    path: String,
) -> Result<WorkspaceFolder, AppError> {
    run_blocking(move || ai_workspace::inspect_workspace_folder(&app, &path)).await?
}

/// Attaches a folder as a workspace of this device; an empty one gets a new
/// workspace named `name`.
#[tauri::command]
pub async fn attach_ai_workspace(
    app: AppHandle,
    path: String,
    name: String,
) -> Result<WorkspaceInfo, AppError> {
    run_blocking(move || ai_workspace::attach_workspace(&app, &path, &name)).await?
}

/// Points an attached workspace to the folder it has on this device now.
#[tauri::command]
pub async fn relink_ai_workspace(
    app: AppHandle,
    workspace_id: String,
    path: String,
) -> Result<WorkspaceInfo, AppError> {
    run_blocking(move || ai_workspace::relink_workspace(&app, &workspace_id, &path)).await?
}

/// Removes a workspace from this device; its files stay.
#[tauri::command]
pub async fn detach_ai_workspace(app: AppHandle, workspace_id: String) -> Result<(), AppError> {
    run_blocking(move || ai_workspace::detach_workspace(&app, &workspace_id)).await?
}

/// Renames an attached workspace on every device.
#[tauri::command]
pub async fn rename_ai_workspace(
    app: AppHandle,
    workspace_id: String,
    name: String,
) -> Result<(), AppError> {
    run_blocking(move || ai_workspace::rename_workspace(&app, &workspace_id, &name)).await?
}

/// Stores the chat history settings of a workspace and brings its chats in line
/// with them in the background.
#[tauri::command]
pub async fn set_ai_workspace_chat_history(
    app: AppHandle,
    workspace_id: String,
    chat_history: ai_workspace::WorkspaceChatHistory,
) -> Result<(), AppError> {
    run_blocking(move || {
        ai_workspace::set_workspace_chat_history(&app, &workspace_id, chat_history)
    })
    .await?
}

/// Moves a profile with its chats, memory and files to another workspace.
#[tauri::command]
pub async fn move_ai_profile(
    app: AppHandle,
    id: String,
    workspace_id: String,
) -> Result<ai_workspace::MovedEntity, AppError> {
    run_blocking(move || ai_workspace::move_profile_to_workspace(&app, &id, &workspace_id)).await?
}

/// Moves a project to another workspace.
#[tauri::command]
pub async fn move_ai_project(
    app: AppHandle,
    id: String,
    workspace_id: String,
) -> Result<ai_workspace::MovedEntity, AppError> {
    run_blocking(move || ai_workspace::move_project_to_workspace(&app, &id, &workspace_id)).await?
}

/// The profiles of every workspace that is there.
#[tauri::command]
pub async fn list_ai_profiles(app: AppHandle) -> Result<Vec<AiProfile>, AppError> {
    run_blocking(move || ai_workspace::list_all_profiles(&app)).await?
}

#[tauri::command]
pub async fn get_ai_profile(app: AppHandle, id: String) -> Result<AiProfile, AppError> {
    run_blocking(move || {
        let (workspace_id, id) = ai_workspace::split_ref(&id);
        ai_workspace::with_workspace_of(&app, workspace_id, |workspace| {
            // the main workspace named by its own id still gets the bare reference
            let workspace_ref =
                ai_workspace::canonical_workspace_ref(&app, workspace_id, workspace);
            Ok(ai_workspace::profile_to_ref(
                &workspace_ref,
                ai_workspace::get_profile(&workspace.root, id)?,
            ))
        })
    })
    .await?
}

/// Creates the profile in the workspace its reference names.
#[tauri::command]
pub async fn create_ai_profile(
    app: AppHandle,
    profile: AiProfile,
    soul: String,
) -> Result<String, AppError> {
    run_blocking(move || {
        let workspace_id = ai_workspace::split_ref(&profile.id).0.to_owned();
        let profile = ai_workspace::profile_from_ref(&workspace_id, profile)?;
        ai_workspace::with_workspace(&app, &workspace_id, |dir| {
            ai_workspace::create_profile(dir, profile, &soul)
        })
    })
    .await?
}

/// Saves the profile; with `expected_revision` only over the file as it was
/// read. Returns the new revision.
#[tauri::command]
pub async fn save_ai_profile(
    app: AppHandle,
    profile: AiProfile,
    expected_revision: Option<String>,
) -> Result<String, AppError> {
    run_blocking(move || {
        let workspace_id = ai_workspace::split_ref(&profile.id).0.to_owned();
        let profile = ai_workspace::profile_from_ref(&workspace_id, profile)?;
        ai_workspace::with_workspace(&app, &workspace_id, |dir| {
            ai_workspace::save_profile(dir, profile, expected_revision.as_deref())
        })
    })
    .await?
}

/// The profile goes with its chats, so no chat of it is being written meanwhile.
#[tauri::command]
pub async fn delete_ai_profile(app: AppHandle, id: String) -> Result<(), AppError> {
    run_blocking(move || {
        let (workspace_id, id) = ai_workspace::split_ref(&id);
        ai_workspace::with_workspace_of(&app, workspace_id, |workspace| {
            // Workspace access is already held; do not acquire it recursively.
            storage::while_chats_locked_in_workspace(&app, || {
                ai_workspace::delete_profile(
                    &workspace.root,
                    &app.state::<ai_workspace::MemoryReadVersions>(),
                    id,
                )
            })?;
            let profile_ref = ai_workspace::join_ref(
                &ai_workspace::canonical_workspace_ref(&app, workspace_id, workspace),
                id,
            );
            storage::move_session_chats(&app, &profile_ref, None);
            if let Err(error) = storage::remove_profile_index(&app, &workspace.id, id) {
                log::warn!("Could not remove the chat index of the profile {id}: {error}");
            }
            Ok(())
        })
    })
    .await?
}

#[tauri::command]
pub async fn read_ai_profile_soul(app: AppHandle, id: String) -> Result<ProfileSoul, AppError> {
    run_blocking(move || {
        let (workspace_id, id) = ai_workspace::split_ref(&id);
        ai_workspace::with_workspace(&app, workspace_id, |dir| {
            ai_workspace::read_profile_soul_revision(dir, id)
        })
    })
    .await?
}

/// Writes `SOUL.md`; with `expected_revision` only over the file as it was
/// read. Returns the new revision.
#[tauri::command]
pub async fn write_ai_profile_soul(
    app: AppHandle,
    id: String,
    content: String,
    expected_revision: Option<String>,
) -> Result<String, AppError> {
    run_blocking(move || {
        let (workspace_id, id) = ai_workspace::split_ref(&id);
        ai_workspace::with_workspace(&app, workspace_id, |dir| {
            ai_workspace::write_profile_soul(dir, id, &content, expected_revision.as_deref())
        })
    })
    .await?
}

/// The projects of every workspace that is there.
#[tauri::command]
pub async fn list_ai_projects(app: AppHandle) -> Result<Vec<AiProject>, AppError> {
    run_blocking(move || ai_workspace::list_all_projects(&app)).await?
}

#[tauri::command]
pub async fn create_ai_project(app: AppHandle, project: AiProject) -> Result<String, AppError> {
    run_blocking(move || {
        let workspace_id = ai_workspace::split_ref(&project.id).0.to_owned();
        ai_workspace::with_projects(&app, &workspace_id, |dir, paths| {
            ai_workspace::create_project(dir, paths, ai_workspace::project_from_ref(project))
        })
    })
    .await?
}

/// Saves the project; with `expected_revision` only over the file as it was
/// read. Returns the new revision.
#[tauri::command]
pub async fn save_ai_project(
    app: AppHandle,
    project: AiProject,
    expected_revision: Option<String>,
) -> Result<String, AppError> {
    run_blocking(move || {
        let workspace_id = ai_workspace::split_ref(&project.id).0.to_owned();
        ai_workspace::with_projects(&app, &workspace_id, |dir, paths| {
            ai_workspace::save_project(
                dir,
                paths,
                ai_workspace::project_from_ref(project),
                expected_revision.as_deref(),
            )
        })
    })
    .await?
}

/// What converting the project would transfer; `target_path` is the folder
/// an internal project would get.
#[tauri::command]
pub async fn inspect_ai_project_transfer(
    app: AppHandle,
    id: String,
    target_path: Option<String>,
) -> Result<ProjectTransferPreview, AppError> {
    run_blocking(move || {
        let (workspace_id, project_id) = ai_workspace::split_ref(&id);
        ai_workspace::with_projects(&app, workspace_id, |dir, paths| {
            ai_workspace::inspect_project_transfer(dir, paths, project_id, target_path.as_deref())
        })
    })
    .await?
}

/// Turns an internal project into an external one with its folder at
/// `target_path`, moving its files there, or back; an external one copies
/// the files of its folder with `transfer_files`, then moves that folder to
/// the trash with `trash_source`.
#[tauri::command]
pub async fn convert_ai_project(
    app: AppHandle,
    id: String,
    target_path: Option<String>,
    transfer_files: bool,
    trash_source: bool,
    expected_revision: Option<String>,
) -> Result<ProjectConversion, AppError> {
    run_blocking(move || {
        let (workspace_id, project_id) = ai_workspace::split_ref(&id);
        let to_trash = |path: &std::path::Path| {
            trash::delete(path)
                .map_err(|error| AppError::Failed(format!("Could not move to the trash: {error}")))
        };
        ai_workspace::with_projects(&app, workspace_id, |dir, paths| {
            ai_workspace::convert_project(
                dir,
                paths,
                project_id,
                target_path.as_deref(),
                transfer_files,
                trash_source.then_some(&to_trash as &ai_workspace::DiscardFolder),
                expected_revision.as_deref(),
            )
        })
    })
    .await?
}

/// Shows the folder of the project in the file manager: its workspace folder,
/// or the folder of an external project on this device. The path is
/// resolved here: the webview never names a folder to open.
#[tauri::command]
pub async fn open_ai_project_location(app: AppHandle, id: String) -> Result<(), AppError> {
    run_blocking(move || {
        let (workspace_id, project_id) = ai_workspace::split_ref(&id);
        ai_workspace::with_projects(&app, workspace_id, |dir, paths| {
            let folder = ai_workspace::project_folder_on_device(dir, paths, project_id)?;
            crate::services::platform::open_dir(&folder)
        })
    })
    .await?
}

#[tauri::command]
pub async fn delete_ai_project(app: AppHandle, id: String) -> Result<(), AppError> {
    run_blocking(move || {
        let (workspace_id, id) = ai_workspace::split_ref(&id);
        ai_workspace::with_projects(&app, workspace_id, |dir, paths| {
            ai_workspace::delete_project(dir, paths, id)
        })
    })
    .await?
}

/// Lists all memory topics and core summary for a profile.
#[tauri::command]
pub async fn list_ai_profile_memory_topics(
    app: AppHandle,
    profile_id: String,
) -> Result<Vec<ProfileMemoryTopic>, AppError> {
    run_blocking(move || {
        let (workspace_id, profile_id) = ai_workspace::split_ref(&profile_id);
        ai_workspace::with_workspace(&app, workspace_id, |dir| {
            ai_workspace::list_profile_memory_topics(dir, profile_id)
        })
    })
    .await?
}

/// Reads a profile memory file (`core.md` or a topic file) for the model of
/// the chat `chat_id`, whose later changes are checked against this read.
#[tauri::command]
pub async fn read_ai_profile_memory(
    app: AppHandle,
    profile_id: String,
    chat_id: Option<String>,
    file: String,
) -> Result<String, AppError> {
    run_blocking(move || {
        let (workspace_id, profile_id) = ai_workspace::split_ref(&profile_id);
        ai_workspace::with_workspace(&app, workspace_id, |dir| {
            ai_workspace::read_profile_memory(
                dir,
                &app.state::<ai_workspace::MemoryReadVersions>(),
                profile_id,
                chat_id.as_deref(),
                &file,
            )
        })
    })
    .await?
}

/// Reads a profile memory file without counting as a read of the model:
/// for instructions, previews and the settings.
#[tauri::command]
pub async fn peek_ai_profile_memory(
    app: AppHandle,
    profile_id: String,
    file: String,
) -> Result<String, AppError> {
    run_blocking(move || {
        let (workspace_id, profile_id) = ai_workspace::split_ref(&profile_id);
        ai_workspace::with_workspace(&app, workspace_id, |dir| {
            ai_workspace::peek_profile_memory(dir, profile_id, &file)
        })
    })
    .await?
}

/// Stores a memory file the user edited; with `expected_content` only over
/// the file as the editor opened it.
#[tauri::command]
pub async fn save_ai_profile_memory(
    app: AppHandle,
    profile_id: String,
    file: String,
    content: String,
    expected_content: Option<String>,
) -> Result<(), AppError> {
    run_blocking(move || {
        let (workspace_id, profile_id) = ai_workspace::split_ref(&profile_id);
        ai_workspace::with_workspace(&app, workspace_id, |dir| {
            ai_workspace::save_profile_memory(
                dir,
                &app.state::<ai_workspace::MemoryReadVersions>(),
                profile_id,
                &file,
                &content,
                expected_content.as_deref(),
            )
        })
    })
    .await?
}

/// Searches the profile's memory for matching lines.
#[tauri::command]
pub async fn search_ai_profile_memory(
    app: AppHandle,
    profile_id: String,
    query: String,
) -> Result<Vec<ProfileMemorySearchResult>, AppError> {
    run_blocking(move || {
        let (workspace_id, profile_id) = ai_workspace::split_ref(&profile_id);
        ai_workspace::with_workspace(&app, workspace_id, |dir| {
            ai_workspace::search_profile_memory(dir, profile_id, &query)
        })
    })
    .await?
}

/// Appends a fact or thesis to a memory file.
#[tauri::command]
pub async fn add_ai_profile_memory_fact(
    app: AppHandle,
    profile_id: String,
    chat_id: Option<String>,
    file: String,
    fact: String,
    section: Option<String>,
    description: Option<String>,
) -> Result<ProfileMemoryChange, AppError> {
    run_blocking(move || {
        let (workspace_id, profile_id) = ai_workspace::split_ref(&profile_id);
        ai_workspace::with_workspace(&app, workspace_id, |dir| {
            ai_workspace::add_profile_memory_fact(
                dir,
                &app.state::<ai_workspace::MemoryReadVersions>(),
                profile_id,
                chat_id.as_deref(),
                &file,
                ai_workspace::MemoryEntry {
                    fact: &fact,
                    section: section.as_deref(),
                    description: description.as_deref(),
                },
            )
        })
    })
    .await?
}

/// Replaces an outdated fact or thesis with a new one.
#[tauri::command]
pub async fn replace_ai_profile_memory(
    app: AppHandle,
    profile_id: String,
    chat_id: Option<String>,
    file: String,
    old_text: String,
    new_text: String,
) -> Result<ProfileMemoryChange, AppError> {
    run_blocking(move || {
        let (workspace_id, profile_id) = ai_workspace::split_ref(&profile_id);
        ai_workspace::with_workspace(&app, workspace_id, |dir| {
            ai_workspace::replace_profile_memory(
                dir,
                &app.state::<ai_workspace::MemoryReadVersions>(),
                profile_id,
                chat_id.as_deref(),
                &file,
                &old_text,
                &new_text,
            )
        })
    })
    .await?
}

/// Completely rewrites a memory file for the model of a chat.
#[tauri::command]
pub async fn rewrite_ai_profile_memory(
    app: AppHandle,
    profile_id: String,
    chat_id: Option<String>,
    file: String,
    content: String,
) -> Result<ProfileMemoryChange, AppError> {
    run_blocking(move || {
        let (workspace_id, profile_id) = ai_workspace::split_ref(&profile_id);
        ai_workspace::with_workspace(&app, workspace_id, |dir| {
            ai_workspace::rewrite_profile_memory(
                dir,
                &app.state::<ai_workspace::MemoryReadVersions>(),
                profile_id,
                chat_id.as_deref(),
                &file,
                &content,
            )
        })
    })
    .await?
}

/// Restores a memory file to its snapshot taken prior to changes in the chat.
#[tauri::command]
pub async fn undo_ai_profile_memory(
    app: AppHandle,
    profile_id: String,
    chat_id: Option<String>,
    file: String,
) -> Result<ProfileMemoryChange, AppError> {
    run_blocking(move || {
        let (workspace_id, profile_id) = ai_workspace::split_ref(&profile_id);
        ai_workspace::with_workspace(&app, workspace_id, |dir| {
            ai_workspace::undo_profile_memory(
                dir,
                &app.state::<ai_workspace::MemoryReadVersions>(),
                profile_id,
                chat_id.as_deref(),
                &file,
            )
        })
    })
    .await?
}

/// Deletes one memory file of a profile; `core.md` is reset instead.
#[tauri::command]
pub async fn delete_ai_profile_memory_file(
    app: AppHandle,
    profile_id: String,
    file: String,
) -> Result<(), AppError> {
    run_blocking(move || {
        let (workspace_id, profile_id) = ai_workspace::split_ref(&profile_id);
        ai_workspace::with_workspace(&app, workspace_id, |dir| {
            ai_workspace::delete_profile_memory_file(
                dir,
                &app.state::<ai_workspace::MemoryReadVersions>(),
                profile_id,
                &file,
            )
        })
    })
    .await?
}
