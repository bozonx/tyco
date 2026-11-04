mod entries;
mod journals;
mod policy;

use entries::{apply_editor_history_result, insert_restored_item, push_editor_history};
use journals::{changes, compact, merge_journals, HistoryRecord};
pub use policy::EditorHistoryPolicy;

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;
use tauri::{AppHandle, Manager};

use super::json_files::{read_jsonl, remove_file_if_exists, write_jsonl};
use super::new_history_id;
use crate::errors::AppError;
use crate::models::{EditorHistoryEntry, EditorHistoryItem};
use crate::services::clock::now_ms;

pub(super) const DEFAULT_EDITOR_HISTORY_LIMIT: usize = 1000;
/// The folder of the device journals in the user data folder.
const SHARED_JOURNALS_DIR: &str = "history/editor";
/// The journal of this device when its history stays on it, in the state
/// folder: named apart from the device id, which may change (see
/// `device::ensure_identity`) without the local history being lost.
const LOCAL_JOURNAL: &str = "history/editor/local.jsonl";

/// Where the journals of the editor history are.
#[derive(Clone, Debug)]
pub(super) struct HistoryLocation {
    /// The journals of every device; an error while the user data folder
    /// cannot be used.
    shared_dir: Result<PathBuf, String>,
    local_path: PathBuf,
    device_id: String,
}

impl HistoryLocation {
    pub(super) fn of_app(app: &AppHandle) -> Result<Self, AppError> {
        let shared_dir = super::user_data::user_dir_for(app, super::UserDirAccess::Read)
            .map(|dir| dir.join(SHARED_JOURNALS_DIR))
            .map_err(|error| error.to_string());
        let device_id = app
            .try_state::<super::device::DeviceStore>()
            .map(|device| device.device_id())
            .ok_or_else(|| AppError::ServiceUnavailable("The device is not known yet".into()))?;
        Ok(Self {
            shared_dir,
            local_path: super::paths::state_dir(app)?.join(LOCAL_JOURNAL),
            device_id,
        })
    }

    #[cfg(test)]
    pub(super) fn at(dir: &Path, device_id: &str) -> Self {
        Self {
            shared_dir: Ok(dir.join("user").join(SHARED_JOURNALS_DIR)),
            local_path: dir.join("state").join(LOCAL_JOURNAL),
            device_id: device_id.to_owned(),
        }
    }

    fn shared_dir(&self) -> Result<&Path, AppError> {
        self.shared_dir
            .as_deref()
            .map_err(|reason| AppError::UserDataUnavailable(reason.clone()))
    }

    /// The journal this device writes.
    fn own_path(&self, is_local_only: bool) -> Result<PathBuf, AppError> {
        if is_local_only {
            Ok(self.local_path.clone())
        } else {
            Ok(self.shared_dir()?.join(format!("{}.jsonl", self.device_id)))
        }
    }

    /// The journals of every device in a fixed order, this device's last:
    /// those of the user data folder, when it can be read, and the local one.
    fn journal_paths(&self, own: &Path) -> Vec<PathBuf> {
        let mut paths: Vec<PathBuf> = match &self.shared_dir {
            Ok(dir) => super::user_files::list_own_files(dir, |name| {
                name.strip_suffix(".jsonl")
                    .is_some_and(super::device::is_device_id)
            })
            .unwrap_or_else(|error| {
                log::warn!("Could not list the editor history journals: {error}");
                Vec::new()
            })
            .into_iter()
            .map(|(_, path)| path)
            .collect(),
            Err(_) => Vec::new(),
        };
        if !paths.contains(&self.local_path) {
            paths.push(self.local_path.clone());
        }
        paths.retain(|path| path != own);
        paths.push(own.to_path_buf());
        paths
    }
}

fn read_records(path: &Path) -> Result<Vec<HistoryRecord>, AppError> {
    read_jsonl(path)
}

/// An emptied journal leaves no file behind.
fn write_records(path: &Path, records: &[HistoryRecord]) -> Result<(), AppError> {
    if records.is_empty() {
        return remove_file_if_exists(path);
    }
    if let Some(dir) = path.parent() {
        crate::services::atomic_file::create_private_dir(dir)?;
    }
    write_jsonl(path, records)
}

fn append_records(path: &Path, records: Vec<HistoryRecord>) -> Result<(), AppError> {
    if records.is_empty() {
        return Ok(());
    }
    let mut stored = read_records(path)?;
    // A checkpoint replaces its prior text, including in the own journal:
    // a long dictation must not retain a full copy for every ten seconds.
    stored.retain(|known| {
        !records.iter().any(|next| match (known, next) {
            (HistoryRecord::Item(known), HistoryRecord::Item(next)) => {
                known.id == next.id && known.created_at_ms <= next.created_at_ms
            }
            _ => false,
        })
    });
    stored.extend(records);
    write_records(path, &stored)
}

/// Removes a journal of this device and the copies kept of its damage.
fn remove_journal(path: &Path) -> Result<(), AppError> {
    remove_file_if_exists(path)?;
    crate::services::atomic_file::remove_broken_copies(path)
}

/// The journals of `paths`, a journal that cannot be read left out: one
/// device's broken file must not hide the history of the others.
fn read_journals(paths: &[PathBuf], own: &Path) -> Result<Vec<Vec<HistoryRecord>>, AppError> {
    let mut journals = Vec::with_capacity(paths.len());
    for path in paths {
        match read_records(path) {
            Ok(records) => journals.push(records),
            // this device's own journal must be readable, or a write would
            // lose what it holds
            Err(error) if path == own => return Err(error),
            Err(error) => log::warn!(
                "Skipping the editor history journal {}: {error}",
                path.display()
            ),
        }
    }
    Ok(journals)
}

/// Where the editor history lives: the journals, or the memory of the process.
enum EditorHistoryTarget<'a> {
    Journals {
        location: HistoryLocation,
        own: PathBuf,
    },
    Memory(&'a mut Vec<EditorHistoryItem>),
}

impl EditorHistoryTarget<'_> {
    fn read(&self) -> Result<Vec<EditorHistoryItem>, AppError> {
        match self {
            Self::Journals { location, own } => {
                let paths = location.journal_paths(own);
                Ok(merge_journals(&read_journals(&paths, own)?))
            }
            Self::Memory(items) => Ok(items.to_vec()),
        }
    }

    /// Turns the entries `before`, as read, into `after`: the journals take
    /// the records of the change, the memory the entries themselves.
    fn write(
        &mut self,
        before: &[EditorHistoryItem],
        after: Vec<EditorHistoryItem>,
    ) -> Result<(), AppError> {
        match self {
            Self::Journals { own, .. } => append_records(own, changes(before, &after, now_ms())),
            Self::Memory(memory) => {
                **memory = after;
                Ok(())
            }
        }
    }

    fn is_memory(&self) -> bool {
        matches!(self, Self::Memory(_))
    }
}

/// Whether the entries are in the memory of the process: in the memory-only
/// mode, and after that mode was turned off, while the memory still holds
/// what it kept. Turning the history off records nothing new and removes
/// nothing.
fn is_in_memory(policy: &EditorHistoryPolicy, memory: &[EditorHistoryItem]) -> bool {
    policy.is_memory_only || (!policy.is_recording && !memory.is_empty())
}

/// The editor history as the settings let it be seen and changed.
struct EditorHistorySession<'a> {
    store: EditorHistoryTarget<'a>,
    policy: EditorHistoryPolicy,
}

impl<'a> EditorHistorySession<'a> {
    /// `memory` holds the entries while the history is kept in memory only.
    fn open(
        location: HistoryLocation,
        user_config: &Value,
        memory: &'a mut Vec<EditorHistoryItem>,
    ) -> Result<Self, AppError> {
        let policy = EditorHistoryPolicy::from_config(user_config);
        let store = if is_in_memory(&policy, memory) {
            EditorHistoryTarget::Memory(memory)
        } else {
            let own = location.own_path(policy.is_local_only)?;
            EditorHistoryTarget::Journals { location, own }
        };

        Ok(Self { store, policy })
    }

    fn load(&self) -> Result<Vec<EditorHistoryItem>, AppError> {
        let mut items = self.store.read()?;
        self.policy.enforce(&mut items, now_ms());
        Ok(items)
    }

    fn save(
        &mut self,
        before: &[EditorHistoryItem],
        after: Vec<EditorHistoryItem>,
    ) -> Result<(), AppError> {
        self.store.write(before, after)
    }

    /// The limit an operation applies itself: the memory keeps at most the
    /// limit, while the journals keep everything a device wrote and the
    /// limit applies when they are read, so that a change never deletes an
    /// entry of another device for being over it.
    fn limit(&self) -> usize {
        if self.store.is_memory() {
            self.policy.max_entries
        } else {
            usize::MAX
        }
    }
}

pub fn read_editor_history(
    app: &AppHandle,
    user_config: &Value,
    memory: &mut Vec<EditorHistoryItem>,
) -> Result<Vec<EditorHistoryItem>, AppError> {
    EditorHistorySession::open(HistoryLocation::of_app(app)?, user_config, memory)?.load()
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
        &mut EditorHistorySession::open(HistoryLocation::of_app(app)?, user_config, memory)?,
        entry,
    )
}

fn save_editor_history_entry(
    history: &mut EditorHistorySession,
    mut entry: EditorHistoryEntry,
) -> Result<Option<String>, AppError> {
    let policy = history.policy;

    // Intentional: with the history turned off the user chose not to keep
    // their input, so nothing is stored here or anywhere else. The history is
    // the only store of user input; there is no fallback draft storage.
    if !policy.is_recording || entry.text.trim().is_empty() || policy.max_entries == 0 {
        return Ok(None);
    }

    entry.text = policy.redact(entry.text);
    if let Some(instruction) = &mut entry.instruction {
        instruction.text = policy.redact(instruction.text.clone());
    }

    let before = history.load()?;
    let mut items = before.clone();
    let created_at_ms = now_ms();
    let id = match entry.id {
        Some(id) => {
            // A live input may update its own unfinished record, never an AI
            // source or an output that has already been finalized.
            if items
                .iter()
                .any(|item| item.id == id && item.kind != crate::models::EditorHistoryKind::Draft)
            {
                return Ok(Some(id));
            }
            // Explicit deletion/clearing wins over an in-flight checkpoint.
            if !items.iter().any(|item| item.id == id) {
                return Ok(None);
            }
            items.retain(|item| item.id != id);
            id
        }
        None => new_history_id(created_at_ms),
    };
    let is_checkpoint = entry.kind == crate::models::EditorHistoryKind::Draft;
    let item = EditorHistoryItem {
        id,
        text: entry.text,
        kind: entry.kind,
        operation: entry.operation,
        origin: entry.origin,
        instruction: entry.instruction,
        created_at_ms,
        result: None,
        is_result_applied: false,
    };

    let id = if is_checkpoint {
        let id = item.id.clone();
        items.insert(0, item);
        items.truncate(history.limit());
        id
    } else {
        push_editor_history(&mut items, item, history.limit())
    };
    history.save(&before, items)?;

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
    let mut history =
        EditorHistorySession::open(HistoryLocation::of_app(app)?, user_config, memory)?;
    let result = history.policy.redact(result);
    let before = history.load()?;
    let mut items = before.clone();

    if !apply_editor_history_result(&mut items, &id, result) {
        return Ok(());
    }

    history.save(&before, items)
}

/// Puts a removed entry back where it was (undo of a removal).
pub fn restore_editor_history_item(
    app: &AppHandle,
    user_config: &Value,
    memory: &mut Vec<EditorHistoryItem>,
    item: EditorHistoryItem,
) -> Result<(), AppError> {
    restore_item(
        &mut EditorHistorySession::open(HistoryLocation::of_app(app)?, user_config, memory)?,
        item,
    )
}

fn restore_item(
    history: &mut EditorHistorySession,
    mut item: EditorHistoryItem,
) -> Result<(), AppError> {
    validate_restored_item(&mut item, now_ms())?;
    let policy = history.policy;

    // an undo puts back what the user removed, also while nothing new is
    // recorded
    if policy.max_entries == 0 {
        return Ok(());
    }

    item.text = policy.redact(item.text);
    item.result = item.result.map(|result| policy.redact(result));
    // a journal keeps the removal of the old id for good: the entry comes
    // back under a new one
    if !history.store.is_memory() {
        item.id = new_history_id(now_ms());
    }

    let before = history.load()?;
    let mut items = before.clone();

    if insert_restored_item(&mut items, item, history.limit()) {
        history.save(&before, items)?;
    }

    Ok(())
}

/// The webview hands the removed item back: its id must be one the backend
/// could have given, and its time cannot lie ahead, or it would stay on top.
fn validate_restored_item(item: &mut EditorHistoryItem, now_ms: u64) -> Result<(), AppError> {
    let is_valid_id = !item.id.is_empty()
        && item.id.len() <= MAX_HISTORY_ID_LENGTH
        && item
            .id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-');
    if !is_valid_id {
        return Err(AppError::InvalidInput("Invalid editor history id".into()));
    }
    item.created_at_ms = item.created_at_ms.min(now_ms);
    Ok(())
}

/// Ids are two hexadecimal numbers joined by a dash, see `new_history_id`.
const MAX_HISTORY_ID_LENGTH: usize = 64;

pub fn delete_editor_history_item(
    app: &AppHandle,
    user_config: &Value,
    memory: &mut Vec<EditorHistoryItem>,
    id: String,
) -> Result<(), AppError> {
    let mut history =
        EditorHistorySession::open(HistoryLocation::of_app(app)?, user_config, memory)?;
    let before = history.load()?;
    let mut items = before.clone();
    items.retain(|item| item.id != id);
    history.save(&before, items)
}

/// Removes every entry, from the memory and from the journals, those of the
/// other devices too: the clearing is a record of this device's journal,
/// which the others read.
pub fn clear_editor_history(
    app: &AppHandle,
    user_config: &Value,
    memory: &mut Vec<EditorHistoryItem>,
) -> Result<(), AppError> {
    clear_history(
        &HistoryLocation::of_app(app)?,
        &EditorHistoryPolicy::from_config(user_config),
        memory,
        now_ms(),
    )
}

fn clear_history(
    location: &HistoryLocation,
    policy: &EditorHistoryPolicy,
    memory: &mut Vec<EditorHistoryItem>,
    now_ms: u64,
) -> Result<(), AppError> {
    memory.clear();
    let own = location.own_path(policy.is_local_only)?;
    remove_journal(&own)?;
    write_records(
        &own,
        &[HistoryRecord::Event(journals::HistoryEvent::Clear {
            before: now_ms.saturating_add(1),
        })],
    )
}

/// Brings this device's journal in line with `policy`: removes it when the
/// history is kept in memory only, and drops expired entries and those over
/// the limit otherwise, also while the history is off. At startup the
/// memory-only mode means that the history of the previous run is gone, also
/// when that run ended without a chance to clean up.
pub(super) fn enforce_editor_history_policy(
    app: &AppHandle,
    policy: &EditorHistoryPolicy,
) -> Result<(), AppError> {
    enforce_policy(&HistoryLocation::of_app(app)?, policy, now_ms())
}

fn enforce_policy(
    location: &HistoryLocation,
    policy: &EditorHistoryPolicy,
    now_ms: u64,
) -> Result<(), AppError> {
    let own = location.own_path(policy.is_local_only)?;
    if policy.is_memory_only {
        remove_journal(&own)
    } else {
        compact_journal(location, &own, policy, now_ms)
    }
}

/// Rewrites this device's journal with what the policy keeps, see
/// `journals::compact`; the journals of other devices are only read.
fn compact_journal(
    location: &HistoryLocation,
    own: &Path,
    policy: &EditorHistoryPolicy,
    now_ms: u64,
) -> Result<(), AppError> {
    let stored = read_records(own)?;
    let paths = location.journal_paths(own);
    let others = read_journals(&paths[..paths.len() - 1], own)?;
    let kept = compact(
        &stored,
        &others,
        policy.cutoff_ms(now_ms),
        policy.max_entries,
        |item| policy.redact_item(item),
    );
    if kept != stored {
        write_records(own, &kept)?;
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
    commit_history_transition(
        &HistoryLocation::of_app(app)?,
        before,
        after,
        memory,
        commit,
    )
}

fn commit_history_transition<T>(
    location: &HistoryLocation,
    before: &EditorHistoryPolicy,
    after: &EditorHistoryPolicy,
    memory: &mut Vec<EditorHistoryItem>,
    commit: impl FnOnce() -> Result<T, AppError>,
) -> Result<HistoryCommit<T>, AppError> {
    // a history that is off or kept in memory needs no journal; one that
    // cannot be reached then must not hold up the settings
    let own_before = location.own_path(before.is_local_only);
    let own_after = location.own_path(after.is_local_only);
    let was_in_memory = is_in_memory(before, memory);
    // a history turned off stays where it was
    let stays_in_memory = after.is_memory_only || (!after.is_recording && was_in_memory);
    let to_memory = !was_in_memory && after.is_memory_only;
    let to_disk = was_in_memory && !stays_in_memory;
    // the own journal goes into or out of the user data folder
    let moves =
        !was_in_memory && !stays_in_memory && own_before.as_ref().ok() != own_after.as_ref().ok();
    let needs_journals = to_memory || to_disk || moves;
    let (own_before, own_after) = if needs_journals {
        (own_before?, own_after?)
    } else {
        (
            own_before.unwrap_or_default(),
            own_after.unwrap_or_default(),
        )
    };
    let prepared_memory = if to_memory {
        let paths = location.journal_paths(&own_before);
        let mut items = merge_journals(&read_journals(&paths, &own_before)?);
        after.enforce(&mut items, now_ms());
        Some(items)
    } else {
        None
    };
    let original_target = if to_disk || moves {
        match fs::read(&own_after) {
            Ok(bytes) => Some(bytes),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(error.into()),
        }
    } else {
        None
    };
    // Persist a session-to-disk migration, or the move of the journal,
    // before publishing the new policy. Until config commits, the source
    // remains where it was and is authoritative.
    let prepared = if to_disk {
        let mut items = memory.clone();
        after.enforce(&mut items, now_ms());
        write_records(
            &own_after,
            &items
                .into_iter()
                .rev()
                .map(HistoryRecord::Item)
                .collect::<Vec<_>>(),
        )
    } else if moves {
        read_records(&own_before).and_then(|records| append_records(&own_after, records))
    } else {
        Ok(())
    };
    let result = prepared.and_then(|()| commit());
    let committed = match result {
        Ok(committed) => committed,
        Err(error) => {
            if to_disk || moves {
                let rollback = match original_target {
                    Some(bytes) => {
                        crate::services::atomic_file::write_private_bytes(&own_after, &bytes)
                    }
                    None => remove_file_if_exists(&own_after),
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
    let cleanup = if let Some(items) = prepared_memory {
        *memory = items;
        remove_journal(&own_before)
    } else if to_disk {
        memory.clear();
        Ok(())
    } else if moves {
        remove_journal(&own_before)
            .and_then(|()| compact_journal(location, &own_after, after, now_ms()))
    } else if after.is_memory_only {
        remove_journal(&own_after)
    } else if stays_in_memory {
        after.enforce(memory, now_ms());
        Ok(())
    } else if before == after {
        Ok(())
    } else {
        // what the new policy no longer keeps goes at once, not with the next
        // write
        compact_journal(location, &own_after, after, now_ms())
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

#[cfg(test)]
mod tests;
