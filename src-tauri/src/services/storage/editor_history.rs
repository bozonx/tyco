mod entries;
mod policy;

use entries::{apply_editor_history_result, insert_restored_item, push_editor_history};
pub use policy::EditorHistoryPolicy;

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;
use tauri::AppHandle;

use super::json_files::{read_jsonl, remove_file_if_exists, write_jsonl};
use super::new_history_id;
use super::paths::app_data_dir;
use crate::errors::AppError;
use crate::models::{EditorHistoryEntry, EditorHistoryItem};
use crate::services::clock::now_ms;

const EDITOR_HISTORY_FILE: &str = "editor-history.jsonl";
pub(super) const DEFAULT_EDITOR_HISTORY_LIMIT: usize = 1000;

fn editor_history_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    Ok(app_data_dir(app)?.join(EDITOR_HISTORY_FILE))
}

fn remove_editor_history_files(path: &Path) -> Result<(), AppError> {
    remove_file_if_exists(path)?;
    if let Some(parent) = path.parent() {
        let prefix = format!("{EDITOR_HISTORY_FILE}.broken-");
        for entry in fs::read_dir(parent)? {
            let entry = entry?;
            if entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.starts_with(&prefix))
            {
                remove_file_if_exists(&entry.path())?;
            }
        }
    }
    Ok(())
}

fn read_file_records(path: &Path) -> Result<Vec<EditorHistoryItem>, AppError> {
    read_jsonl(path)
}

/// Where the editor history lives: its file, or the memory of the process.
enum EditorHistoryTarget<'a> {
    File(PathBuf),
    Memory(&'a mut Vec<EditorHistoryItem>),
}

impl EditorHistoryTarget<'_> {
    fn read(&self) -> Result<Vec<EditorHistoryItem>, AppError> {
        match self {
            Self::File(path) => read_file_records(path),
            Self::Memory(items) => Ok(items.to_vec()),
        }
    }

    /// An empty history leaves no file behind.
    fn write(&mut self, items: Vec<EditorHistoryItem>) -> Result<(), AppError> {
        match self {
            Self::File(path) if items.is_empty() => remove_editor_history_files(path),
            Self::File(path) => write_jsonl(path, &items),
            Self::Memory(memory) => {
                **memory = items;
                Ok(())
            }
        }
    }
}

/// The editor history as the settings let it be seen and changed.
struct EditorHistorySession<'a> {
    store: EditorHistoryTarget<'a>,
    policy: EditorHistoryPolicy,
    is_in_development: bool,
}

impl<'a> EditorHistorySession<'a> {
    /// `memory` holds the entries while the history is kept in memory only.
    fn open(
        app: &AppHandle,
        user_config: &Value,
        memory: &'a mut Vec<EditorHistoryItem>,
    ) -> Result<Self, AppError> {
        let policy = EditorHistoryPolicy::from_config(user_config);
        let store = if policy.is_memory_only {
            EditorHistoryTarget::Memory(memory)
        } else {
            EditorHistoryTarget::File(editor_history_path(app)?)
        };

        Ok(Self {
            store,
            policy,
            is_in_development: crate::models::user_config::is_in_development(user_config),
        })
    }

    fn load(&self) -> Result<Vec<EditorHistoryItem>, AppError> {
        if !self.is_in_development {
            return Ok(Vec::new());
        }
        let mut items = self.store.read()?;
        self.policy.enforce(&mut items, now_ms());
        Ok(items)
    }

    fn save(&mut self, items: Vec<EditorHistoryItem>) -> Result<(), AppError> {
        if !self.is_in_development {
            return Ok(());
        }
        self.store.write(items)
    }
}

pub fn read_editor_history(
    app: &AppHandle,
    user_config: &Value,
    memory: &mut Vec<EditorHistoryItem>,
) -> Result<Vec<EditorHistoryItem>, AppError> {
    EditorHistorySession::open(app, user_config, memory)?.load()
}

/// Adds an entry and returns its id, or `None` when nothing was stored: the
/// text is blank or the history is turned off
pub fn add_editor_history_item(
    app: &AppHandle,
    user_config: &Value,
    memory: &mut Vec<EditorHistoryItem>,
    entry: EditorHistoryEntry,
) -> Result<Option<String>, AppError> {
    save_editor_history_entry(
        &mut EditorHistorySession::open(app, user_config, memory)?,
        entry,
    )
}

fn save_editor_history_entry(
    history: &mut EditorHistorySession,
    mut entry: EditorHistoryEntry,
) -> Result<Option<String>, AppError> {
    let policy = history.policy;

    if !history.is_in_development || entry.text.trim().is_empty() || policy.max_entries == 0 {
        return Ok(None);
    }

    entry.text = policy.redact(entry.text);

    let mut items = history.load()?;
    let created_at_ms = now_ms();
    let item = EditorHistoryItem {
        id: new_history_id(created_at_ms),
        text: entry.text,
        kind: entry.kind,
        operation: entry.operation,
        created_at_ms,
        result: None,
        is_result_applied: false,
    };

    let id = push_editor_history(
        &mut items,
        item,
        entry.replace_id.as_deref(),
        policy.max_entries,
    );
    history.save(items)?;

    Ok(Some(id))
}

/// Attaches the AI result to the `Source` entry it was produced from.
pub fn set_editor_history_result(
    app: &AppHandle,
    user_config: &Value,
    memory: &mut Vec<EditorHistoryItem>,
    id: String,
    result: String,
) -> Result<(), AppError> {
    let mut history = EditorHistorySession::open(app, user_config, memory)?;
    let result = history.policy.redact(result);
    let mut items = history.load()?;

    if !apply_editor_history_result(&mut items, &id, result) {
        return Ok(());
    }

    history.save(items)
}

/// Puts a removed entry back where it was (undo of a removal).
pub fn restore_editor_history_item(
    app: &AppHandle,
    user_config: &Value,
    memory: &mut Vec<EditorHistoryItem>,
    mut item: EditorHistoryItem,
) -> Result<(), AppError> {
    let mut history = EditorHistorySession::open(app, user_config, memory)?;
    let policy = history.policy;

    if !history.is_in_development || policy.max_entries == 0 {
        return Ok(());
    }

    item.text = policy.redact(item.text);
    item.result = item.result.map(|result| policy.redact(result));

    let mut items = history.load()?;

    if insert_restored_item(&mut items, item, policy.max_entries) {
        history.save(items)?;
    }

    Ok(())
}

pub fn delete_editor_history_item(
    app: &AppHandle,
    user_config: &Value,
    memory: &mut Vec<EditorHistoryItem>,
    id: String,
) -> Result<(), AppError> {
    let mut history = EditorHistorySession::open(app, user_config, memory)?;
    let mut items = history.load()?;
    items.retain(|item| item.id != id);
    history.save(items)
}

/// Removes every entry, from the memory and from the disk, whichever of them
/// the settings use now.
pub fn clear_editor_history(
    app: &AppHandle,
    memory: &mut Vec<EditorHistoryItem>,
) -> Result<(), AppError> {
    memory.clear();
    remove_editor_history_files(&editor_history_path(app)?)
}

/// Applies the history settings to what is stored. At startup the
/// memory-only mode means that the history of the previous run is gone, also
/// when that run ended without a chance to clean up.
/// Brings the history file in line with `policy`: deletes it when the
/// history is off or kept in memory only, and drops expired entries otherwise.
pub(super) fn enforce_editor_history_policy(
    app: &AppHandle,
    policy: &EditorHistoryPolicy,
) -> Result<(), AppError> {
    let path = editor_history_path(app)?;
    if policy.is_memory_only || policy.max_entries == 0 {
        remove_editor_history_files(&path)?;
    } else {
        enforce_editor_history_file(&path, policy, now_ms())?;
    }
    Ok(())
}

fn enforce_editor_history_file(
    path: &Path,
    policy: &EditorHistoryPolicy,
    now_ms: u64,
) -> Result<(), AppError> {
    let stored = read_file_records(path)?;
    let mut items = stored.clone();
    policy.enforce(&mut items, now_ms);

    if items != stored {
        EditorHistoryTarget::File(path.to_path_buf()).write(items)?;
    }

    Ok(())
}

pub(super) struct HistoryCommit<T> {
    pub value: T,
    pub is_cleanup_pending: bool,
}

/// Configuration commits before irreversible cleanup. Mode changes are prepared
/// first, so a failed config write cannot discard either source of editor history.
pub(super) fn commit_history_settings<T>(
    app: &AppHandle,
    before: &EditorHistoryPolicy,
    after: &EditorHistoryPolicy,
    memory: &mut Vec<EditorHistoryItem>,
    commit: impl FnOnce() -> Result<T, AppError>,
) -> Result<HistoryCommit<T>, AppError> {
    commit_history_transition(&editor_history_path(app)?, before, after, memory, commit)
}

fn commit_history_transition<T>(
    path: &Path,
    before: &EditorHistoryPolicy,
    after: &EditorHistoryPolicy,
    memory: &mut Vec<EditorHistoryItem>,
    commit: impl FnOnce() -> Result<T, AppError>,
) -> Result<HistoryCommit<T>, AppError> {
    let to_memory = !before.is_memory_only && after.is_memory_only;
    let to_disk = before.is_memory_only && !after.is_memory_only && after.max_entries > 0;
    let prepared_memory = if to_memory {
        let mut items = read_file_records(path)?;
        after.enforce(&mut items, now_ms());
        Some(items)
    } else {
        None
    };
    let original_disk = if to_disk {
        match fs::read(path) {
            Ok(bytes) => Some(bytes),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(error.into()),
        }
    } else {
        None
    };
    // Persist a session-to-disk migration before publishing the disk policy.
    // Until config commits, the source remains in memory and is authoritative.
    let prepared = if to_disk {
        let mut items = memory.clone();
        after.enforce(&mut items, now_ms());
        write_jsonl(path, &items)
    } else {
        Ok(())
    };
    let result = prepared.and_then(|()| commit());
    let committed = match result {
        Ok(committed) => committed,
        Err(error) => {
            if to_disk {
                let rollback = match original_disk {
                    Some(bytes) => crate::services::atomic_file::write_private_bytes(path, &bytes),
                    None => remove_file_if_exists(path),
                };
                if let Err(rollback) = rollback {
                    return Err(AppError::Failed(format!(
                        "{error}; could not restore editor history: {rollback}"
                    )));
                }
            }
            return Err(error);
        }
    };
    let cleanup = if after.max_entries == 0 {
        memory.clear();
        remove_editor_history_files(path)
    } else if let Some(items) = prepared_memory {
        *memory = items;
        remove_editor_history_files(path)
    } else if to_disk {
        memory.clear();
        Ok(())
    } else if after.is_memory_only {
        remove_editor_history_files(path)
    } else {
        switch_editor_history_store(path, before, after, memory, now_ms())
    };
    let cleanup_failed = cleanup.is_err();
    if let Err(error) = cleanup {
        // The new policy remains committed. Subsequent saves and startup retry
        // cleanup; restoring old settings here would misrepresent deleted data.
        log::warn!("Settings committed; editor history cleanup will be retried: {error}");
    }
    Ok(HistoryCommit {
        value: committed,
        is_cleanup_pending: cleanup_failed,
    })
}

fn switch_editor_history_store(
    path: &Path,
    before: &EditorHistoryPolicy,
    after: &EditorHistoryPolicy,
    memory: &mut Vec<EditorHistoryItem>,
    now_ms: u64,
) -> Result<(), AppError> {
    let mut file = EditorHistoryTarget::File(path.to_path_buf());

    if after.is_memory_only != before.is_memory_only {
        // the entries move to where the history lives now
        let mut items = if after.is_memory_only {
            file.read()?
        } else {
            memory.clone()
        };
        after.enforce(&mut items, now_ms);

        if after.is_memory_only {
            remove_editor_history_files(path)?;
            *memory = items;
            return Ok(());
        }
        file.write(items)?;
        memory.clear();
        return Ok(());
    }

    let turned_off = after.max_entries == 0 && before.max_entries != 0;
    let sanitize_turned_on = after.should_redact_secrets && !before.should_redact_secrets;

    if turned_off || sanitize_turned_on {
        let mut store = if after.is_memory_only {
            EditorHistoryTarget::Memory(memory)
        } else {
            file
        };
        let mut items = store.read()?;
        after.enforce(&mut items, now_ms);
        store.write(items)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests;
