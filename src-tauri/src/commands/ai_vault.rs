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

/// The folder of the main vault.
#[tauri::command]
pub async fn get_ai_vault_path(app: AppHandle) -> Result<String, AppError> {
    run_blocking(move || {
        ai_vault::with_vault(&app, "", |dir| Ok(dir.to_string_lossy().into_owned()))
    })
    .await?
}

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

/// The profiles of every vault that is there.
#[tauri::command]
pub async fn list_ai_profiles(app: AppHandle) -> Result<Vec<AiProfile>, AppError> {
    run_blocking(move || ai_vault::list_all_profiles(&app)).await?
}

#[tauri::command]
pub async fn get_ai_profile(app: AppHandle, id: String) -> Result<AiProfile, AppError> {
    run_blocking(move || {
        let (vault_id, id) = ai_vault::split_ref(&id);
        ai_vault::with_vault(&app, vault_id, |dir| {
            Ok(ai_vault::profile_to_ref(
                vault_id,
                ai_vault::get_profile(dir, id)?,
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
) -> Result<(), AppError> {
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
        ai_vault::with_vault(&app, vault_id, |dir| {
            // Vault access is already held; do not acquire it recursively.
            storage::while_chats_locked_in_vault(&app, || {
                ai_vault::delete_profile(dir, &app.state::<ai_vault::MemoryReadVersions>(), id)
            })
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
pub async fn create_ai_project(app: AppHandle, project: AiProject) -> Result<(), AppError> {
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

/// Reads a profile memory file (`core.md` or a topic file).
#[tauri::command]
pub async fn read_ai_profile_memory(
    app: AppHandle,
    profile_id: String,
    file: String,
) -> Result<String, AppError> {
    run_blocking(move || {
        let (vault_id, profile_id) = ai_vault::split_ref(&profile_id);
        ai_vault::with_vault(&app, vault_id, |dir| {
            ai_vault::read_profile_memory(
                dir,
                &app.state::<ai_vault::MemoryReadVersions>(),
                profile_id,
                &file,
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
                &fact,
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

/// Completely rewrites a memory file (e.g. for compaction).
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
