use std::fs;
use std::path::Path;

use super::types::{AiProfile, AiProject};
use crate::errors::AppError;
use crate::models::{Chat, ChatSummary};
use crate::services::atomic_file::{create_private_dir, write_private};

pub const DEFAULT_SOUL_TEMPLATE: &str = "# System Prompt\nYou are a helpful AI assistant.\n";

pub fn validate_id(id: &str) -> Result<(), AppError> {
    if id.is_empty() {
        return Err(AppError::InvalidInput("ID cannot be empty".into()));
    }
    if id.len() > 64 {
        return Err(AppError::InvalidInput(
            "ID cannot exceed 64 characters".into(),
        ));
    }
    if id == "." || id == ".." {
        return Err(AppError::InvalidInput("Invalid ID".into()));
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AppError::InvalidInput(
            "ID may only contain alphanumeric characters, hyphens, and underscores".into(),
        ));
    }
    Ok(())
}

pub fn ensure_vault_dirs(vault_root: &Path) -> Result<(), AppError> {
    create_private_dir(vault_root)?;
    create_private_dir(&vault_root.join("profiles"))?;
    create_private_dir(&vault_root.join("projects"))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

pub fn list_profiles(vault_root: &Path) -> Result<Vec<AiProfile>, AppError> {
    ensure_vault_dirs(vault_root)?;
    let profiles_dir = vault_root.join("profiles");
    let mut profiles = Vec::new();

    for entry in fs::read_dir(&profiles_dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let profile_file = path.join("profile.json");
        if profile_file.is_file() {
            if let Ok(raw) = fs::read_to_string(&profile_file) {
                if let Ok(profile) = serde_json::from_str::<AiProfile>(&raw) {
                    profiles.push(profile);
                }
            }
        }
    }

    profiles.sort_by_key(|a| a.created_at);
    Ok(profiles)
}

pub fn save_profile(vault_root: &Path, profile: AiProfile) -> Result<(), AppError> {
    validate_id(&profile.id)?;
    ensure_vault_dirs(vault_root)?;

    let profile_dir = vault_root.join("profiles").join(&profile.id);
    create_private_dir(&profile_dir)?;
    create_private_dir(&profile_dir.join("history"))?;
    create_private_dir(&profile_dir.join("workspace"))?;
    create_private_dir(&profile_dir.join("workspace").join("uploads"))?;
    create_private_dir(&profile_dir.join("workspace").join("generated"))?;
    create_private_dir(&profile_dir.join("workspace").join("downloads"))?;

    let soul_file = profile_dir.join("SOUL.md");
    if !soul_file.exists() {
        write_private(&soul_file, DEFAULT_SOUL_TEMPLATE)?;
    }

    let profile_file = profile_dir.join("profile.json");
    let serialized = serde_json::to_string_pretty(&profile)?;
    write_private(&profile_file, &serialized)?;

    Ok(())
}

pub fn delete_profile(vault_root: &Path, id: &str) -> Result<(), AppError> {
    validate_id(id)?;
    let profile_dir = vault_root.join("profiles").join(id);
    if profile_dir.exists() {
        fs::remove_dir_all(&profile_dir)?;
    }
    Ok(())
}

pub fn read_profile_soul(vault_root: &Path, id: &str) -> Result<String, AppError> {
    validate_id(id)?;
    let soul_file = vault_root.join("profiles").join(id).join("SOUL.md");
    if soul_file.exists() {
        Ok(fs::read_to_string(soul_file)?)
    } else {
        Ok(DEFAULT_SOUL_TEMPLATE.to_string())
    }
}

pub fn write_profile_soul(vault_root: &Path, id: &str, content: &str) -> Result<(), AppError> {
    validate_id(id)?;
    let profile_dir = vault_root.join("profiles").join(id);
    create_private_dir(&profile_dir)?;
    let soul_file = profile_dir.join("SOUL.md");
    write_private(&soul_file, content)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

pub fn list_projects(vault_root: &Path) -> Result<Vec<AiProject>, AppError> {
    ensure_vault_dirs(vault_root)?;
    let projects_dir = vault_root.join("projects");
    let mut projects = Vec::new();

    for entry in fs::read_dir(&projects_dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let project_file = path.join("project.json");
        if project_file.is_file() {
            if let Ok(raw) = fs::read_to_string(&project_file) {
                if let Ok(project) = serde_json::from_str::<AiProject>(&raw) {
                    projects.push(project);
                }
            }
        }
    }

    projects.sort_by_key(|a| a.created_at);
    Ok(projects)
}

pub fn save_project(vault_root: &Path, project: AiProject) -> Result<(), AppError> {
    validate_id(&project.id)?;
    ensure_vault_dirs(vault_root)?;

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

    let project_dir = vault_root.join("projects").join(&project.id);
    create_private_dir(&project_dir)?;

    let project_file = project_dir.join("project.json");
    let serialized = serde_json::to_string_pretty(&project)?;
    write_private(&project_file, &serialized)?;

    Ok(())
}

pub fn delete_project(vault_root: &Path, id: &str) -> Result<(), AppError> {
    validate_id(id)?;
    let project_dir = vault_root.join("projects").join(id);
    if project_dir.exists() {
        fs::remove_dir_all(&project_dir)?;
    }

    // Clean up permissions in profiles referencing this project
    if let Ok(profiles) = list_profiles(vault_root) {
        for mut profile in profiles {
            if profile.project_permissions.remove(id).is_some() {
                let _ = save_profile(vault_root, profile);
            }
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Profile Chat History
// ---------------------------------------------------------------------------

fn get_history_dir(vault_root: &Path, profile_id: &str) -> Result<std::path::PathBuf, AppError> {
    validate_id(profile_id)?;
    let history_dir = vault_root.join("profiles").join(profile_id).join("history");
    create_private_dir(&history_dir)?;
    Ok(history_dir)
}

pub fn list_profile_chats(
    vault_root: &Path,
    profile_id: &str,
) -> Result<Vec<ChatSummary>, AppError> {
    let history_dir = get_history_dir(vault_root, profile_id)?;
    let index_file = history_dir.join("index.json");

    if index_file.is_file() {
        if let Ok(raw) = fs::read_to_string(&index_file) {
            if let Ok(summaries) = serde_json::from_str::<Vec<ChatSummary>>(&raw) {
                return Ok(summaries);
            }
        }
    }

    // Rebuild index from chat files if missing or corrupted
    let mut summaries = Vec::new();
    for entry in fs::read_dir(&history_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("json") {
            if path.file_name().and_then(|n| n.to_str()) == Some("index.json") {
                continue;
            }
            if let Ok(raw) = fs::read_to_string(&path) {
                if let Ok(chat) = serde_json::from_str::<Chat>(&raw) {
                    summaries.push(ChatSummary::from(&chat));
                }
            }
        }
    }

    summaries.sort_by(|a, b| b.last_message_at.cmp(&a.last_message_at));
    let _ = write_private(&index_file, &serde_json::to_string_pretty(&summaries)?);
    Ok(summaries)
}

pub fn get_profile_chat(
    vault_root: &Path,
    profile_id: &str,
    id: &str,
) -> Result<Option<Chat>, AppError> {
    validate_id(id)?;
    let history_dir = get_history_dir(vault_root, profile_id)?;
    let chat_file = history_dir.join(format!("{id}.json"));

    if !chat_file.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(chat_file)?;
    let chat = serde_json::from_str::<Chat>(&raw)?;
    Ok(Some(chat))
}

pub fn save_profile_chat(vault_root: &Path, profile_id: &str, chat: Chat) -> Result<(), AppError> {
    validate_id(&chat.id)?;
    let history_dir = get_history_dir(vault_root, profile_id)?;

    let chat_file = history_dir.join(format!("{}.json", chat.id));
    let serialized = serde_json::to_string_pretty(&chat)?;
    write_private(&chat_file, &serialized)?;

    let mut summaries = list_profile_chats(vault_root, profile_id)?;
    let new_summary = ChatSummary::from(&chat);
    summaries.retain(|s| s.id != new_summary.id);
    summaries.insert(0, new_summary);

    let index_file = history_dir.join("index.json");
    write_private(&index_file, &serde_json::to_string_pretty(&summaries)?)?;

    Ok(())
}

pub fn rename_profile_chat(
    vault_root: &Path,
    profile_id: &str,
    id: &str,
    title: &str,
) -> Result<(), AppError> {
    validate_id(id)?;
    let history_dir = get_history_dir(vault_root, profile_id)?;
    let chat_file = history_dir.join(format!("{id}.json"));

    if chat_file.exists() {
        let raw = fs::read_to_string(&chat_file)?;
        if let Ok(mut chat) = serde_json::from_str::<Chat>(&raw) {
            chat.title = title.to_string();
            write_private(&chat_file, &serde_json::to_string_pretty(&chat)?)?;
        }
    }

    let mut summaries = list_profile_chats(vault_root, profile_id)?;
    for summary in &mut summaries {
        if summary.id == id {
            summary.title = title.to_string();
        }
    }

    let index_file = history_dir.join("index.json");
    write_private(&index_file, &serde_json::to_string_pretty(&summaries)?)?;

    Ok(())
}

pub fn delete_profile_chat(vault_root: &Path, profile_id: &str, id: &str) -> Result<(), AppError> {
    validate_id(id)?;
    let history_dir = get_history_dir(vault_root, profile_id)?;
    let chat_file = history_dir.join(format!("{id}.json"));

    if chat_file.exists() {
        fs::remove_file(&chat_file)?;
    }

    let mut summaries = list_profile_chats(vault_root, profile_id)?;
    summaries.retain(|s| s.id != id);

    let index_file = history_dir.join("index.json");
    write_private(&index_file, &serde_json::to_string_pretty(&summaries)?)?;

    Ok(())
}

pub fn clear_profile_chats(vault_root: &Path, profile_id: &str) -> Result<(), AppError> {
    let history_dir = get_history_dir(vault_root, profile_id)?;
    if history_dir.exists() {
        fs::remove_dir_all(&history_dir)?;
        create_private_dir(&history_dir)?;
    }
    let index_file = history_dir.join("index.json");
    write_private(&index_file, "[]")?;
    Ok(())
}

pub fn search_profile_chats(
    vault_root: &Path,
    profile_id: &str,
    query: &str,
) -> Result<Vec<String>, AppError> {
    let summaries = list_profile_chats(vault_root, profile_id)?;
    let query_lower = query.trim().to_lowercase();
    if query_lower.is_empty() {
        return Ok(Vec::new());
    }

    let mut found = Vec::new();
    for item in summaries {
        let matches = match get_profile_chat(vault_root, profile_id, &item.id) {
            Ok(Some(chat)) => {
                chat.title.to_lowercase().contains(&query_lower)
                    || chat
                        .messages
                        .iter()
                        .any(|m| m.content.to_lowercase().contains(&query_lower))
            }
            _ => item.title.to_lowercase().contains(&query_lower),
        };
        if matches {
            found.push(item.id);
        }
    }
    Ok(found)
}
