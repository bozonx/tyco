//! Which names in the user data folder are Tyco's own files. The folder may be
//! synced, and sync tools leave temporary files and conflicting copies next to
//! the files they sync: a conflicting copy of a chat must not be read as a
//! second chat with the same id, nor a copy of a history journal as another
//! device. Every reader of the folder lists files through [`list_own_files`].
//! Resolving the copies is left to a later version; they stay where they are.
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use crate::errors::AppError;
use crate::services::atomic_file::TEMPORARY_FILE_PREFIX;

/// Whether `name` is a temporary file of a sync tool or of Tyco itself.
pub fn is_temporary_name(name: &str) -> bool {
    name.starts_with(TEMPORARY_FILE_PREFIX)
        // Syncthing: `.syncthing.<name>.tmp`, `~syncthing~<name>.tmp`
        || (name.starts_with(".syncthing.") && name.ends_with(".tmp"))
        || name.starts_with("~syncthing~")
        // LibreOffice and other editors, Resilio
        || name.starts_with(".~")
        || name.ends_with(".partial")
        // Nextcloud and ownCloud while downloading
        || name.ends_with(".part")
}

/// The name of the file `name` is a conflicting copy of, when it follows
/// the naming of a known sync tool. A OneDrive copy has no marker of its
/// own, so it counts only when the file it would copy is among `siblings`.
pub fn conflict_original(name: &str, siblings: &HashSet<String>) -> Option<String> {
    let (stem, extension) = split_extension(name);
    // Syncthing: `<stem>.sync-conflict-<date>-<time>-<device><.ext>`
    if let Some(index) = stem.find(".sync-conflict-") {
        return Some(format!("{}{extension}", &stem[..index]));
    }
    // Dropbox: `<stem> (<user>'s conflicted copy <date>)<.ext>`; Nextcloud
    // and ownCloud: `<stem> (conflicted copy <date> <time>)<.ext>`
    if stem.ends_with(')') {
        if let Some(index) = stem.rfind(" (") {
            if stem[index..].to_lowercase().contains("conflicted copy") {
                return Some(format!("{}{extension}", &stem[..index]));
            }
        }
    }
    // Nextcloud: `<stem>_conflict-<date>-<time><.ext>`
    if let Some(index) = stem.find("_conflict-") {
        return Some(format!("{}{extension}", &stem[..index]));
    }
    // OneDrive: `<stem>-<COMPUTER NAME><.ext>`, or `…-<COMPUTER NAME>-<n>`
    for (index, _) in stem.match_indices('-') {
        let suffix = &stem[index + 1..];
        let is_computer_name = !suffix.is_empty()
            && suffix
                .chars()
                .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '-')
            && suffix.chars().any(|c| c.is_ascii_uppercase());
        let original = format!("{}{extension}", &stem[..index]);
        if is_computer_name && index > 0 && siblings.contains(&original) {
            return Some(original);
        }
    }
    None
}

/// `("name", ".ext")`; a name without an extension, or a hidden one without
/// another dot, has an empty one.
fn split_extension(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(index) if index > 0 => (&name[..index], &name[index..]),
        _ => (name, ""),
    }
}

/// Whether `name` is neither a temporary file nor a conflicting copy.
fn is_own_name(name: &str, siblings: &HashSet<String>) -> bool {
    !is_temporary_name(name) && conflict_original(name, siblings).is_none()
}

/// The regular files of `dir` whose names `accept` takes, skipping temporary
/// files and conflicting copies; none when the folder does not exist.
/// Sorted by name, so that every reader sees them in the same order.
pub fn list_own_files(
    dir: &Path,
    accept: impl Fn(&str) -> bool,
) -> Result<Vec<(String, PathBuf)>, AppError> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    let mut names = Vec::new();
    for entry in entries {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        // a name that is not UTF-8 is none of ours
        if let Ok(name) = entry.file_name().into_string() {
            names.push(name);
        }
    }
    let siblings: HashSet<String> = names.iter().cloned().collect();
    let mut files: Vec<(String, PathBuf)> = names
        .into_iter()
        .filter(|name| is_own_name(name, &siblings) && accept(name))
        .map(|name| {
            let path = dir.join(&name);
            (name, path)
        })
        .collect();
    files.sort();
    Ok(files)
}

/// Whether a sync tool left a conflicting copy of `path` next to it.
pub fn has_conflict_copy(path: &Path) -> bool {
    let (Some(dir), Some(name)) = (path.parent(), path.file_name().and_then(|n| n.to_str())) else {
        return false;
    };
    let Ok(entries) = fs::read_dir(dir) else {
        return false;
    };
    let names: HashSet<String> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect();
    names
        .iter()
        .any(|copy| copy != name && conflict_original(copy, &names).as_deref() == Some(name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::test_support::TestDir;

    fn siblings(names: &[&str]) -> HashSet<String> {
        names.iter().map(|name| name.to_string()).collect()
    }

    #[test]
    fn recognizes_the_conflicting_copies_of_every_sync_tool() {
        let none = siblings(&[]);
        for (copy, original) in [
            (
                "config.sync-conflict-20261101-120000-ABCDEFG.json",
                "config.json",
            ),
            (
                "0b7d.sync-conflict-20261101-120000-ABCDEFG.jsonl",
                "0b7d.jsonl",
            ),
            (
                "chat-1 (Ivan's conflicted copy 2026-11-01).json",
                "chat-1.json",
            ),
            (
                "config (conflicted copy 2026-11-01 120000).json",
                "config.json",
            ),
            ("config_conflict-20261101-120000.json", "config.json"),
        ] {
            assert_eq!(
                conflict_original(copy, &none).as_deref(),
                Some(original),
                "{copy}"
            );
        }
    }

    #[test]
    fn a_onedrive_copy_counts_only_next_to_its_original() {
        let with_original = siblings(&["chat-1.json", "chat-1-DESKTOP-AB12.json"]);
        assert_eq!(
            conflict_original("chat-1-DESKTOP-AB12.json", &with_original).as_deref(),
            Some("chat-1.json")
        );
        assert_eq!(
            conflict_original("chat-1-DESKTOP-AB12-2.json", &with_original).as_deref(),
            Some("chat-1.json")
        );
        let alone = siblings(&["chat-1-DESKTOP-AB12.json"]);
        assert_eq!(conflict_original("chat-1-DESKTOP-AB12.json", &alone), None);
        // lowercase parts are ids, not computer names
        let ids = siblings(&["chat.json", "chat-2.json"]);
        assert_eq!(conflict_original("chat-2.json", &ids), None);
    }

    #[test]
    fn recognizes_temporary_files() {
        for name in [
            ".tyco-tmp-config.json-1-2",
            ".syncthing.config.json.tmp",
            "~syncthing~config.json.tmp",
            ".~lock.config.json#",
            "chat.json.partial",
            "chat.json.part",
        ] {
            assert!(is_temporary_name(name), "{name}");
        }
        assert!(!is_temporary_name("config.json"));
    }

    #[test]
    fn lists_only_own_files() {
        let dir = TestDir::new("user-files");
        for name in [
            "a.json",
            "b.json",
            "b-LAPTOP.json",
            "a.sync-conflict-20261101-120000-XYZ.json",
            ".tyco-tmp-a.json-1-1",
            "notes.txt",
        ] {
            fs::write(dir.join(name), "{}").unwrap();
        }
        fs::create_dir(dir.join("c.json")).unwrap();
        let files = list_own_files(&dir, |name| name.ends_with(".json")).unwrap();
        let names: Vec<_> = files.iter().map(|(name, _)| name.as_str()).collect();
        assert_eq!(names, ["a.json", "b.json"]);
        assert!(list_own_files(&dir.join("missing"), |_| true)
            .unwrap()
            .is_empty());
        assert!(has_conflict_copy(&dir.join("a.json")));
        assert!(has_conflict_copy(&dir.join("b.json")));
        fs::write(dir.join("c.txt"), "").unwrap();
        assert!(!has_conflict_copy(&dir.join("c.txt")));
    }
}
