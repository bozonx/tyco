use tauri::AppHandle;

use super::run_blocking;
use crate::{
    errors::AppError,
    services::ai_vault::{
        self, relocation::VaultTarget, AiProfile, AiProject, ProfileMemoryChange,
        ProfileMemorySearchResult, ProfileMemoryTopic,
    },
    services::storage,
};

/// What the folder the vault may go to holds; `None` is the default folder.
#[tauri::command]
pub async fn inspect_ai_vault_target(
    app: AppHandle,
    path: Option<String>,
) -> Result<VaultTarget, AppError> {
    run_blocking(move || ai_vault::location::inspect(&app, path.as_deref())).await?
}

/// Points the vault at another folder, `None` for the default one. With
/// `move_data` the current vault moves there first; the folder must be empty.
/// Without it the folder must be empty or hold a vault already.
#[tauri::command]
pub async fn relocate_ai_vault(
    app: AppHandle,
    path: Option<String>,
    move_data: bool,
) -> Result<(), AppError> {
    run_blocking(move || ai_vault::location::relocate(&app, path.as_deref(), move_data)).await?
}

#[tauri::command]
pub async fn get_ai_vault_path(app: AppHandle) -> Result<String, AppError> {
    run_blocking(move || ai_vault::with_vault(&app, |dir| Ok(dir.to_string_lossy().into_owned())))
        .await?
}

/// Shows the vault, or one profile folder in it, in the file manager. The
/// path is built here: the webview never names a folder to open.
#[tauri::command]
pub async fn open_ai_vault_location(
    app: AppHandle,
    profile_id: Option<String>,
) -> Result<(), AppError> {
    run_blocking(move || {
        ai_vault::with_vault(&app, |dir| {
            let target = ai_vault::vault_dir_to_open(dir, profile_id.as_deref())?;
            crate::services::platform::open_dir(&target)
        })
    })
    .await?
}

#[tauri::command]
pub async fn list_ai_profiles(app: AppHandle) -> Result<Vec<AiProfile>, AppError> {
    run_blocking(move || ai_vault::with_vault(&app, ai_vault::list_profiles)).await?
}

#[tauri::command]
pub async fn get_ai_profile(app: AppHandle, id: String) -> Result<AiProfile, AppError> {
    run_blocking(move || ai_vault::with_vault(&app, |dir| ai_vault::get_profile(dir, &id))).await?
}

#[tauri::command]
pub async fn create_ai_profile(
    app: AppHandle,
    profile: AiProfile,
    soul: String,
) -> Result<(), AppError> {
    run_blocking(move || {
        ai_vault::with_vault(&app, |dir| ai_vault::create_profile(dir, profile, &soul))
    })
    .await?
}

#[tauri::command]
pub async fn save_ai_profile(app: AppHandle, profile: AiProfile) -> Result<(), AppError> {
    run_blocking(move || ai_vault::with_vault(&app, |dir| ai_vault::save_profile(dir, profile)))
        .await?
}

/// The profile goes with its chats, so no chat of it is being written meanwhile.
#[tauri::command]
pub async fn delete_ai_profile(app: AppHandle, id: String) -> Result<(), AppError> {
    run_blocking(move || {
        ai_vault::with_vault(&app, |dir| {
            // Vault access is already held; do not acquire it recursively.
            storage::while_chats_locked_in_vault(&app, || ai_vault::delete_profile(dir, &id))
        })
    })
    .await?
}

#[tauri::command]
pub async fn read_ai_profile_soul(app: AppHandle, id: String) -> Result<String, AppError> {
    run_blocking(move || ai_vault::with_vault(&app, |dir| ai_vault::read_profile_soul(dir, &id)))
        .await?
}

#[tauri::command]
pub async fn write_ai_profile_soul(
    app: AppHandle,
    id: String,
    content: String,
) -> Result<(), AppError> {
    run_blocking(move || {
        ai_vault::with_vault(&app, |dir| ai_vault::write_profile_soul(dir, &id, &content))
    })
    .await?
}

#[tauri::command]
pub async fn list_ai_projects(app: AppHandle) -> Result<Vec<AiProject>, AppError> {
    run_blocking(move || ai_vault::with_vault(&app, ai_vault::list_projects)).await?
}

#[tauri::command]
pub async fn create_ai_project(app: AppHandle, project: AiProject) -> Result<(), AppError> {
    run_blocking(move || ai_vault::with_vault(&app, |dir| ai_vault::create_project(dir, project)))
        .await?
}

#[tauri::command]
pub async fn save_ai_project(app: AppHandle, project: AiProject) -> Result<(), AppError> {
    run_blocking(move || ai_vault::with_vault(&app, |dir| ai_vault::save_project(dir, project)))
        .await?
}

#[tauri::command]
pub async fn delete_ai_project(app: AppHandle, id: String) -> Result<(), AppError> {
    run_blocking(move || ai_vault::with_vault(&app, |dir| ai_vault::delete_project(dir, &id)))
        .await?
}

/// Lists all memory topics and core summary for a profile.
#[tauri::command]
pub async fn list_ai_profile_memory_topics(
    app: AppHandle,
    profile_id: String,
) -> Result<Vec<ProfileMemoryTopic>, AppError> {
    run_blocking(move || {
        ai_vault::with_vault(&app, |dir| {
            ai_vault::list_profile_memory_topics(dir, &profile_id)
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
        ai_vault::with_vault(&app, |dir| {
            ai_vault::read_profile_memory(dir, &profile_id, &file)
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
        ai_vault::with_vault(&app, |dir| {
            ai_vault::search_profile_memory(dir, &profile_id, &query)
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
        ai_vault::with_vault(&app, |dir| {
            ai_vault::add_profile_memory_fact(dir, &profile_id, chat_id.as_deref(), &file, &fact)
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
        ai_vault::with_vault(&app, |dir| {
            ai_vault::replace_profile_memory(
                dir,
                &profile_id,
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
        ai_vault::with_vault(&app, |dir| {
            ai_vault::rewrite_profile_memory(dir, &profile_id, chat_id.as_deref(), &file, &content)
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
        ai_vault::with_vault(&app, |dir| {
            ai_vault::undo_profile_memory(dir, &profile_id, chat_id.as_deref(), &file)
        })
    })
    .await?
}

/// Clears all memory topics and resets `core.md` to default for a profile.
#[tauri::command]
pub async fn clear_ai_profile_memory(app: AppHandle, profile_id: String) -> Result<(), AppError> {
    run_blocking(move || {
        ai_vault::with_vault(&app, |dir| ai_vault::clear_profile_memory(dir, &profile_id))
    })
    .await?
}
