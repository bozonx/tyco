use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

use super::operations::{existing_profile_dir, validate_id};
use super::types::{ProfileMemoryChange, ProfileMemorySearchResult, ProfileMemoryTopic};
use crate::errors::AppError;
use crate::locks::RwLockExt;
use crate::services::atomic_file::{create_private_dir, write_private};

pub const PROFILE_MEMORY_DIR: &str = "memory";
pub const MEMORY_TOPICS_DIR: &str = "topics";
pub const MEMORY_SNAPSHOTS_DIR: &str = ".snapshots";
pub const MEMORY_CORE_FILE: &str = "core.md";
pub const DEFAULT_MEMORY_CORE: &str =
    "# Ядро памяти\n\n## О пользователе\n\n## Постоянные правила\n";

pub const MAX_MEMORY_FACT_LEN: usize = 4_000;
pub const MAX_MEMORY_FILE_BYTES: usize = 64 * 1024;
pub const MAX_MEMORY_TOPIC_FILES: usize = 50;
pub const MAX_MEMORY_SEARCH_RESULTS: usize = 100;

/// The hash of each memory file as the AI last read it, per profile, so that
/// a write based on a stale read is refused. Managed by Tauri.
#[derive(Default)]
pub struct MemoryReadVersions(RwLock<HashMap<(String, String), String>>);

impl MemoryReadVersions {
    fn key(profile_id: &str, file: &str) -> (String, String) {
        (profile_id.to_owned(), file.to_owned())
    }

    fn record(&self, profile_id: &str, file: &str, content: &str) {
        self.0
            .write_locked()
            .insert(Self::key(profile_id, file), hash_content(content));
    }

    fn forget(&self, profile_id: &str, file: &str) {
        self.0.write_locked().remove(&Self::key(profile_id, file));
    }

    pub fn clear_profile(&self, profile_id: &str) {
        self.0
            .write_locked()
            .retain(|(profile, _), _| profile != profile_id);
    }

    /// Fails when the file on disk differs from the version last read.
    fn check(&self, profile_id: &str, file: &str, disk_content: &str) -> Result<(), AppError> {
        let versions = self.0.read_locked();
        match versions.get(&Self::key(profile_id, file)) {
            Some(last_hash) if *last_hash != hash_content(disk_content) => {
                Err(AppError::InvalidInput(
                    "The memory file was modified after it was read. Read it again before modifying.".into(),
                ))
            }
            _ => Ok(()),
        }
    }
}

/// Calculates a SHA-256 hash of the content for optimistic locking.
pub fn hash_content(content: &str) -> String {
    crate::services::sha256::sha256_hex(content.as_bytes())
}

/// Normalizes and validates a memory file name.
/// Valid inputs: `core.md`, `topics/foo.md`, `foo.md`.
/// Rules:
/// - Ends with `.md`
/// - Base stem only contains `[a-z0-9_-]`
/// - No nested directories or path traversal
pub fn normalize_and_validate_memory_file(file: &str) -> Result<String, AppError> {
    let trimmed = file.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidInput(
            "Memory file name cannot be empty".into(),
        ));
    }
    if trimmed.contains("..") || trimmed.contains('\\') {
        return Err(AppError::InvalidInput("Invalid memory file path".into()));
    }
    let normalized = trimmed.strip_prefix("topics/").unwrap_or(trimmed);
    if normalized.contains('/') {
        return Err(AppError::InvalidInput(
            "Nested directories in memory are not allowed".into(),
        ));
    }
    if !normalized.ends_with(".md") {
        return Err(AppError::InvalidInput(
            "Memory file name must end with .md".into(),
        ));
    }
    let stem = &normalized[..normalized.len() - 3];
    if stem.is_empty() {
        return Err(AppError::InvalidInput(
            "Memory file name cannot be empty".into(),
        ));
    }
    if !stem
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
    {
        return Err(AppError::InvalidInput(
            "Memory file name must contain only lowercase alphanumeric characters, hyphens, and underscores".into(),
        ));
    }
    Ok(normalized.to_string())
}

/// Returns the file path within the profile's memory directory.
pub fn memory_file_path(memory_dir: &Path, normalized_file: &str) -> PathBuf {
    if normalized_file == MEMORY_CORE_FILE {
        memory_dir.join(MEMORY_CORE_FILE)
    } else {
        memory_dir.join(MEMORY_TOPICS_DIR).join(normalized_file)
    }
}

/// Initializes `memory/`, `memory/topics/`, and `memory/core.md` if they do not exist.
pub fn ensure_memory_dir_initialized(memory_dir: &Path) -> Result<(), AppError> {
    create_private_dir(memory_dir)?;
    create_private_dir(&memory_dir.join(MEMORY_TOPICS_DIR))?;
    let core_file = memory_dir.join(MEMORY_CORE_FILE);
    if !core_file.exists() {
        write_private(&core_file, DEFAULT_MEMORY_CORE)?;
    }
    Ok(())
}

/// Returns the profile's memory directory, creating it lazily if needed.
pub fn profile_memory_dir(vault_root: &Path, id: &str) -> Result<PathBuf, AppError> {
    let dir = existing_profile_dir(vault_root, id)?.join(PROFILE_MEMORY_DIR);
    ensure_memory_dir_initialized(&dir)?;
    Ok(dir)
}

fn safe_chat_key(chat_id: Option<&str>) -> String {
    match chat_id.map(str::trim).filter(|s| !s.is_empty()) {
        Some(id)
            if id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') =>
        {
            id.to_string()
        }
        Some(id) => hash_content(id),
        None => "_default".to_string(),
    }
}

fn count_topic_files(memory_dir: &Path) -> Result<usize, AppError> {
    let topics_dir = memory_dir.join(MEMORY_TOPICS_DIR);
    if !topics_dir.is_dir() {
        return Ok(0);
    }
    let mut count = 0;
    for entry in fs::read_dir(topics_dir)? {
        let path = entry?.path();
        if path.is_file() && path.extension().is_some_and(|ext| ext == "md") {
            count += 1;
        }
    }
    Ok(count)
}

fn format_stem_to_title(stem: &str) -> String {
    let mut result = String::new();
    let mut capitalize_next = true;
    for c in stem.chars() {
        if c == '_' || c == '-' {
            result.push(' ');
            capitalize_next = true;
        } else if capitalize_next {
            result.extend(c.to_uppercase());
            capitalize_next = false;
        } else {
            result.push(c);
        }
    }
    result
}

fn parse_topic_metadata(content: &str, fallback_name: &str) -> (String, Option<String>) {
    let mut lines = content.lines().map(str::trim).filter(|l| !l.is_empty());
    let title = lines
        .next()
        .map(|line| {
            line.strip_prefix('#')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or(line)
                .to_string()
        })
        .unwrap_or_else(|| fallback_name.to_string());

    let description = lines.next().and_then(|line| {
        if line.starts_with('#') || line.starts_with('-') || line.starts_with('*') {
            None
        } else {
            Some(line.to_string())
        }
    });

    (title, description)
}

fn save_snapshot_if_needed(
    memory_dir: &Path,
    chat_id: Option<&str>,
    normalized_file: &str,
    target_path: &Path,
) -> Result<(), AppError> {
    let chat_key = safe_chat_key(chat_id);
    let snapshot_dir = memory_dir.join(MEMORY_SNAPSHOTS_DIR).join(chat_key);
    create_private_dir(&memory_dir.join(MEMORY_SNAPSHOTS_DIR))?;
    create_private_dir(&snapshot_dir)?;

    let snapshot_file = snapshot_dir.join(format!("{normalized_file}.snapshot"));
    let absent_file = snapshot_dir.join(format!("{normalized_file}.absent"));

    // Save snapshot only once per file within a chat
    if !snapshot_file.exists() && !absent_file.exists() {
        if target_path.exists() {
            let content = fs::read_to_string(target_path)?;
            write_private(&snapshot_file, &content)?;
        } else {
            write_private(&absent_file, "")?;
        }
    }
    Ok(())
}

/// Reads a memory file (`core.md` or topic file) and records its version for optimistic locking.
pub fn read_profile_memory(
    vault_root: &Path,
    versions: &MemoryReadVersions,
    profile_id: &str,
    file: &str,
) -> Result<String, AppError> {
    validate_id(profile_id)?;
    let normalized = normalize_and_validate_memory_file(file)?;
    let memory_dir = profile_memory_dir(vault_root, profile_id)?;
    let target_path = memory_file_path(&memory_dir, &normalized);

    if !target_path.is_file() {
        return Err(AppError::NotFound(format!(
            "Memory file not found: {normalized}"
        )));
    }

    let content = fs::read_to_string(&target_path)?;
    versions.record(profile_id, &normalized, &content);
    Ok(content)
}

/// Appends a single fact/thesis to a memory file.
/// If a topic file does not exist, it is created.
pub fn add_profile_memory_fact(
    vault_root: &Path,
    versions: &MemoryReadVersions,
    profile_id: &str,
    chat_id: Option<&str>,
    file: &str,
    fact: &str,
) -> Result<ProfileMemoryChange, AppError> {
    validate_id(profile_id)?;
    let normalized = normalize_and_validate_memory_file(file)?;
    let fact_trimmed = fact.trim();
    if fact_trimmed.is_empty() {
        return Err(AppError::InvalidInput("Memory fact cannot be empty".into()));
    }
    if fact_trimmed.len() > MAX_MEMORY_FACT_LEN {
        return Err(AppError::InvalidInput(format!(
            "Memory fact exceeds maximum allowed length of {MAX_MEMORY_FACT_LEN} characters"
        )));
    }

    let memory_dir = profile_memory_dir(vault_root, profile_id)?;
    let target_path = memory_file_path(&memory_dir, &normalized);

    let (before, after) = if target_path.exists() {
        let existing = fs::read_to_string(&target_path)?;
        versions.check(profile_id, &normalized, &existing)?;
        save_snapshot_if_needed(&memory_dir, chat_id, &normalized, &target_path)?;

        let mut next = existing.clone();
        if !next.is_empty() && !next.ends_with('\n') {
            next.push('\n');
        }
        if fact_trimmed.starts_with('-') || fact_trimmed.starts_with('*') {
            next.push_str(fact_trimmed);
        } else {
            next.push_str("- ");
            next.push_str(fact_trimmed);
        }
        next.push('\n');

        (Some(existing), next)
    } else {
        if normalized != MEMORY_CORE_FILE {
            let topic_count = count_topic_files(&memory_dir)?;
            if topic_count >= MAX_MEMORY_TOPIC_FILES {
                return Err(AppError::ResourceLimit(format!(
                    "Maximum number of topic files ({MAX_MEMORY_TOPIC_FILES}) reached"
                )));
            }
        }
        save_snapshot_if_needed(&memory_dir, chat_id, &normalized, &target_path)?;
        let stem = &normalized[..normalized.len() - 3];
        let title = format_stem_to_title(stem);
        let mut next = format!("# {title}\n\n");
        if fact_trimmed.starts_with('-') || fact_trimmed.starts_with('*') {
            next.push_str(fact_trimmed);
        } else {
            next.push_str("- ");
            next.push_str(fact_trimmed);
        }
        next.push('\n');

        (None, next)
    };

    if after.len() > MAX_MEMORY_FILE_BYTES {
        return Err(AppError::ResourceLimit(format!(
            "Memory file exceeds maximum allowed size of {MAX_MEMORY_FILE_BYTES} bytes"
        )));
    }

    write_private(&target_path, &after)?;
    versions.record(profile_id, &normalized, &after);

    Ok(ProfileMemoryChange {
        file: normalized,
        before,
        after,
    })
}

fn apply_memory_replace(text: &str, old_text: &str, new_text: &str) -> Result<String, AppError> {
    if old_text.is_empty() {
        return Err(AppError::InvalidInput(
            "The old text to replace cannot be empty".into(),
        ));
    }
    let (old_text_clean, new_text_clean) =
        if !text.contains(old_text) && text.contains("\r\n") && !old_text.contains("\r\n") {
            (
                old_text.replace('\n', "\r\n"),
                new_text.replace('\n', "\r\n"),
            )
        } else {
            (old_text.to_string(), new_text.to_string())
        };

    // If new_text is empty, we are deleting.
    if new_text_clean.is_empty() {
        let with_newline = format!("{old_text_clean}\n");
        let count_with_nl = text.matches(&with_newline).count();
        if count_with_nl == 1 {
            return Ok(text.replacen(&with_newline, "", 1));
        }
        let with_crlf = format!("{old_text_clean}\r\n");
        let count_with_crlf = text.matches(&with_crlf).count();
        if count_with_crlf == 1 {
            return Ok(text.replacen(&with_crlf, "", 1));
        }
    }

    let count = text.matches(&old_text_clean).count();
    match count {
        0 => Err(AppError::InvalidInput(
            "The old text was not found in the file. Read it again and copy the exact text.".into(),
        )),
        1 => Ok(text.replacen(&old_text_clean, &new_text_clean, 1)),
        _ => Err(AppError::InvalidInput(format!(
            "The old text was found {count} times. Provide unique text to replace."
        ))),
    }
}

/// Replaces an outdated fact or thesis with a new one.
/// If `new_text` is empty, deletes the thesis.
pub fn replace_profile_memory(
    vault_root: &Path,
    versions: &MemoryReadVersions,
    profile_id: &str,
    chat_id: Option<&str>,
    file: &str,
    old_text: &str,
    new_text: &str,
) -> Result<ProfileMemoryChange, AppError> {
    validate_id(profile_id)?;
    let normalized = normalize_and_validate_memory_file(file)?;
    if new_text.len() > MAX_MEMORY_FACT_LEN {
        return Err(AppError::InvalidInput(format!(
            "Replacement text exceeds maximum allowed length of {MAX_MEMORY_FACT_LEN} characters"
        )));
    }

    let memory_dir = profile_memory_dir(vault_root, profile_id)?;
    let target_path = memory_file_path(&memory_dir, &normalized);

    if !target_path.is_file() {
        return Err(AppError::NotFound(format!(
            "Memory file not found: {normalized}"
        )));
    }

    let before = fs::read_to_string(&target_path)?;
    versions.check(profile_id, &normalized, &before)?;

    let after = apply_memory_replace(&before, old_text, new_text)?;
    if after.len() > MAX_MEMORY_FILE_BYTES {
        return Err(AppError::ResourceLimit(format!(
            "Memory file exceeds maximum allowed size of {MAX_MEMORY_FILE_BYTES} bytes"
        )));
    }

    save_snapshot_if_needed(&memory_dir, chat_id, &normalized, &target_path)?;
    write_private(&target_path, &after)?;
    versions.record(profile_id, &normalized, &after);

    Ok(ProfileMemoryChange {
        file: normalized,
        before: Some(before),
        after,
    })
}

/// Completely rewrites a memory file (e.g. for compaction).
pub fn rewrite_profile_memory(
    vault_root: &Path,
    versions: &MemoryReadVersions,
    profile_id: &str,
    chat_id: Option<&str>,
    file: &str,
    content: &str,
) -> Result<ProfileMemoryChange, AppError> {
    validate_id(profile_id)?;
    let normalized = normalize_and_validate_memory_file(file)?;
    if content.len() > MAX_MEMORY_FILE_BYTES {
        return Err(AppError::ResourceLimit(format!(
            "Memory file exceeds maximum allowed size of {MAX_MEMORY_FILE_BYTES} bytes"
        )));
    }

    let memory_dir = profile_memory_dir(vault_root, profile_id)?;
    let target_path = memory_file_path(&memory_dir, &normalized);

    let before = if target_path.exists() {
        let existing = fs::read_to_string(&target_path)?;
        versions.check(profile_id, &normalized, &existing)?;
        save_snapshot_if_needed(&memory_dir, chat_id, &normalized, &target_path)?;
        Some(existing)
    } else {
        if normalized != MEMORY_CORE_FILE {
            let topic_count = count_topic_files(&memory_dir)?;
            if topic_count >= MAX_MEMORY_TOPIC_FILES {
                return Err(AppError::ResourceLimit(format!(
                    "Maximum number of topic files ({MAX_MEMORY_TOPIC_FILES}) reached"
                )));
            }
        }
        save_snapshot_if_needed(&memory_dir, chat_id, &normalized, &target_path)?;
        None
    };

    write_private(&target_path, content)?;
    versions.record(profile_id, &normalized, content);

    Ok(ProfileMemoryChange {
        file: normalized,
        before,
        after: content.to_string(),
    })
}

/// Restores a memory file to its state prior to any modifications made during a chat.
pub fn undo_profile_memory(
    vault_root: &Path,
    versions: &MemoryReadVersions,
    profile_id: &str,
    chat_id: Option<&str>,
    file: &str,
) -> Result<ProfileMemoryChange, AppError> {
    validate_id(profile_id)?;
    let normalized = normalize_and_validate_memory_file(file)?;
    let memory_dir = profile_memory_dir(vault_root, profile_id)?;
    let target_path = memory_file_path(&memory_dir, &normalized);

    let chat_key = safe_chat_key(chat_id);
    let snapshot_dir = memory_dir.join(MEMORY_SNAPSHOTS_DIR).join(chat_key);
    let snapshot_file = snapshot_dir.join(format!("{normalized}.snapshot"));
    let absent_file = snapshot_dir.join(format!("{normalized}.absent"));

    if absent_file.exists() {
        let before = if target_path.exists() {
            let current = fs::read_to_string(&target_path)?;
            let _ = fs::remove_file(&target_path);
            Some(current)
        } else {
            None
        };
        let _ = fs::remove_file(&absent_file);
        versions.forget(profile_id, &normalized);
        return Ok(ProfileMemoryChange {
            file: normalized,
            before,
            after: String::new(),
        });
    }

    if snapshot_file.exists() {
        let before = if target_path.exists() {
            Some(fs::read_to_string(&target_path)?)
        } else {
            None
        };
        let restored = fs::read_to_string(&snapshot_file)?;
        write_private(&target_path, &restored)?;
        versions.record(profile_id, &normalized, &restored);
        let _ = fs::remove_file(&snapshot_file);
        return Ok(ProfileMemoryChange {
            file: normalized,
            before,
            after: restored,
        });
    }

    Err(AppError::NotFound(format!(
        "No undo snapshot found for {normalized}"
    )))
}

/// Searches all memory files (`core.md` and `topics/*.md`) for matching text lines.
pub fn search_profile_memory(
    vault_root: &Path,
    profile_id: &str,
    query: &str,
) -> Result<Vec<ProfileMemorySearchResult>, AppError> {
    validate_id(profile_id)?;
    let query_trimmed = query.trim();
    if query_trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let memory_dir = profile_memory_dir(vault_root, profile_id)?;
    let query_lower = query_trimmed.to_lowercase();
    let mut results = Vec::new();

    let mut files_to_search = Vec::new();
    let core_file = memory_dir.join(MEMORY_CORE_FILE);
    if core_file.is_file() {
        files_to_search.push((MEMORY_CORE_FILE.to_string(), core_file));
    }

    let topics_dir = memory_dir.join(MEMORY_TOPICS_DIR);
    if topics_dir.is_dir() {
        let mut topic_entries = Vec::new();
        for entry in fs::read_dir(topics_dir)? {
            let path = entry?.path();
            if path.is_file() && path.extension().is_some_and(|ext| ext == "md") {
                if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                    topic_entries.push((file_name.to_string(), path));
                }
            }
        }
        topic_entries.sort_by(|a, b| a.0.cmp(&b.0));
        files_to_search.extend(topic_entries);
    }

    'search_loop: for (file_name, path) in files_to_search {
        if let Ok(content) = fs::read_to_string(&path) {
            for (line_idx, line) in content.lines().enumerate() {
                if line.to_lowercase().contains(&query_lower) {
                    results.push(ProfileMemorySearchResult {
                        file: file_name.clone(),
                        line_number: line_idx + 1,
                        text: line.to_string(),
                    });
                    if results.len() >= MAX_MEMORY_SEARCH_RESULTS {
                        break 'search_loop;
                    }
                }
            }
        }
    }

    Ok(results)
}

/// Lists overview summaries of `core.md` and all topic files.
pub fn list_profile_memory_topics(
    vault_root: &Path,
    profile_id: &str,
) -> Result<Vec<ProfileMemoryTopic>, AppError> {
    validate_id(profile_id)?;
    let memory_dir = profile_memory_dir(vault_root, profile_id)?;
    let mut topics = Vec::new();

    let core_path = memory_dir.join(MEMORY_CORE_FILE);
    if core_path.is_file() {
        let meta = fs::metadata(&core_path)?;
        let content = fs::read_to_string(&core_path).unwrap_or_default();
        let (title, description) = parse_topic_metadata(&content, "Ядро памяти");
        let updated_at = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        topics.push(ProfileMemoryTopic {
            file: MEMORY_CORE_FILE.to_string(),
            title,
            description,
            bytes: meta.len(),
            updated_at,
        });
    }

    let topics_dir = memory_dir.join(MEMORY_TOPICS_DIR);
    if topics_dir.is_dir() {
        let mut topic_files = Vec::new();
        for entry in fs::read_dir(topics_dir)? {
            let path = entry?.path();
            if path.is_file() && path.extension().is_some_and(|ext| ext == "md") {
                if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                    topic_files.push((file_name.to_string(), path));
                }
            }
        }
        topic_files.sort_by(|a, b| a.0.cmp(&b.0));

        for (file_name, path) in topic_files {
            let meta = fs::metadata(&path)?;
            let content = fs::read_to_string(&path).unwrap_or_default();
            let stem = &file_name[..file_name.len() - 3];
            let fallback_title = format_stem_to_title(stem);
            let (title, description) = parse_topic_metadata(&content, &fallback_title);
            let updated_at = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            topics.push(ProfileMemoryTopic {
                file: file_name,
                title,
                description,
                bytes: meta.len(),
                updated_at,
            });
        }
    }

    Ok(topics)
}

/// Clears memory content for a profile: removes all topic files and snapshots,
/// resets `core.md` to default, and clears read version records.
pub fn clear_profile_memory(
    vault_root: &Path,
    versions: &MemoryReadVersions,
    profile_id: &str,
) -> Result<(), AppError> {
    validate_id(profile_id)?;
    let memory_dir = profile_memory_dir(vault_root, profile_id)?;
    let topics_dir = memory_dir.join(MEMORY_TOPICS_DIR);
    if topics_dir.is_dir() {
        fs::remove_dir_all(&topics_dir)?;
    }
    create_private_dir(&topics_dir)?;

    let snapshots_dir = memory_dir.join(MEMORY_SNAPSHOTS_DIR);
    if snapshots_dir.is_dir() {
        let _ = fs::remove_dir_all(&snapshots_dir);
    }

    write_private(&memory_dir.join(MEMORY_CORE_FILE), DEFAULT_MEMORY_CORE)?;
    versions.clear_profile(profile_id);
    Ok(())
}
