//! Files of the user data folder nothing refers to any more: the images and
//! attachments of chats, the recordings of dialogs. A sync tool may bring a
//! file before the record that refers to it, so a file without a reference is
//! removed only after `ORPHAN_GRACE_MS`, counted from when this device first
//! saw it so. The time of the file is no help: Syncthing and rsync keep the
//! time of the original.
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::Path;

use crate::errors::AppError;

/// How long a file without a reference stays.
pub const ORPHAN_GRACE_MS: u64 = 7 * 24 * 60 * 60 * 1000;

/// When each file without a reference was first seen, by folder and file id.
#[derive(Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(transparent)]
pub struct OrphanRecord(BTreeMap<String, BTreeMap<String, u64>>);

impl OrphanRecord {
    /// The record kept at `path`; a missing or broken one is empty, which
    /// only restarts the grace periods.
    pub fn read(path: &Path) -> Self {
        let mut record: Self = fs::read(path)
            .ok()
            .and_then(|raw| serde_json::from_slice(&raw).ok())
            .unwrap_or_default();
        // a folder that moved away, e.g. with the data folder, leaves its record
        record
            .0
            .retain(|directory, _| Path::new(directory).is_dir());
        record
    }

    /// Writes the record to `path` when it differs from `before`.
    pub fn write_if_changed(&self, path: &Path, before: &Self) -> Result<(), AppError> {
        if self == before {
            return Ok(());
        }
        if let Some(dir) = path.parent() {
            crate::services::atomic_file::create_private_dir(dir)?;
        }
        crate::services::atomic_file::write_private(path, &serde_json::to_string(self)?)
    }

    /// Removes the files of `directory` whose id, read from the name by
    /// `id_of`, is not in `live` and has been without a reference for
    /// `ORPHAN_GRACE_MS`. A file referred to again leaves the record.
    pub fn collect(
        &mut self,
        directory: &Path,
        live: &HashSet<String>,
        now_ms: u64,
        id_of: impl Fn(&str) -> Option<String>,
    ) -> Result<(), AppError> {
        let key = directory.to_string_lossy().into_owned();
        let entries = super::user_files::list_own_files(directory, |name| id_of(name).is_some())?;
        let seen = self.0.entry(key.clone()).or_default();
        let mut present = HashSet::new();
        for (name, path) in entries {
            let Some(id) = id_of(&name) else {
                continue;
            };
            present.insert(id.clone());
            if live.contains(&id) {
                seen.remove(&id);
                continue;
            }
            let first_seen = *seen.entry(id.clone()).or_insert(now_ms);
            if now_ms.saturating_sub(first_seen) >= ORPHAN_GRACE_MS {
                fs::remove_file(&path)?;
                seen.remove(&id);
                present.remove(&id);
            }
        }
        seen.retain(|id, _| present.contains(id));
        if seen.is_empty() {
            self.0.remove(&key);
        }
        Ok(())
    }

    #[cfg(test)]
    pub fn contains(&self, id: &str) -> bool {
        self.0.values().any(|ids| ids.contains_key(id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::test_support::TestDir;

    #[test]
    fn a_file_without_a_reference_goes_after_the_grace_period() {
        let dir = TestDir::new("orphan-files");
        let files = dir.join("files");
        fs::create_dir_all(&files).unwrap();
        fs::write(files.join("a"), b"a").unwrap();
        fs::write(files.join("b"), b"b").unwrap();
        let live = HashSet::from(["b".to_owned()]);
        let id_of = |name: &str| Some(name.to_owned());

        let mut record = OrphanRecord::default();
        record.collect(&files, &live, 1_000, id_of).unwrap();
        assert!(record.contains("a") && !record.contains("b"));
        record
            .collect(&files, &live, 1_000 + ORPHAN_GRACE_MS - 1, id_of)
            .unwrap();
        assert!(files.join("a").exists());
        record
            .collect(&files, &live, 1_000 + ORPHAN_GRACE_MS, id_of)
            .unwrap();
        assert!(!files.join("a").exists() && files.join("b").exists());
        assert!(record == OrphanRecord::default());
    }

    #[test]
    fn a_record_round_trips_and_forgets_missing_folders() {
        let dir = TestDir::new("orphan-files-record");
        let files = dir.join("files");
        fs::create_dir_all(&files).unwrap();
        fs::write(files.join("a"), b"a").unwrap();
        let path = dir.join("state").join("orphans.json");
        let mut record = OrphanRecord::default();
        record
            .collect(&files, &HashSet::new(), 5, |name| Some(name.to_owned()))
            .unwrap();
        record
            .write_if_changed(&path, &OrphanRecord::default())
            .unwrap();
        assert!(OrphanRecord::read(&path).contains("a"));
        fs::remove_dir_all(&files).unwrap();
        assert!(OrphanRecord::read(&path) == OrphanRecord::default());
    }
}
