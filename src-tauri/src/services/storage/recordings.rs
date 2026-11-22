//! The call recordings of the dialog. A recording belongs to the dialog entry
//! of the editor history that names it and lives in `history/recordings/` of
//! the user data folder, so it moves and syncs with the history.
//!
//! While it runs, a recording is written to the state folder of this device:
//! a sync tool would otherwise send a file that grows for an hour again and
//! again. Once finished it moves into the data folder under the same name;
//! one left behind by a crash or by a data folder that was away moves at the
//! next start, see `settle_leftovers`.
//!
//! A recording goes with its entry: when the undo of a removal expires
//! (`discard`), with the whole history (`clear`), and when the retention
//! limits drop the entry (`collect`). A file no entry names waits
//! `orphan_files::ORPHAN_GRACE_MS` first: a sync tool may bring it before the
//! journal that names it. A recording still being written when its entry goes
//! is removed as soon as it is finished, see `begin_writing`.
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::AppHandle;

use super::orphan_files::OrphanRecord;
use super::user_data::{ensure_write_allowed, user_dir_for, UserDirAccess};
use crate::errors::AppError;
use crate::locks::MutexExt;
use crate::services::atomic_file::create_private_dir;

/// The recordings being written, by name: whether their entry went meanwhile.
/// The file cannot be removed while it is open (Windows refuses, Linux would
/// let it be published again), so the writer removes it when it closes.
static WRITING: Mutex<BTreeMap<String, bool>> = Mutex::new(BTreeMap::new());

/// The recording `name` starts being written, see `end_writing`.
pub fn begin_writing(name: &str) {
    WRITING.locked().insert(name.to_owned(), false);
}

/// Publishes or removes the closed file under the same lock as history deletion.
pub fn finish_writing(
    name: &str,
    active_path: &Path,
    shared_path: &Path,
    has_audio: bool,
) -> Result<(), AppError> {
    let mut writing = WRITING.locked();
    let result = if writing.get(name).copied().unwrap_or(false) || !has_audio {
        remove_file_if_present(active_path)
    } else {
        publish(active_path, shared_path)
    };
    writing.remove(name);
    result
}

#[cfg(test)]
pub fn end_writing(name: &str) -> bool {
    WRITING.locked().remove(name).unwrap_or(false)
}

fn remove_file_if_present(path: &Path) -> Result<(), AppError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

/// The folder of the recordings in the user data folder.
pub const RECORDINGS_DIR: &str = "history/recordings";
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
    /// `history/recordings` of the user data folder.
    pub shared: PathBuf,
    /// The recordings being written, in the state folder.
    pub active: PathBuf,
    /// When this device first saw each recording no entry names.
    pub orphans: PathBuf,
}

impl RecordingDirs {
    pub fn of_app(app: &AppHandle) -> Result<Self, AppError> {
        let shared = user_dir_for(app, UserDirAccess::Read)?.join(RECORDINGS_DIR);
        let state = super::paths::state_dir(app)?;
        Ok(Self::in_folders(shared, &state))
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
    /// The file name, the same in both places.
    pub name: String,
    /// Where it is written while it runs.
    pub active_path: PathBuf,
    /// Where it goes once finished.
    pub shared_path: PathBuf,
}

/// A name no recording has, in either place, for a recording started at
/// `local_time` (`YYYY-MM-DD HH-MM-SS`). The data folder must be writable:
/// a recording it cannot take is not started.
pub fn new_recording(dirs: &RecordingDirs, local_time: &str) -> Result<NewRecording, AppError> {
    ensure_write_allowed(&dirs.shared)?;
    create_private_dir(&dirs.active)?;
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
        let active_path = dirs.active.join(&name);
        let shared_path = dirs.shared.join(&name);
        if fs::symlink_metadata(&active_path).is_err()
            && fs::symlink_metadata(&shared_path).is_err()
        {
            return Ok(NewRecording {
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

/// Moves the finished recordings a previous run left in the state folder
/// into the data folder. Runs at startup only, before any recording starts:
/// a file being written is never moved. Each file is tried; the first
/// failure is returned.
pub fn settle_leftovers(dirs: &RecordingDirs) -> Result<(), AppError> {
    let mut result = Ok(());
    for (name, path) in super::user_files::list_own_files(&dirs.active, is_recording_name)? {
        if let Err(error) = publish(&path, &dirs.shared.join(&name)) {
            log::warn!("Could not move the recording {name} to the data folder: {error}");
            result = result.and(Err(error));
        }
    }
    result
}

/// The file of the recording `name`: in the data folder, or still in the
/// state folder while it runs.
fn find(dirs: &RecordingDirs, name: &str) -> Option<PathBuf> {
    [dirs.shared.join(name), dirs.active.join(name)]
        .into_iter()
        .find(|path| path.is_file())
}

/// Which of the recordings `names` are there.
pub fn exist(dirs: &RecordingDirs, names: &[String]) -> Vec<bool> {
    names
        .iter()
        .map(|name| is_recording_name(name) && find(dirs, name).is_some())
        .collect()
}

/// The file of the recording `name` to play: a finished one only, as one
/// being written still grows and has no final headers.
pub fn playable_file(dirs: &RecordingDirs, name: &str) -> Result<PathBuf, AppError> {
    let name = checked_name(name)?;
    if WRITING.locked().contains_key(name) {
        return Err(AppError::NotFound("The recording is being written".into()));
    }
    find(dirs, name).ok_or_else(|| AppError::NotFound("The recording file is not found".into()))
}

/// The folder that holds the recording `name`.
pub fn folder_of(dirs: &RecordingDirs, name: &str) -> Result<PathBuf, AppError> {
    let file = find(dirs, checked_name(name)?)
        .ok_or_else(|| AppError::NotFound("The recording file is not found".into()))?;
    Ok(file
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| dirs.shared.clone()))
}

/// The recordings folder of the data folder, created when it is not there.
pub fn shared_folder(dirs: &RecordingDirs) -> Result<PathBuf, AppError> {
    create_private_dir(&dirs.shared)?;
    Ok(dirs.shared.clone())
}

/// Opens the recordings folder of the data folder in the file manager.
pub fn open_folder(app: &AppHandle) -> Result<(), AppError> {
    crate::services::platform::open_dir(&shared_folder(&RecordingDirs::of_app(app)?)?)
}

/// Which of the recordings `names` are there, see `exist`.
pub fn check(app: &AppHandle, names: &[String]) -> Result<Vec<bool>, AppError> {
    Ok(exist(&RecordingDirs::of_app(app)?, names))
}

/// Opens the folder that holds the recording `name` in the file manager.
pub fn show(app: &AppHandle, name: &str) -> Result<(), AppError> {
    crate::services::platform::open_dir(&folder_of(&RecordingDirs::of_app(app)?, name)?)
}

/// Removes the recording `name` wherever it is: in the data folder, and in
/// the state folder, at once when a previous run left it there, once it is
/// closed when it is being written.
fn remove(dirs: &RecordingDirs, name: &str) -> Result<(), AppError> {
    let mut writing = WRITING.locked();
    let path = dirs.shared.join(name);
    ensure_write_allowed(&path)?;
    remove_file_if_present(&path)?;
    if let Some(discard) = writing.get_mut(name) {
        *discard = true;
    } else {
        remove_file_if_present(&dirs.active.join(name))?;
    }
    Ok(())
}

/// Removes the recording `name`, see `remove`.
pub fn discard(dirs: &RecordingDirs, name: &str) -> Result<(), AppError> {
    remove(dirs, checked_name(name)?)
}

/// Removes every recording, also those being written once they are closed:
/// the entries that named them are gone.
pub fn clear(dirs: &RecordingDirs) -> Result<(), AppError> {
    let mut writing = WRITING.locked();
    ensure_write_allowed(&dirs.shared)?;
    for (_, path) in super::user_files::list_own_files(&dirs.shared, is_recording_name)? {
        remove_file_if_present(&path)?;
    }
    for (name, path) in super::user_files::list_own_files(&dirs.active, is_recording_name)? {
        if let Some(discard) = writing.get_mut(&name) {
            *discard = true;
        } else {
            remove_file_if_present(&path)?;
        }
    }
    Ok(())
}

/// Removes the recordings of `expired`, the entries the limits dropped, at
/// once, unless an entry of `live` still names them, and the recordings no
/// entry names after the grace period.
pub fn collect(
    dirs: &RecordingDirs,
    live: &HashSet<String>,
    expired: &HashSet<String>,
    now_ms: u64,
) -> Result<(), AppError> {
    ensure_write_allowed(&dirs.shared)?;
    for name in expired.difference(live) {
        if is_recording_name(name) {
            remove(dirs, name)?;
        }
    }
    let mut record = OrphanRecord::read(&dirs.orphans);
    let before = record.clone();
    record.collect(&dirs.shared, live, now_ms, |name| {
        is_recording_name(name).then(|| name.to_owned())
    })?;
    record.write_if_changed(&dirs.orphans, &before)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::storage::orphan_files::ORPHAN_GRACE_MS;
    use crate::services::test_support::TestDir;

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
    fn a_new_recording_is_written_aside_and_published_into_the_history() {
        let root = TestDir::new("recordings-publish");
        let dirs = RecordingDirs::at(&root);
        let recording = new_recording(&dirs, "2026-11-21 10-00-00").unwrap();
        assert!(is_recording_name(&recording.name));
        assert_eq!(recording.active_path, dirs.active.join(&recording.name));
        write(&recording.active_path);
        assert_eq!(exist(&dirs, std::slice::from_ref(&recording.name)), [true]);
        assert_eq!(folder_of(&dirs, &recording.name).unwrap(), dirs.active);

        publish(&recording.active_path, &recording.shared_path).unwrap();
        assert!(!recording.active_path.exists());
        assert!(recording.shared_path.is_file());
        assert_eq!(folder_of(&dirs, &recording.name).unwrap(), dirs.shared);
        assert!(new_recording(&dirs, "not a time").is_err());
    }

    #[test]
    fn leftovers_of_a_previous_run_move_into_the_history() {
        let root = TestDir::new("recordings-leftovers");
        let dirs = RecordingDirs::at(&root);
        write(&dirs.active.join(NAME));
        write(&dirs.active.join("unknown.opus"));
        settle_leftovers(&dirs).unwrap();
        assert!(dirs.shared.join(NAME).is_file());
        assert!(dirs.active.join("unknown.opus").is_file());
    }

    #[test]
    fn only_recordings_are_checked_shown_or_discarded() {
        let root = TestDir::new("recordings-checked");
        let dirs = RecordingDirs::at(&root);
        write(&dirs.shared.join("notes.txt"));
        assert_eq!(
            exist(&dirs, &["notes.txt".into(), NAME.into()]),
            [false, false]
        );
        assert!(folder_of(&dirs, "../notes.txt").is_err());
        assert!(discard(&dirs, "notes.txt").is_err());
        assert!(dirs.shared.join("notes.txt").exists());
        discard(&dirs, NAME).unwrap();
    }

    #[test]
    fn clearing_removes_the_recordings_and_nothing_else() {
        let root = TestDir::new("recordings-clear");
        let dirs = RecordingDirs::at(&root);
        write(&dirs.shared.join(NAME));
        write(
            &dirs
                .shared
                .join("2026-11-21 10-00-00 a1b2c3.sync-conflict-20261121-100000-ABCDEF.opus"),
        );
        let leftover = "2026-11-21 11-00-00 a1b2c3.opus";
        let running = "2026-11-21 11-00-00 c0ffee.opus";
        write(&dirs.active.join(leftover));
        write(&dirs.active.join(running));
        begin_writing(running);
        clear(&dirs).unwrap();
        assert!(!dirs.shared.join(NAME).exists());
        assert_eq!(fs::read_dir(&dirs.shared).unwrap().count(), 1);
        assert!(!dirs.active.join(leftover).exists());
        // still open: its writer removes it
        assert!(dirs.active.join(running).exists());
        assert!(end_writing(running));
    }

    #[test]
    fn a_recording_discarded_while_written_goes_once_closed() {
        let root = TestDir::new("recordings-discard-running");
        let dirs = RecordingDirs::at(&root);
        let running = "2026-11-21 12-00-00 0d15ca.opus";
        let leftover = "2026-11-21 12-00-00 1eff00.opus";
        write(&dirs.active.join(running));
        write(&dirs.active.join(leftover));
        begin_writing(running);
        discard(&dirs, running).unwrap();
        discard(&dirs, leftover).unwrap();
        assert!(dirs.active.join(running).exists());
        assert!(!dirs.active.join(leftover).exists());
        assert!(end_writing(running));
        // a recording no entry gave up is kept
        begin_writing(running);
        assert!(!end_writing(running));
    }

    #[test]
    fn expired_recordings_go_at_once_and_unknown_ones_after_the_grace_period() {
        let root = TestDir::new("recordings-collect");
        let dirs = RecordingDirs::at(&root);
        let live = "2026-11-21 10-00-00 000001.opus".to_owned();
        let expired = "2026-11-21 10-00-00 000002.opus".to_owned();
        let unknown = "2026-11-21 10-00-00 000003.opus".to_owned();
        for name in [&live, &expired, &unknown] {
            write(&dirs.shared.join(name));
        }
        let live_names = HashSet::from([live.clone()]);
        // an entry of another device may still name what one expired named
        let expired_names = HashSet::from([expired.clone(), live.clone()]);
        collect(&dirs, &live_names, &expired_names, 1_000).unwrap();
        assert!(dirs.shared.join(&live).exists());
        assert!(!dirs.shared.join(&expired).exists());
        assert!(dirs.shared.join(&unknown).exists());

        collect(&dirs, &live_names, &HashSet::new(), 1_000 + ORPHAN_GRACE_MS).unwrap();
        assert!(!dirs.shared.join(&unknown).exists());
        assert!(dirs.shared.join(&live).exists());
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

        let recording = new_recording(&dirs, "2026-11-21 10-00-00").unwrap();
        write(&recording.active_path);
        publish(&recording.active_path, &recording.shared_path).unwrap();
        assert!(elsewhere.join(&recording.name).is_file());
        assert_eq!(exist(&dirs, std::slice::from_ref(&recording.name)), [true]);

        clear(&dirs).unwrap();
        assert!(!elsewhere.join(&recording.name).exists());
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
        write(&dirs.active.join(NAME));
        assert!(settle_leftovers(&dirs).is_err());
        assert!(dirs.active.join(NAME).is_file());
        assert!(!root.join("unmounted").exists());
    }
}
