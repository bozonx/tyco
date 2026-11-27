use tauri::AppHandle;
use tauri::Manager;

use super::run_blocking;
use crate::{
    errors::AppError,
    services::ai_vault::{
        self, AiProfile, AiProject, ProfileMemoryChange, ProfileMemorySearchResult,
        ProfileMemoryTopic, ProfileSoul, VaultFolder, VaultInfo,
    },
    services::storage,
};

// Profiles and projects are named by references `[vaultId:]id`: the vault
// part is empty for the main vault, see `ai_vault::split_ref`.

/// Shows a vault, or one profile folder in it, in the file manager. The path
/// is built here: the webview never names a folder to open.
#[tauri::command]
pub async fn open_ai_vault_location(
    app: AppHandle,
    vault_id: Option<String>,
    profile_id: Option<String>,
) -> Result<(), AppError> {
    run_blocking(move || {
        let (vault_id, profile_id) = match profile_id.as_deref().map(ai_vault::split_ref) {
            Some((vault_id, id)) => (vault_id.to_owned(), Some(id.to_owned())),
            None => (vault_id.unwrap_or_default(), None),
        };
        ai_vault::with_vault(&app, &vault_id, |dir| {
            let target = ai_vault::vault_dir_to_open(dir, profile_id.as_deref())?;
            crate::services::platform::open_dir(&target)
        })
    })
    .await?
}

/// The main vault and the attached ones of this device.
#[tauri::command]
pub async fn list_ai_vaults(app: AppHandle) -> Result<Vec<VaultInfo>, AppError> {
    run_blocking(move || ai_vault::list_vaults(&app)).await?
}

/// What a folder holds as a vault to attach.
#[tauri::command]
pub async fn inspect_ai_vault_folder(
    app: AppHandle,
    path: String,
) -> Result<VaultFolder, AppError> {
    run_blocking(move || ai_vault::inspect_vault_folder(&app, &path)).await?
}

/// Attaches a folder as a vault of this device; an empty one gets a new
/// vault named `name`.
#[tauri::command]
pub async fn attach_ai_vault(
    app: AppHandle,
    path: String,
    name: String,
) -> Result<VaultInfo, AppError> {
    run_blocking(move || ai_vault::attach_vault(&app, &path, &name)).await?
}

/// Points an attached vault to the folder it has on this device now.
#[tauri::command]
pub async fn relink_ai_vault(
    app: AppHandle,
    vault_id: String,
    path: String,
) -> Result<VaultInfo, AppError> {
    run_blocking(move || ai_vault::relink_vault(&app, &vault_id, &path)).await?
}

/// Removes a vault from this device; its files stay.
#[tauri::command]
pub async fn detach_ai_vault(app: AppHandle, vault_id: String) -> Result<(), AppError> {
    run_blocking(move || ai_vault::detach_vault(&app, &vault_id)).await?
}

/// Renames an attached vault on every device.
#[tauri::command]
pub async fn rename_ai_vault(
    app: AppHandle,
    vault_id: String,
    name: String,
) -> Result<(), AppError> {
    run_blocking(move || ai_vault::rename_vault(&app, &vault_id, &name)).await?
}

/// Stores the chat history settings of a vault and brings its chats in line
/// with them in the background.
#[tauri::command]
pub async fn set_ai_vault_chat_history(
    app: AppHandle,
    vault_id: String,
    chat_history: ai_vault::VaultChatHistory,
) -> Result<(), AppError> {
    run_blocking(move || ai_vault::set_vault_chat_history(&app, &vault_id, chat_history)).await?
}

/// Moves a profile with its chats, memory and files to another vault.
#[tauri::command]
pub async fn move_ai_profile(
    app: AppHandle,
    id: String,
    vault_id: String,
) -> Result<ai_vault::MovedEntity, AppError> {
    run_blocking(move || ai_vault::move_profile_to_vault(&app, &id, &vault_id)).await?
}

/// Moves a project to another vault.
#[tauri::command]
pub async fn move_ai_project(
    app: AppHandle,
    id: String,
    vault_id: String,
) -> Result<ai_vault::MovedEntity, AppError> {
    run_blocking(move || ai_vault::move_project_to_vault(&app, &id, &vault_id)).await?
}

/// The profiles of every vault that is there.
#[tauri::command]
pub async fn list_ai_profiles(app: AppHandle) -> Result<Vec<AiProfile>, AppError> {
    run_blocking(move || ai_vault::list_all_profiles(&app)).await?
}

#[tauri::command]
pub async fn get_ai_profile(app: AppHandle, id: String) -> Result<AiProfile, AppError> {
    run_blocking(move || {
        let (vault_id, id) = ai_vault::split_ref(&id);
        ai_vault::with_vault_of(&app, vault_id, |vault| {
            // the main vault named by its own id still gets the bare reference
            let vault_ref = ai_vault::canonical_vault_ref(&app, vault_id, vault);
            Ok(ai_vault::profile_to_ref(
                &vault_ref,
                ai_vault::get_profile(&vault.root, id)?,
            ))
        })
    })
    .await?
}

/// Creates the profile in the vault its reference names.
#[tauri::command]
pub async fn create_ai_profile(
    app: AppHandle,
    profile: AiProfile,
    soul: String,
) -> Result<String, AppError> {
    run_blocking(move || {
        let vault_id = ai_vault::split_ref(&profile.id).0.to_owned();
        let profile = ai_vault::profile_from_ref(&vault_id, profile)?;
        ai_vault::with_vault(&app, &vault_id, |dir| {
            ai_vault::create_profile(dir, profile, &soul)
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
        let vault_id = ai_vault::split_ref(&profile.id).0.to_owned();
        let profile = ai_vault::profile_from_ref(&vault_id, profile)?;
        ai_vault::with_vault(&app, &vault_id, |dir| {
            ai_vault::save_profile(dir, profile, expected_revision.as_deref())
        })
    })
    .await?
}

/// The profile goes with its chats, so no chat of it is being written meanwhile.
#[tauri::command]
pub async fn delete_ai_profile(app: AppHandle, id: String) -> Result<(), AppError> {
    run_blocking(move || {
        let (vault_id, id) = ai_vault::split_ref(&id);
        ai_vault::with_vault_of(&app, vault_id, |vault| {
            // Vault access is already held; do not acquire it recursively.
            storage::while_chats_locked_in_vault(&app, || {
                ai_vault::delete_profile(
                    &vault.root,
                    &app.state::<ai_vault::MemoryReadVersions>(),
                    id,
                )
            })?;
            let profile_ref =
                ai_vault::join_ref(&ai_vault::canonical_vault_ref(&app, vault_id, vault), id);
            storage::move_session_chats(&app, &profile_ref, None);
            if let Err(error) = storage::remove_profile_index(&app, &vault.id, id) {
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
        let (vault_id, id) = ai_vault::split_ref(&id);
        ai_vault::with_vault(&app, vault_id, |dir| {
            ai_vault::read_profile_soul_revision(dir, id)
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
        let (vault_id, id) = ai_vault::split_ref(&id);
        ai_vault::with_vault(&app, vault_id, |dir| {
            ai_vault::write_profile_soul(dir, id, &content, expected_revision.as_deref())
        })
    })
    .await?
}

/// The projects of every vault that is there.
#[tauri::command]
pub async fn list_ai_projects(app: AppHandle) -> Result<Vec<AiProject>, AppError> {
    run_blocking(move || ai_vault::list_all_projects(&app)).await?
}

#[tauri::command]
pub async fn create_ai_project(app: AppHandle, project: AiProject) -> Result<String, AppError> {
    run_blocking(move || {
        let vault_id = ai_vault::split_ref(&project.id).0.to_owned();
        ai_vault::with_projects(&app, &vault_id, |dir, paths| {
            ai_vault::create_project(dir, paths, ai_vault::project_from_ref(project))
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
        let vault_id = ai_vault::split_ref(&project.id).0.to_owned();
        ai_vault::with_projects(&app, &vault_id, |dir, paths| {
            ai_vault::save_project(
                dir,
                paths,
                ai_vault::project_from_ref(project),
                expected_revision.as_deref(),
            )
        })
    })
    .await?
}

/// Turns an internal project into an external one with its folder at
/// `target_path`, or back; `transfer_files` moves or copies its files.
/// Returns the new revision.
#[tauri::command]
pub async fn convert_ai_project(
    app: AppHandle,
    id: String,
    target_path: Option<String>,
    transfer_files: bool,
    expected_revision: Option<String>,
) -> Result<String, AppError> {
    run_blocking(move || {
        let (vault_id, project_id) = ai_vault::split_ref(&id);
        ai_vault::with_projects(&app, vault_id, |dir, paths| {
            ai_vault::convert_project(
                dir,
                paths,
                project_id,
                target_path.as_deref(),
                transfer_files,
                expected_revision.as_deref(),
            )
        })
    })
    .await?
}

#[tauri::command]
pub async fn delete_ai_project(app: AppHandle, id: String) -> Result<(), AppError> {
    run_blocking(move || {
        let (vault_id, id) = ai_vault::split_ref(&id);
        ai_vault::with_projects(&app, vault_id, |dir, paths| {
            ai_vault::delete_project(dir, paths, id)
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
        let (vault_id, profile_id) = ai_vault::split_ref(&profile_id);
        ai_vault::with_vault(&app, vault_id, |dir| {
            ai_vault::list_profile_memory_topics(dir, profile_id)
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
        let (vault_id, profile_id) = ai_vault::split_ref(&profile_id);
        ai_vault::with_vault(&app, vault_id, |dir| {
            ai_vault::read_profile_memory(
                dir,
                &app.state::<ai_vault::MemoryReadVersions>(),
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
        let (vault_id, profile_id) = ai_vault::split_ref(&profile_id);
        ai_vault::with_vault(&app, vault_id, |dir| {
            ai_vault::peek_profile_memory(dir, profile_id, &file)
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
        let (vault_id, profile_id) = ai_vault::split_ref(&profile_id);
        ai_vault::with_vault(&app, vault_id, |dir| {
            ai_vault::save_profile_memory(
                dir,
                &app.state::<ai_vault::MemoryReadVersions>(),
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
        let (vault_id, profile_id) = ai_vault::split_ref(&profile_id);
        ai_vault::with_vault(&app, vault_id, |dir| {
            ai_vault::search_profile_memory(dir, profile_id, &query)
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
        let (vault_id, profile_id) = ai_vault::split_ref(&profile_id);
        ai_vault::with_vault(&app, vault_id, |dir| {
            ai_vault::add_profile_memory_fact(
                dir,
                &app.state::<ai_vault::MemoryReadVersions>(),
                profile_id,
                chat_id.as_deref(),
                &file,
                ai_vault::MemoryEntry {
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
        let (vault_id, profile_id) = ai_vault::split_ref(&profile_id);
        ai_vault::with_vault(&app, vault_id, |dir| {
            ai_vault::replace_profile_memory(
                dir,
                &app.state::<ai_vault::MemoryReadVersions>(),
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
        let (vault_id, profile_id) = ai_vault::split_ref(&profile_id);
        ai_vault::with_vault(&app, vault_id, |dir| {
            ai_vault::rewrite_profile_memory(
                dir,
                &app.state::<ai_vault::MemoryReadVersions>(),
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
        let (vault_id, profile_id) = ai_vault::split_ref(&profile_id);
        ai_vault::with_vault(&app, vault_id, |dir| {
            ai_vault::undo_profile_memory(
                dir,
                &app.state::<ai_vault::MemoryReadVersions>(),
                profile_id,
                chat_id.as_deref(),
                &file,
            )
        })
    })
    .await?
}

/// Clears all memory topics and resets `core.md` to default for a profile.
#[tauri::command]
pub async fn clear_ai_profile_memory(app: AppHandle, profile_id: String) -> Result<(), AppError> {
    run_blocking(move || {
        let (vault_id, profile_id) = ai_vault::split_ref(&profile_id);
        ai_vault::with_vault(&app, vault_id, |dir| {
            ai_vault::clear_profile_memory(
                dir,
                &app.state::<ai_vault::MemoryReadVersions>(),
                profile_id,
            )
        })
    })
    .await?
}
