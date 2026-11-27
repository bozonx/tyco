//! The dialog history: one file per dialog session, `dialogs/<id>.json`, with
//! its audio recordings kept in `dialogs/recordings/<id>/`. The list of
//! dialogs is an index derived from those files and kept in the state folder,
//! rebuilt when files change by size or modification time.
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use super::json_files::{remove_file_if_exists, write_json};
use super::recordings::{self, RecordingDirs};
use super::DAY_MS;
use crate::errors::AppError;
use crate::locks::MutexExt;
use crate::models::user_config::{self, DialogHistoryConfig, HistoryStorage};
use crate::models::{Dialog, DialogSummary};
use crate::services::clock::now_ms;

/// The folders and files of the dialog history.
#[derive(Clone, Debug)]
pub struct DialogDirs {
    /// `dialogs/` of the user data folder.
    pub dialogs: PathBuf,
    /// `dialogs/recordings/` and active state recordings.
    pub recordings: RecordingDirs,
    /// The derived index in the state folder.
    pub index: PathBuf,
}

const INDEX_DIR: &str = "index";
const DIALOG_INDEX_FILE: &str = "dialogs-v1.json";

/// The dialog history folders of the application.
pub fn app_dialog_dirs(app: &AppHandle) -> Result<DialogDirs, AppError> {
    let index_dir = super::paths::state_sub_dir(app, INDEX_DIR)?;
    Ok(DialogDirs {
        dialogs: super::user_data::user_dir_for(app, super::UserDirAccess::Read)?.join("dialogs"),
        recordings: RecordingDirs::of_app(app)?,
        index: index_dir.join(DIALOG_INDEX_FILE),
    })
}

/// A dialog file as the index last saw it.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexedFile {
    name: String,
    size: u64,
    modified_ns: u128,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DialogIndex {
    files: Vec<IndexedFile>,
    dialogs: Vec<DialogSummary>,
}

fn dialog_files(dialogs_dir: &Path) -> Result<Vec<(IndexedFile, PathBuf)>, AppError> {
    let mut files = Vec::new();
    for (name, path) in super::user_files::list_own_files(dialogs_dir, |name| {
        dialog_file_id(Path::new(name)).is_some()
    })? {
        let metadata = match fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.into()),
        };
        let modified_ns = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map_or(0, |duration| duration.as_nanos());
        files.push((
            IndexedFile {
                name,
                size: metadata.len(),
                modified_ns,
            },
            path,
        ));
    }
    Ok(files)
}

fn read_index(path: &Path) -> Option<DialogIndex> {
    let raw = fs::read(path).ok()?;
    let index: DialogIndex = serde_json::from_slice(&raw).ok()?;
    (index.files.len() == index.dialogs.len()).then_some(index)
}

fn write_index(path: &Path, index: &DialogIndex) -> Result<(), AppError> {
    if let Some(dir) = path.parent() {
        crate::services::atomic_file::create_private_dir(dir)?;
    }
    write_json(path, index)
}

/// Newest first by start time, then last update, then id.
fn sorted(mut dialogs: Vec<DialogSummary>) -> Vec<DialogSummary> {
    dialogs.sort_by(|a, b| {
        b.started_at_ms
            .cmp(&a.started_at_ms)
            .then_with(|| b.updated_at_ms.cmp(&a.updated_at_ms))
            .then_with(|| a.id.cmp(&b.id))
    });
    dialogs
}

fn dialog_file_id(path: &Path) -> Option<&str> {
    let name = path.file_name()?.to_str()?;
    let id = name.strip_suffix(".json")?;
    recordings::validate_dialog_id(id).ok().map(|_| id)
}

fn dialog_path(dialogs_dir: &Path, id: &str) -> Result<PathBuf, AppError> {
    Ok(dialogs_dir.join(format!("{}.json", recordings::validate_dialog_id(id)?)))
}

fn validate_stored_dialog(path: &Path, dialog: &Dialog) -> Result<(), AppError> {
    recordings::validate_dialog_id(&dialog.id)?;
    if dialog_file_id(path) != Some(dialog.id.as_str()) {
        return Err(AppError::InvalidInput(
            "Dialog id does not match its filename".into(),
        ));
    }
    validate_dialog_recordings(dialog)
}

fn validate_dialog_recordings(dialog: &Dialog) -> Result<(), AppError> {
    for name in dialog
        .recording_files
        .iter()
        .chain(&dialog.incomplete_recording_files)
        .chain(
            dialog
                .session_breaks
                .iter()
                .filter_map(|item| item.recording_file.as_ref()),
        )
    {
        if !recordings::is_recording_name(name) {
            return Err(AppError::InvalidInput(
                "Invalid name of a call recording".into(),
            ));
        }
    }
    Ok(())
}

fn read_dialog_bytes(path: &Path) -> Result<Option<Vec<u8>>, AppError> {
    match fs::read(path) {
        Ok(raw) => Ok(Some(raw)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn parse_stored_dialog(path: &Path, raw: &[u8]) -> Result<Dialog, AppError> {
    let dialog: Dialog = serde_json::from_slice(raw)?;
    validate_stored_dialog(path, &dialog)?;
    Ok(dialog)
}

pub fn list_dialogs(dirs: &DialogDirs) -> Result<Vec<DialogSummary>, AppError> {
    let files = dialog_files(&dirs.dialogs)?;
    let stored = read_index(&dirs.index).unwrap_or_default();
    if stored.files.len() == files.len()
        && stored
            .files
            .iter()
            .zip(&files)
            .all(|(indexed, (file, _))| indexed == file)
    {
        return Ok(sorted(stored.dialogs));
    }
    let known: HashMap<&IndexedFile, &DialogSummary> =
        stored.files.iter().zip(&stored.dialogs).collect();
    let mut index = DialogIndex::default();
    for (file, path) in files {
        if let Some(summary) = known.get(&file) {
            index.dialogs.push((*summary).clone());
            index.files.push(file);
            continue;
        }
        let raw = match fs::read(&path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.into()),
        };
        match parse_stored_dialog(&path, &raw) {
            Ok(dialog) => {
                index.dialogs.push(DialogSummary::from(&dialog));
                index.files.push(file);
            }
            Err(error) => {
                log::warn!("Dialog file {} is unreadable: {error}", path.display());
                if super::user_data::ensure_write_allowed(&path).is_ok() {
                    crate::services::atomic_file::quarantine(&path)?;
                }
            }
        }
    }
    if let Err(error) = write_index(&dirs.index, &index) {
        log::warn!("Could not save the dialog index: {error}");
    }
    Ok(sorted(index.dialogs))
}

pub fn read_dialog(dialogs_dir: &Path, id: &str) -> Result<Option<Dialog>, AppError> {
    let path = dialog_path(dialogs_dir, id)?;
    let Some(raw) = read_dialog_bytes(&path)? else {
        return Ok(None);
    };
    parse_stored_dialog(&path, &raw).map(Some)
}

pub fn open_dialog(dirs: &DialogDirs, id: &str) -> Result<Option<Dialog>, AppError> {
    let path = dialog_path(&dirs.dialogs, id)?;
    let Some(raw) = read_dialog_bytes(&path)? else {
        return Ok(None);
    };
    match parse_stored_dialog(&path, &raw) {
        Ok(dialog) => Ok(Some(dialog)),
        Err(error) => {
            if super::user_data::ensure_write_allowed(&path).is_err() {
                return Err(error);
            }
            let copy = crate::services::atomic_file::quarantine(&path)?;
            log::warn!(
                "Dialog file {} is unreadable ({error}); moved it to {}",
                path.display(),
                copy.display()
            );
            Ok(None)
        }
    }
}

const MAX_DIALOG_TITLE_CHARS: usize = 120;

pub(super) fn clamp_dialog_title(title: &str) -> String {
    let title = title.trim();
    if title.chars().count() <= MAX_DIALOG_TITLE_CHARS {
        return title.to_string();
    }
    let head: String = title.chars().take(MAX_DIALOG_TITLE_CHARS - 1).collect();
    format!("{}…", head.trim_end())
}

pub(super) fn validate_dialog_title(title: &str) -> Result<String, AppError> {
    let title = title.trim();
    if title.chars().count() > MAX_DIALOG_TITLE_CHARS {
        return Err(AppError::InvalidInput("Dialog title is too long".into()));
    }
    Ok(title.to_string())
}

/// Saves `dialog` under its id and drops expired dialogs with their recordings.
pub fn save_dialog(
    dirs: &DialogDirs,
    policy: DialogHistoryPolicy,
    mut dialog: Dialog,
) -> Result<Vec<String>, AppError> {
    if policy.is_session {
        return Ok(Vec::new());
    }
    recordings::validate_dialog_id(&dialog.id)?;
    validate_dialog_recordings(&dialog)?;
    dialog.title = clamp_dialog_title(&dialog.title);

    crate::services::atomic_file::create_private_dir(&dirs.dialogs)?;
    let path = dialog_path(&dirs.dialogs, &dialog.id)?;
    let mut history = list_dialogs(dirs)?;

    let mut removed = policy.drop_expired(&mut history, now_ms());
    removed.retain(|id| *id != dialog.id);

    write_json(&path, &dialog)?;
    remove_dialog_files(&dirs.dialogs, &removed)?;
    for id in &removed {
        if let Err(error) = recordings::remove_dialog(&dirs.recordings, id) {
            log::warn!("Could not remove recordings of expired dialog {id}: {error}");
        }
    }
    Ok(removed)
}

fn remove_dialog_files(dialogs_dir: &Path, ids: &[String]) -> Result<(), AppError> {
    for id in ids {
        remove_file_if_exists(&dialog_path(dialogs_dir, id)?)?;
    }
    if !ids.is_empty() {
        crate::services::atomic_file::sync_parent(&dialogs_dir.join("."))?;
    }
    Ok(())
}

/// Gives a stored dialog another title (or clears it when empty).
pub fn rename_dialog(dirs: &DialogDirs, id: &str, title: &str) -> Result<(), AppError> {
    let title = validate_dialog_title(title)?;
    let Some(mut dialog) = open_dialog(dirs, id)? else {
        return Err(AppError::NotFound(String::from("Dialog not found")));
    };
    dialog.title = title;
    write_json(&dialog_path(&dirs.dialogs, id)?, &dialog)
}

/// Removes `dialogs/<id>.json` and returns the dialog so the UI can offer Undo.
/// Its recording folder stays on disk until `release_dialog_recordings` runs.
pub fn delete_dialog(dirs: &DialogDirs, id: &str) -> Result<Option<Dialog>, AppError> {
    let removed = match read_dialog(&dirs.dialogs, id) {
        Ok(dialog) => dialog,
        Err(error) => {
            log::warn!("Removing dialog {id}, which cannot be read: {error}");
            None
        }
    };
    remove_dialog_files(&dirs.dialogs, &[id.to_owned()])?;
    Ok(removed)
}

/// Removes `dialogs/recordings/<id>/` once undo expires, unless the dialog was
/// restored meanwhile.
pub fn release_dialog_recordings(dirs: &DialogDirs, id: &str) -> Result<(), AppError> {
    let path = dialog_path(&dirs.dialogs, id)?;
    if path.exists() {
        return Ok(());
    }
    recordings::remove_dialog(&dirs.recordings, id)
}

/// Removes an unlinked recording file `(dialog_id, file)` if no saved dialog
/// references it.
pub fn discard_recording(dirs: &DialogDirs, dialog_id: &str, file: &str) -> Result<(), AppError> {
    if let Ok(Some(dialog)) = read_dialog(&dirs.dialogs, dialog_id) {
        let is_named = dialog.recording_files.iter().any(|name| name == file)
            || dialog
                .session_breaks
                .iter()
                .any(|item| item.recording_file.as_deref() == Some(file));
        if is_named {
            return Ok(());
        }
    }
    recordings::discard(&dirs.recordings, dialog_id, file)
}

/// Removes all saved dialogs, their index, and all recording folders.
pub fn clear_dialogs(dirs: &DialogDirs) -> Result<(), AppError> {
    super::user_data::ensure_write_allowed(&dirs.dialogs)?;
    for (_, path) in super::user_files::list_own_files(&dirs.dialogs, |name| {
        dialog_file_id(Path::new(name)).is_some()
    })? {
        remove_file_if_exists(&path)?;
    }
    remove_file_if_exists(&dirs.index)?;
    recordings::clear(&dirs.recordings)
}

/// What the settings say about the dialog history.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DialogHistoryPolicy {
    /// New dialogs are kept in the memory of the process only and nothing is
    /// recorded; the stored ones stay on disk as they are.
    pub is_session: bool,
    /// Stored dialogs older than this many days are dropped; 0 keeps them
    /// forever, as does the session mode.
    pub retention_days: u64,
}

impl DialogHistoryPolicy {
    pub fn from_config(user_config: &Value) -> Self {
        user_config::dialog_history(user_config).into()
    }

    fn drop_expired(&self, history: &mut Vec<DialogSummary>, now_ms: u64) -> Vec<String> {
        if self.retention_days == 0 {
            return Vec::new();
        }
        let cutoff = now_ms.saturating_sub(self.retention_days.saturating_mul(DAY_MS));
        let mut removed = Vec::new();
        history.retain(|item| {
            let keep = item.updated_at_ms >= cutoff;
            if !keep {
                removed.push(item.id.clone());
            }
            keep
        });
        removed
    }
}

impl From<DialogHistoryConfig> for DialogHistoryPolicy {
    fn from(config: DialogHistoryConfig) -> Self {
        Self {
            is_session: config.storage == HistoryStorage::Session,
            retention_days: if config.storage == HistoryStorage::Session {
                0
            } else {
                config.retention_days
            },
        }
    }
}

/// Stores a session dialog in the data folder with its recordings. One still
/// being recorded waits: its file is not finished yet.
pub(super) fn store_session_dialog(
    dirs: &DialogDirs,
    session_recordings: &RecordingDirs,
    policy: DialogHistoryPolicy,
    dialog: &Dialog,
) -> Result<(), AppError> {
    if recordings::is_dialog_writing(&dialog.id) {
        return Err(AppError::Failed(format!(
            "The dialog {} is still being recorded",
            dialog.id
        )));
    }
    let id = recordings::validate_dialog_id(&dialog.id)?;
    for name in &dialog.recording_files {
        let from = session_recordings.shared.join(id).join(name);
        if from.is_file() {
            recordings::publish(&from, &dirs.recordings.shared.join(id).join(name))?;
        }
    }
    let _ = std::fs::remove_dir(session_recordings.shared.join(id));
    save_dialog(dirs, policy, dialog.clone()).map(|_| ())
}

/// Enforces retention and collects orphaned recording folders.
pub(super) fn enforce_dialog_history_policy(
    dirs: &DialogDirs,
    policy: DialogHistoryPolicy,
) -> Result<Vec<String>, AppError> {
    super::user_data::ensure_write_allowed(&dirs.dialogs)?;
    let now = now_ms();
    let mut history = list_dialogs(dirs)?;
    let removed = policy.drop_expired(&mut history, now);
    remove_dialog_files(&dirs.dialogs, &removed)?;
    for id in &removed {
        if let Err(error) = recordings::remove_dialog(&dirs.recordings, id) {
            log::warn!("Could not remove recordings of expired dialog {id}: {error}");
        }
    }
    let live: HashSet<String> = history.into_iter().map(|item| item.id).collect();
    if let Err(error) = recordings::collect_orphans(&dirs.recordings, &live, now) {
        log::warn!("Could not collect unused dialog recordings: {error}");
    }
    Ok(removed)
}

/// Lowercase searchable text cache of dialog files.
pub struct DialogSearchCache {
    state: Mutex<SearchCacheState>,
    max_bytes: usize,
}

impl Default for DialogSearchCache {
    fn default() -> Self {
        Self {
            state: Mutex::default(),
            max_bytes: MAX_CACHED_SEARCH_BYTES,
        }
    }
}

const MAX_CACHED_SEARCH_BYTES: usize = 32 * 1024 * 1024;

#[derive(Default)]
struct SearchCacheState {
    entries: HashMap<PathBuf, CachedDialogText>,
    total_bytes: usize,
    clock: u64,
}

struct CachedDialogText {
    modified: SystemTime,
    size_bytes: u64,
    text: String,
    last_used: u64,
}

impl SearchCacheState {
    fn remove(&mut self, path: &Path) {
        if let Some(entry) = self.entries.remove(path) {
            self.total_bytes -= entry.text.len();
        }
    }

    fn insert(
        &mut self,
        path: PathBuf,
        modified: SystemTime,
        size_bytes: u64,
        text: String,
        max_bytes: usize,
    ) {
        self.remove(&path);
        if text.len() > max_bytes {
            return;
        }
        while self.total_bytes + text.len() > max_bytes {
            let Some(oldest) = self
                .entries
                .iter()
                .min_by_key(|(_, entry)| entry.last_used)
                .map(|(path, _)| path.clone())
            else {
                break;
            };
            self.remove(&oldest);
        }
        self.clock += 1;
        self.total_bytes += text.len();
        self.entries.insert(
            path,
            CachedDialogText {
                modified,
                size_bytes,
                text,
                last_used: self.clock,
            },
        );
    }
}

impl DialogSearchCache {
    pub(super) fn invalidate(&self, path: &Path) {
        self.state.locked().remove(path);
    }

    fn matches(&self, dialogs_dir: &Path, id: &str, query: &str) -> Result<Option<bool>, AppError> {
        let path = dialog_path(dialogs_dir, id)?;
        let metadata = match fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        let modified = metadata.modified()?;
        let size_bytes = metadata.len();
        {
            let mut state = self.state.locked();
            state.clock += 1;
            let now = state.clock;
            if let Some(cached) = state.entries.get_mut(&path) {
                if cached.modified == modified && cached.size_bytes == size_bytes {
                    cached.last_used = now;
                    return Ok(Some(cached.text.contains(query)));
                }
            }
        }
        let Some(dialog) = read_dialog(dialogs_dir, id)? else {
            return Ok(None);
        };
        let text = dialog_search_text(&dialog);
        let found = text.contains(query);
        self.state
            .locked()
            .insert(path, modified, size_bytes, text, self.max_bytes);
        Ok(Some(found))
    }

    fn retain_listed(&self, dialogs_dir: &Path, history: &[DialogSummary]) {
        let mut state = self.state.locked();
        let gone: Vec<PathBuf> = state
            .entries
            .keys()
            .filter(|path| {
                path.parent() == Some(dialogs_dir)
                    && !history.iter().any(|item| {
                        path.file_stem().and_then(|stem| stem.to_str()) == Some(&item.id)
                    })
            })
            .cloned()
            .collect();
        for path in gone {
            state.remove(&path);
        }
    }
}

pub(super) fn dialog_search_text(dialog: &Dialog) -> String {
    let mut pieces = vec![dialog.title.as_str()];
    for segment in &dialog.segments {
        pieces.push(&segment.text);
        if let Some(translation) = &segment.translation {
            pieces.push(translation);
        }
    }
    pieces.join("\n").to_lowercase()
}

pub(super) fn search_dialogs(
    dialogs_dir: &Path,
    history: Vec<DialogSummary>,
    query: String,
    cache: &DialogSearchCache,
) -> Result<Vec<String>, AppError> {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return Ok(history.into_iter().map(|item| item.id).collect());
    }
    cache.retain_listed(dialogs_dir, &history);
    let mut found = Vec::new();
    for item in history {
        let matches = match cache.matches(dialogs_dir, &item.id, &query) {
            Ok(Some(found)) => found,
            Ok(None) => {
                item.title.to_lowercase().contains(&query)
                    || item.preview.to_lowercase().contains(&query)
            }
            Err(error) => {
                log::warn!("Searching dialog {} by summary only: {error}", item.id);
                item.title.to_lowercase().contains(&query)
                    || item.preview.to_lowercase().contains(&query)
            }
        };
        if matches {
            found.push(item.id);
        }
    }
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{
        DialogBreakAction, DialogSegment, DialogSessionBreak, DialogSide, DialogSource,
        DialogTranslationState,
    };
    use crate::services::test_support::TestDir;

    fn test_dirs(root: &Path) -> DialogDirs {
        DialogDirs {
            dialogs: root.join("user").join("dialogs"),
            recordings: RecordingDirs::at(root),
            index: root.join("state").join("index").join(DIALOG_INDEX_FILE),
        }
    }

    #[test]
    fn a_session_dialog_goes_to_the_data_folder_with_its_recordings() {
        let root = TestDir::new("session-dialog-to-disk");
        let dirs = test_dirs(&root);
        let session =
            RecordingDirs::in_folders(root.join("session/recordings"), &root.join("session/state"));
        let id = "2026-11-25_14-03-05_a1b2c3";
        let name = "2026-11-25 14-03-05 a1b2c3.opus";
        let mut dialog = sample_dialog(id, now_ms(), "Hello");
        dialog.recording_files = vec![name.into()];
        fs::create_dir_all(session.shared.join(id)).unwrap();
        fs::write(session.shared.join(id).join(name), b"opus").unwrap();
        let policy = DialogHistoryPolicy {
            is_session: false,
            retention_days: 0,
        };

        store_session_dialog(&dirs, &session, policy, &dialog).unwrap();

        assert!(dirs.recordings.shared.join(id).join(name).is_file());
        assert!(!session.shared.join(id).exists());
        assert!(read_dialog(&dirs.dialogs, id).unwrap().is_some());
    }

    fn sample_dialog(id: &str, updated_at_ms: u64, text: &str) -> Dialog {
        Dialog {
            id: id.into(),
            title: String::new(),
            started_at_ms: updated_at_ms.saturating_sub(5_000),
            updated_at_ms,
            source: DialogSource::MicrophoneAndSystem,
            translation_target_language: "ru-RU".into(),
            segments: vec![DialogSegment {
                id: "seg-1".into(),
                side: DialogSide::Remote,
                start_ms: updated_at_ms.saturating_sub(4_000),
                end_ms: updated_at_ms,
                text: text.into(),
                translation: Some("Привет мир".into()),
                translation_state: DialogTranslationState::Complete,
            }],
            session_breaks: vec![DialogSessionBreak {
                id: "break-1".into(),
                timestamp_ms: updated_at_ms.saturating_sub(5_000),
                is_recording: true,
                recording_file: Some("2026-11-25 14-03-05 a1b2c3.opus".into()),
                action: Some(DialogBreakAction::Started),
            }],
            recording_files: vec!["2026-11-25 14-03-05 a1b2c3.opus".into()],
            incomplete_recording_files: Vec::new(),
        }
    }

    #[test]
    fn save_list_open_rename_search_and_delete_dialog() {
        let root = TestDir::new("dialog-history-crud");
        let dirs = test_dirs(&root);
        let policy = DialogHistoryPolicy {
            is_session: false,
            retention_days: 0,
        };
        let id = "2026-11-25_14-03-05_a1b2c3";
        let dialog = sample_dialog(id, now_ms(), "Release planning meeting");
        save_dialog(&dirs, policy, dialog.clone()).unwrap();

        let listed = list_dialogs(&dirs).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, id);
        assert_eq!(listed[0].recording_count, 1);

        let opened = open_dialog(&dirs, id).unwrap().unwrap();
        assert_eq!(opened, dialog);

        rename_dialog(&dirs, id, "Sprint Planning").unwrap();
        assert_eq!(list_dialogs(&dirs).unwrap()[0].title, "Sprint Planning");

        let cache = DialogSearchCache::default();
        assert_eq!(
            search_dialogs(
                &dirs.dialogs,
                list_dialogs(&dirs).unwrap(),
                "привет".into(),
                &cache
            )
            .unwrap(),
            vec![id]
        );
        assert_eq!(
            search_dialogs(
                &dirs.dialogs,
                list_dialogs(&dirs).unwrap(),
                "planning".into(),
                &cache
            )
            .unwrap(),
            vec![id]
        );

        let rec_path = dirs
            .recordings
            .shared
            .join(id)
            .join("2026-11-25 14-03-05 a1b2c3.opus");
        fs::create_dir_all(rec_path.parent().unwrap()).unwrap();
        fs::write(&rec_path, b"OggS").unwrap();

        let deleted = delete_dialog(&dirs, id).unwrap().unwrap();
        assert_eq!(deleted.title, "Sprint Planning");
        assert!(list_dialogs(&dirs).unwrap().is_empty());
        // Recording stays during undo window
        assert!(rec_path.is_file());

        // After undo expires, recording folder is removed
        release_dialog_recordings(&dirs, id).unwrap();
        assert!(!rec_path.exists());
        assert!(!dirs.recordings.shared.join(id).exists());
    }

    #[test]
    fn retention_drops_expired_dialogs_and_their_recordings() {
        let root = TestDir::new("dialog-history-retention");
        let dirs = test_dirs(&root);
        let now = now_ms();
        let old_id = "2026-10-01_10-00-00_000001";
        let fresh_id = "2026-11-25_10-00-00_000002";
        let no_limit = DialogHistoryPolicy {
            is_session: false,
            retention_days: 0,
        };
        save_dialog(
            &dirs,
            no_limit,
            sample_dialog(old_id, now - 40 * DAY_MS, "old"),
        )
        .unwrap();
        save_dialog(&dirs, no_limit, sample_dialog(fresh_id, now, "fresh")).unwrap();

        for id in [old_id, fresh_id] {
            let p = dirs
                .recordings
                .shared
                .join(id)
                .join("2026-11-25 14-03-05 a1b2c3.opus");
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, b"OggS").unwrap();
        }

        let thirty_days = DialogHistoryPolicy {
            is_session: false,
            retention_days: 30,
        };
        let removed = enforce_dialog_history_policy(&dirs, thirty_days).unwrap();
        assert_eq!(removed, vec![old_id]);
        assert!(!dirs.recordings.shared.join(old_id).exists());
        assert!(dirs.recordings.shared.join(fresh_id).exists());
    }

    #[test]
    fn clearing_removes_all_dialogs_and_recordings() {
        let root = TestDir::new("dialog-history-clear");
        let dirs = test_dirs(&root);
        let id = "2026-11-25_14-03-05_a1b2c3";
        save_dialog(
            &dirs,
            DialogHistoryPolicy {
                is_session: false,
                retention_days: 0,
            },
            sample_dialog(id, now_ms(), "hello"),
        )
        .unwrap();
        let rec_path = dirs
            .recordings
            .shared
            .join(id)
            .join("2026-11-25 14-03-05 a1b2c3.opus");
        fs::create_dir_all(rec_path.parent().unwrap()).unwrap();
        fs::write(&rec_path, b"OggS").unwrap();

        clear_dialogs(&dirs).unwrap();
        assert!(list_dialogs(&dirs).unwrap().is_empty());
        assert!(!rec_path.exists());
    }
}
