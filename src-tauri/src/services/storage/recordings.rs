//! The call recordings of the dialog. Each dialog keeps its audio files in its
//! own folder under `dialogs/recordings/<dialog id>/` of the user data folder,
//! so recordings stay grouped with their dialog and can be excluded from sync
//! or symlinked onto another disk as a single `dialogs/recordings` folder.
//!
//! While a recording runs, it is written to `recordings/<dialog id>/` in the
//! state folder of this device: a sync tool would otherwise send a file that
//! grows for an hour again and again. Once finished it moves into the data
//! folder under the same dialog folder and file name; one left behind by a
//! crash or by a data folder that was away moves at the next start, see
//! `settle_leftovers`.
//!
//! Recordings go with their dialog: when the undo of a deletion expires
//! (`remove_dialog`), with the whole dialog history (`clear`), and when the
//! retention limits drop the dialog (`collect_orphans` / `remove_dialog`).
//! The recordings of a session dialog live in the folder of this run
//! instead (`session_files`), see `RecordingDirs::of_dialog`.
//!
//! A dialog folder no saved dialog names waits `orphan_files::ORPHAN_GRACE_MS`
//! first: a sync tool may bring recordings before `<dialog id>.json`. A
//! recording still being written when its dialog goes is removed as soon as it
//! is finished, see `begin_writing`.
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::AppHandle;

use super::orphan_files::{OrphanRecord, ORPHAN_GRACE_MS};
use super::user_data::{ensure_write_allowed, user_dir_for, UserDirAccess};
use crate::errors::AppError;
use crate::locks::MutexExt;
use crate::services::atomic_file::create_private_dir;

/// The recordings being written, by `(dialog_id, file_name)`: whether their
/// dialog or file was discarded meanwhile. The file cannot be removed while it
/// is open (Windows refuses, Linux would let it be published again), so the
/// writer removes it when it closes.
static WRITING: Mutex<BTreeMap<(String, String), bool>> = Mutex::new(BTreeMap::new());

/// The recording `(dialog_id, name)` starts being written, see `finish_writing`.
pub fn begin_writing(dialog_id: &str, name: &str) {
    WRITING
        .locked()
        .insert((dialog_id.to_owned(), name.to_owned()), false);
}

/// Publishes or removes the closed file under the same lock as history deletion.
pub fn finish_writing(
    dialog_id: &str,
    name: &str,
    active_path: &Path,
    shared_path: &Path,
    has_audio: bool,
) -> Result<(), AppError> {
    let key = (dialog_id.to_owned(), name.to_owned());
    let mut writing = WRITING.locked();
    let result = if writing.get(&key).copied().unwrap_or(false) || !has_audio {
        remove_file_if_present(active_path)
    } else {
        publish(active_path, shared_path)
    };
    writing.remove(&key);
    if let Some(parent) = active_path.parent() {
        let _ = fs::remove_dir(parent);
    }
    result
}

#[cfg(test)]
pub fn end_writing(dialog_id: &str, name: &str) -> bool {
    WRITING
        .locked()
        .remove(&(dialog_id.to_owned(), name.to_owned()))
        .unwrap_or(false)
}

pub(super) fn is_dialog_writing(dialog_id: &str) -> bool {
    WRITING
        .locked()
        .keys()
        .any(|(active_dialog_id, _)| active_dialog_id == dialog_id)
}

fn remove_file_if_present(path: &Path) -> Result<(), AppError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

/// The folder of the recordings in the user data folder.
pub const RECORDINGS_DIR: &str = "dialogs/recordings";
/// The folder of the recordings still being written, in the state folder.
const ACTIVE_DIR: &str = "recordings";
const ORPHANS_FILE: &str = "index/orphan-recordings.json";
const EXTENSION: &str = ".opus";
/// `YYYY-MM-DD HH-MM-SS` local time, then six lowercase hex digits: `d` a
/// digit, `h` a hex digit, anything else itself.
const NAME_PATTERN: &[u8] = b"dddd-dd-dd dd-dd-dd hhhhhh";
const SUFFIX_LENGTH: usize = 6;

/// Where the recordings are.
#[derive(Clone, Debug)]
pub struct RecordingDirs {
    /// `dialogs/recordings` of the user data folder.
    pub shared: PathBuf,
    /// The recordings being written, in the state folder.
    pub active: PathBuf,
    /// When this device first saw each recording folder no dialog names.
    pub orphans: PathBuf,
}

impl RecordingDirs {
    pub fn of_app(app: &AppHandle) -> Result<Self, AppError> {
        let shared = user_dir_for(app, UserDirAccess::Read)?.join(RECORDINGS_DIR);
        let state = super::paths::state_dir(app)?;
        Ok(Self::in_folders(shared, &state))
    }

    /// Where the recordings of `dialog_id` are: those of a session dialog in
    /// the folder of this run, see `session_files`, the others in the data
    /// folder.
    pub fn of_dialog(app: &AppHandle, dialog_id: &str) -> Result<Self, AppError> {
        let session = super::session_files::SessionFiles::of_app(app).recordings();
        let id = validate_dialog_id(dialog_id)?;
        if session.shared.join(id).is_dir() || session.active.join(id).is_dir() {
            return Ok(session);
        }
        Self::of_app(app)
    }

    pub fn in_folders(shared: PathBuf, state: &Path) -> Self {
        Self {
            shared,
            active: state.join(ACTIVE_DIR),
            orphans: state.join(ORPHANS_FILE),
        }
    }

    #[cfg(test)]
    pub fn at(root: &Path) -> Self {
        Self::in_folders(root.join("user").join(RECORDINGS_DIR), &root.join("state"))
    }
}

/// Validates a dialog folder name inside `dialogs/recordings/`.
pub fn validate_dialog_id(id: &str) -> Result<&str, AppError> {
    if crate::services::file_ids::is_file_id(id) {
        Ok(id)
    } else {
        Err(AppError::InvalidInput("Invalid dialog id".into()))
    }
}

/// Whether `name` is the file name of a recording, as `new_recording` makes
/// it. Anything else in the folder, e.g. a conflicting copy, is not touched.
pub fn is_recording_name(name: &str) -> bool {
    let Some(stem) = name.strip_suffix(EXTENSION) else {
        return false;
    };
    stem.len() == NAME_PATTERN.len()
        && stem
            .bytes()
            .zip(NAME_PATTERN)
            .all(|(byte, pattern)| match pattern {
                b'd' => byte.is_ascii_digit(),
                b'h' => byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte),
                other => byte == *other,
            })
}

fn checked_name(name: &str) -> Result<&str, AppError> {
    if is_recording_name(name) {
        Ok(name)
    } else {
        Err(AppError::InvalidInput("Not a call recording".into()))
    }
}

/// A recording about to start.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NewRecording {
    /// The dialog this recording belongs to.
    pub dialog_id: String,
    /// The file name inside `<dialog_id>/`, the same in both places.
    pub name: String,
    /// Where it is written while it runs.
    pub active_path: PathBuf,
    /// Where it goes once finished.
    pub shared_path: PathBuf,
}

/// A name no recording has in `dialog_id`, in either place, for a recording
/// started at `local_time` (`YYYY-MM-DD HH-MM-SS`). The data folder must be
/// writable: a recording it cannot take is not started.
pub fn new_recording(
    dirs: &RecordingDirs,
    dialog_id: &str,
    local_time: &str,
) -> Result<NewRecording, AppError> {
    let dialog_id = validate_dialog_id(dialog_id)?;
    ensure_write_allowed(&dirs.shared)?;
    let active_dialog_dir = dirs.active.join(dialog_id);
    let shared_dialog_dir = dirs.shared.join(dialog_id);
    create_private_dir(&active_dialog_dir)?;
    loop {
        let suffix: String = crate::services::random_id::new_uuid()
            .chars()
            .filter(char::is_ascii_hexdigit)
            .take(SUFFIX_LENGTH)
            .collect::<String>()
            .to_ascii_lowercase();
        let name = format!("{local_time} {suffix}{EXTENSION}");
        if !is_recording_name(&name) {
            return Err(AppError::InvalidInput(format!(
                "Not a recording time: {local_time}"
            )));
        }
        let active_path = active_dialog_dir.join(&name);
        let shared_path = shared_dialog_dir.join(&name);
        if fs::symlink_metadata(&active_path).is_err()
            && fs::symlink_metadata(&shared_path).is_err()
        {
            return Ok(NewRecording {
                dialog_id: dialog_id.to_owned(),
                name,
                active_path,
                shared_path,
            });
        }
    }
}

/// Moves a finished recording into the data folder, renamed or, across
/// disks, copied and then removed. A failure leaves it where it is.
pub fn publish(active_path: &Path, shared_path: &Path) -> Result<(), AppError> {
    let shared_dir = shared_path
        .parent()
        .ok_or_else(|| AppError::InvalidInput("A recording needs a folder".into()))?;
    create_private_dir(shared_dir)?;
    super::data_root_relocation::move_entry(active_path, shared_path)
}

/// Lists valid dialog subdirectories inside `root`, sorted by name.
fn list_dialog_dirs(root: &Path) -> Result<Vec<(String, PathBuf)>, AppError> {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    let mut dirs = Vec::new();
    for entry in entries {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        if let Ok(name) = entry.file_name().into_string() {
            if validate_dialog_id(&name).is_ok() {
                dirs.push((name, entry.path()));
            }
        }
    }
    dirs.sort();
    Ok(dirs)
}

/// Moves the finished recordings a previous run left in the state folder
/// into the data folder. Runs at startup only, before any recording starts:
/// a file being written is never moved. Each file is tried; the first
/// failure is returned.
pub fn settle_leftovers(dirs: &RecordingDirs) -> Result<(), AppError> {
    let mut result = Ok(());
    for (dialog_id, active_dialog_dir) in list_dialog_dirs(&dirs.active)? {
        for (name, path) in
            super::user_files::list_own_files(&active_dialog_dir, is_recording_name)?
        {
            let target = dirs.shared.join(&dialog_id).join(&name);
            if let Err(error) = publish(&path, &target) {
                log::warn!(
                    "Could not move the recording {dialog_id}/{name} to the data folder: {error}"
                );
                result = result.and(Err(error));
            }
        }
        let _ = fs::remove_dir(&active_dialog_dir);
    }
    result
}

/// The file of the recording `(dialog_id, name)`: in the data folder, or still
/// in the state folder while it runs.
fn find(dirs: &RecordingDirs, dialog_id: &str, name: &str) -> Option<PathBuf> {
    [
        dirs.shared.join(dialog_id).join(name),
        dirs.active.join(dialog_id).join(name),
    ]
    .into_iter()
    .find(|path| path.is_file())
}

/// Which of the recordings `names` of `dialog_id` are there.
pub fn exist(dirs: &RecordingDirs, dialog_id: &str, names: &[String]) -> Vec<bool> {
    if validate_dialog_id(dialog_id).is_err() {
        return vec![false; names.len()];
    }
    names
        .iter()
        .map(|name| is_recording_name(name) && find(dirs, dialog_id, name).is_some())
        .collect()
}

/// The file of the recording `(dialog_id, name)` to play: a finished one only,
/// as one being written still grows and has no final headers.
pub fn playable_file(
    dirs: &RecordingDirs,
    dialog_id: &str,
    name: &str,
) -> Result<PathBuf, AppError> {
    let dialog_id = validate_dialog_id(dialog_id)?;
    let name = checked_name(name)?;
    if WRITING
        .locked()
        .contains_key(&(dialog_id.to_owned(), name.to_owned()))
    {
        return Err(AppError::NotFound("The recording is being written".into()));
    }
    find(dirs, dialog_id, name)
        .ok_or_else(|| AppError::NotFound("The recording file is not found".into()))
}

/// The folder that holds the recording `(dialog_id, name)`.
pub fn folder_of(dirs: &RecordingDirs, dialog_id: &str, name: &str) -> Result<PathBuf, AppError> {
    let dialog_id = validate_dialog_id(dialog_id)?;
    let name = checked_name(name)?;
    let file = find(dirs, dialog_id, name)
        .ok_or_else(|| AppError::NotFound("The recording file is not found".into()))?;
    Ok(file
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| dirs.shared.join(dialog_id)))
}

/// The recordings folder of the data folder (or of one dialog), created when
/// it is not there.
pub fn shared_folder(dirs: &RecordingDirs, dialog_id: Option<&str>) -> Result<PathBuf, AppError> {
    let target = match dialog_id {
        Some(id) => {
            let id = validate_dialog_id(id)?;
            let shared = dirs.shared.join(id);
            let active = dirs.active.join(id);
            if shared.is_dir() {
                return Ok(shared);
            }
            if active.is_dir() {
                return Ok(active);
            }
            shared
        }
        None => dirs.shared.clone(),
    };
    create_private_dir(&target)?;
    Ok(target)
}

/// Opens the recordings folder (or a specific dialog's recordings folder) in
/// the file manager.
pub fn open_folder(app: &AppHandle, dialog_id: Option<&str>) -> Result<(), AppError> {
    let dirs = match dialog_id {
        Some(id) => RecordingDirs::of_dialog(app, id)?,
        None => RecordingDirs::of_app(app)?,
    };
    crate::services::platform::open_dir(&shared_folder(&dirs, dialog_id)?)
}

/// Which of the recordings `names` of `dialog_id` are there, see `exist`.
pub fn check(app: &AppHandle, dialog_id: &str, names: &[String]) -> Result<Vec<bool>, AppError> {
    Ok(exist(
        &RecordingDirs::of_dialog(app, dialog_id)?,
        dialog_id,
        names,
    ))
}

/// Opens the folder that holds the recording `(dialog_id, name)` in the file
/// manager.
pub fn show(app: &AppHandle, dialog_id: &str, name: &str) -> Result<(), AppError> {
    crate::services::platform::open_dir(&folder_of(
        &RecordingDirs::of_dialog(app, dialog_id)?,
        dialog_id,
        name,
    )?)
}

/// The bytes of a finished recording `(dialog_id, name)`.
pub fn read_file(app: &AppHandle, dialog_id: &str, name: &str) -> Result<Vec<u8>, AppError> {
    Ok(fs::read(playable_file(
        &RecordingDirs::of_dialog(app, dialog_id)?,
        dialog_id,
        name,
    )?)?)
}

/// Removes a single recording `(dialog_id, name)` wherever it is, and cleans up
/// its empty dialog folder.
fn remove_file(dirs: &RecordingDirs, dialog_id: &str, name: &str) -> Result<(), AppError> {
    let mut writing = WRITING.locked();
    let shared_dir = dirs.shared.join(dialog_id);
    let shared_path = shared_dir.join(name);
    ensure_write_allowed(&shared_path)?;
    remove_file_if_present(&shared_path)?;
    let _ = fs::remove_dir(&shared_dir);

    let key = (dialog_id.to_owned(), name.to_owned());
    if let Some(discard) = writing.get_mut(&key) {
        *discard = true;
    } else {
        let active_dir = dirs.active.join(dialog_id);
        remove_file_if_present(&active_dir.join(name))?;
        let _ = fs::remove_dir(&active_dir);
    }
    Ok(())
}

/// Removes a single recording `(dialog_id, name)`, see `remove_file`.
pub fn discard(dirs: &RecordingDirs, dialog_id: &str, name: &str) -> Result<(), AppError> {
    remove_file(dirs, validate_dialog_id(dialog_id)?, checked_name(name)?)
}

/// Removes every recording belonging to `dialog_id`, also those still being
/// written once they close, and removes `<dialog_id>/` if now empty.
pub fn remove_dialog(dirs: &RecordingDirs, dialog_id: &str) -> Result<(), AppError> {
    let dialog_id = validate_dialog_id(dialog_id)?;
    let mut writing = WRITING.locked();
    let shared_dir = dirs.shared.join(dialog_id);
    ensure_write_allowed(&shared_dir)?;
    for (_, path) in super::user_files::list_own_files(&shared_dir, is_recording_name)? {
        remove_file_if_present(&path)?;
    }
    let _ = fs::remove_dir(&shared_dir);

    let active_dir = dirs.active.join(dialog_id);
    for (name, path) in super::user_files::list_own_files(&active_dir, is_recording_name)? {
        let key = (dialog_id.to_owned(), name);
        if let Some(discard) = writing.get_mut(&key) {
            *discard = true;
        } else {
            remove_file_if_present(&path)?;
        }
    }
    for ((active_dialog_id, _), discard) in writing.iter_mut() {
        if active_dialog_id == dialog_id {
            *discard = true;
        }
    }
    let _ = fs::remove_dir(&active_dir);
    Ok(())
}

/// Removes every recording across all dialogs, also those being written once
/// they are closed; preserves `dirs.shared` itself (including when linked).
pub fn clear(dirs: &RecordingDirs) -> Result<(), AppError> {
    let mut writing = WRITING.locked();
    ensure_write_allowed(&dirs.shared)?;
    for (_, dialog_dir) in list_dialog_dirs(&dirs.shared)? {
        for (_, path) in super::user_files::list_own_files(&dialog_dir, is_recording_name)? {
            remove_file_if_present(&path)?;
        }
        let _ = fs::remove_dir(&dialog_dir);
    }
    for (dialog_id, active_dir) in list_dialog_dirs(&dirs.active)? {
        for (name, path) in super::user_files::list_own_files(&active_dir, is_recording_name)? {
            let key = (dialog_id.clone(), name);
            if let Some(discard) = writing.get_mut(&key) {
                *discard = true;
            } else {
                remove_file_if_present(&path)?;
            }
        }
        let _ = fs::remove_dir(&active_dir);
    }
    for discard in writing.values_mut() {
        *discard = true;
    }
    Ok(())
}

/// Removes dialog recording folders no saved dialog names after the grace
/// period, so a recording synced before its dialog JSON survives.
pub fn collect_orphans(
    dirs: &RecordingDirs,
    live_dialogs: &HashSet<String>,
    now_ms: u64,
) -> Result<(), AppError> {
    ensure_write_allowed(&dirs.shared)?;
    let mut record = OrphanRecord::read(&dirs.orphans);
    let before = record.clone();
    let dialog_dirs = list_dialog_dirs(&dirs.shared)?;
    let key = dirs.shared.to_string_lossy().into_owned();
    let mut present = HashSet::new();
    let mut to_remove = Vec::new();
    {
        let seen = record.entries_mut(&key);
        for (dialog_id, _) in &dialog_dirs {
            present.insert(dialog_id.clone());
            if live_dialogs.contains(dialog_id) || is_dialog_writing(dialog_id) {
                seen.remove(dialog_id);
                continue;
            }
            let first_seen = *seen.entry(dialog_id.clone()).or_insert(now_ms);
            if now_ms.saturating_sub(first_seen) >= ORPHAN_GRACE_MS {
                to_remove.push(dialog_id.clone());
                seen.remove(dialog_id);
                present.remove(dialog_id);
            }
        }
        seen.retain(|id, _| present.contains(id));
    }
    record.prune_empty(&key);
    for dialog_id in to_remove {
        remove_dialog(dirs, &dialog_id)?;
    }
    record.write_if_changed(&dirs.orphans, &before)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::test_support::TestDir;

    const DIALOG_ID: &str = "2026-11-21_10-00-00_a1b2c3";
    const OTHER_DIALOG_ID: &str = "2026-11-21_11-00-00_d4e5f6";
    const NAME: &str = "2026-11-21 10-00-00 a1b2c3.opus";

    fn write(path: &Path) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"OggS").unwrap();
    }

    #[test]
    fn only_names_the_app_makes_are_recordings() {
        assert!(is_recording_name(NAME));
        for name in [
            "2026-11-21 10-00-00 A1B2C3.opus",
            "2026-11-21 10-00-00 a1b2c3.sync-conflict-20261121-100000-ABCDEF.opus",
            "2026-11-21 10-00-00 a1b2c3.ogg",
            "../2026-11-21 10-00-00 a1b2c.opus",
            "/etc/passwd",
            "",
        ] {
            assert!(!is_recording_name(name), "{name}");
        }
    }

    #[test]
    fn a_new_recording_is_written_aside_and_published_into_its_dialog_folder() {
        let root = TestDir::new("recordings-publish");
        let dirs = RecordingDirs::at(&root);
        let recording = new_recording(&dirs, DIALOG_ID, "2026-11-21 10-00-00").unwrap();
        assert_eq!(recording.dialog_id, DIALOG_ID);
        assert!(is_recording_name(&recording.name));
        assert_eq!(
            recording.active_path,
            dirs.active.join(DIALOG_ID).join(&recording.name)
        );
        assert_eq!(
            recording.shared_path,
            dirs.shared.join(DIALOG_ID).join(&recording.name)
        );
        write(&recording.active_path);
        assert_eq!(
            exist(&dirs, DIALOG_ID, std::slice::from_ref(&recording.name)),
            [true]
        );
        assert_eq!(
            folder_of(&dirs, DIALOG_ID, &recording.name).unwrap(),
            dirs.active.join(DIALOG_ID)
        );

        publish(&recording.active_path, &recording.shared_path).unwrap();
        assert!(!recording.active_path.exists());
        assert!(recording.shared_path.is_file());
        assert_eq!(
            folder_of(&dirs, DIALOG_ID, &recording.name).unwrap(),
            dirs.shared.join(DIALOG_ID)
        );
        assert!(new_recording(&dirs, DIALOG_ID, "not a time").is_err());
        assert!(new_recording(&dirs, "../bad", "2026-11-21 10-00-00").is_err());
    }

    #[test]
    fn leftovers_of_a_previous_run_move_into_their_dialog_folder() {
        let root = TestDir::new("recordings-leftovers");
        let dirs = RecordingDirs::at(&root);
        write(&dirs.active.join(DIALOG_ID).join(NAME));
        write(&dirs.active.join(DIALOG_ID).join("unknown.opus"));
        settle_leftovers(&dirs).unwrap();
        assert!(dirs.shared.join(DIALOG_ID).join(NAME).is_file());
        assert!(dirs.active.join(DIALOG_ID).join("unknown.opus").is_file());
    }

    #[test]
    fn only_recordings_are_checked_shown_or_discarded() {
        let root = TestDir::new("recordings-checked");
        let dirs = RecordingDirs::at(&root);
        write(&dirs.shared.join(DIALOG_ID).join("notes.txt"));
        assert_eq!(
            exist(&dirs, DIALOG_ID, &["notes.txt".into(), NAME.into()]),
            [false, false]
        );
        assert!(folder_of(&dirs, DIALOG_ID, "../notes.txt").is_err());
        assert!(discard(&dirs, DIALOG_ID, "notes.txt").is_err());
        assert!(dirs.shared.join(DIALOG_ID).join("notes.txt").exists());
        discard(&dirs, DIALOG_ID, NAME).unwrap();
    }

    #[test]
    fn clearing_removes_the_recordings_and_nothing_else() {
        let root = TestDir::new("recordings-clear");
        let dirs = RecordingDirs::at(&root);
        write(&dirs.shared.join(DIALOG_ID).join(NAME));
        write(
            &dirs
                .shared
                .join(DIALOG_ID)
                .join("2026-11-21 10-00-00 a1b2c3.sync-conflict-20261121-100000-ABCDEF.opus"),
        );
        let leftover = "2026-11-21 11-00-00 a1b2c3.opus";
        let running = "2026-11-21 11-00-00 c0ffee.opus";
        write(&dirs.active.join(OTHER_DIALOG_ID).join(leftover));
        write(&dirs.active.join(OTHER_DIALOG_ID).join(running));
        begin_writing(OTHER_DIALOG_ID, running);
        clear(&dirs).unwrap();
        assert!(!dirs.shared.join(DIALOG_ID).join(NAME).exists());
        assert_eq!(
            fs::read_dir(dirs.shared.join(DIALOG_ID)).unwrap().count(),
            1
        );
        assert!(!dirs.active.join(OTHER_DIALOG_ID).join(leftover).exists());
        // still open: its writer removes it
        assert!(dirs.active.join(OTHER_DIALOG_ID).join(running).exists());
        assert!(end_writing(OTHER_DIALOG_ID, running));
    }

    #[test]
    fn a_recording_discarded_while_written_goes_once_closed() {
        let root = TestDir::new("recordings-discard-running");
        let dirs = RecordingDirs::at(&root);
        let running = "2026-11-21 12-00-00 0d15ca.opus";
        let leftover = "2026-11-21 12-00-00 1eff00.opus";
        write(&dirs.active.join(DIALOG_ID).join(running));
        write(&dirs.active.join(DIALOG_ID).join(leftover));
        begin_writing(DIALOG_ID, running);
        discard(&dirs, DIALOG_ID, running).unwrap();
        discard(&dirs, DIALOG_ID, leftover).unwrap();
        assert!(dirs.active.join(DIALOG_ID).join(running).exists());
        assert!(!dirs.active.join(DIALOG_ID).join(leftover).exists());
        assert!(end_writing(DIALOG_ID, running));
        // a recording no entry gave up is kept
        begin_writing(DIALOG_ID, running);
        assert!(!end_writing(DIALOG_ID, running));
    }

    #[test]
    fn removing_a_dialog_clears_its_folder_and_orphan_folders_go_after_grace_period() {
        let root = TestDir::new("recordings-collect");
        let dirs = RecordingDirs::at(&root);
        let live_id = "2026-11-21_10-00-00_000001";
        let removed_id = "2026-11-21_10-00-00_000002";
        let orphan_id = "2026-11-21_10-00-00_000003";
        for id in [live_id, removed_id, orphan_id] {
            write(&dirs.shared.join(id).join(NAME));
        }
        remove_dialog(&dirs, removed_id).unwrap();
        assert!(!dirs.shared.join(removed_id).exists());
        assert!(dirs.shared.join(live_id).exists());

        let live = HashSet::from([live_id.to_owned()]);
        collect_orphans(&dirs, &live, 1_000).unwrap();
        assert!(dirs.shared.join(orphan_id).exists());

        collect_orphans(&dirs, &live, 1_000 + ORPHAN_GRACE_MS).unwrap();
        assert!(!dirs.shared.join(orphan_id).exists());
        assert!(dirs.shared.join(live_id).exists());
    }

    #[cfg(unix)]
    #[test]
    fn the_recordings_folder_may_be_a_link_to_another_place() {
        let root = TestDir::new("recordings-linked");
        let dirs = RecordingDirs::at(&root);
        let elsewhere = root.join("elsewhere");
        fs::create_dir_all(&elsewhere).unwrap();
        fs::create_dir_all(dirs.shared.parent().unwrap()).unwrap();
        std::os::unix::fs::symlink(&elsewhere, &dirs.shared).unwrap();

        let recording = new_recording(&dirs, DIALOG_ID, "2026-11-21 10-00-00").unwrap();
        write(&recording.active_path);
        publish(&recording.active_path, &recording.shared_path).unwrap();
        assert!(elsewhere.join(DIALOG_ID).join(&recording.name).is_file());
        assert_eq!(
            exist(&dirs, DIALOG_ID, std::slice::from_ref(&recording.name)),
            [true]
        );

        clear(&dirs).unwrap();
        assert!(!elsewhere.join(DIALOG_ID).exists());
        assert!(fs::symlink_metadata(&dirs.shared)
            .unwrap()
            .file_type()
            .is_symlink());
    }

    #[cfg(unix)]
    #[test]
    fn a_dangling_link_takes_no_recording() {
        let root = TestDir::new("recordings-dangling");
        let dirs = RecordingDirs::at(&root);
        fs::create_dir_all(dirs.shared.parent().unwrap()).unwrap();
        std::os::unix::fs::symlink(root.join("unmounted"), &dirs.shared).unwrap();
        write(&dirs.active.join(DIALOG_ID).join(NAME));
        assert!(settle_leftovers(&dirs).is_err());
        assert!(dirs.active.join(DIALOG_ID).join(NAME).is_file());
        assert!(!root.join("unmounted").exists());
    }
}
