//! JSON and JSON Lines files of the histories, written privately.
use std::fs;
use std::path::Path;

use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::errors::AppError;
use crate::services::atomic_file::write_private;

pub(super) fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), AppError> {
    write_private(path, &serde_json::to_string_pretty(value)?)
}

pub(super) fn read_jsonl<T: DeserializeOwned>(path: &Path) -> Result<Vec<T>, AppError> {
    if !path.exists() {
        return Ok(Vec::new());
    }

    let raw = fs::read(path)?;
    let mut items = Vec::new();
    let mut damaged = false;
    for (index, line) in raw.split(|byte| *byte == b'\n').enumerate() {
        if line.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        match serde_json::from_slice(line) {
            Ok(parsed) => items.push(parsed),
            Err(error) => {
                damaged = true;
                log::warn!(
                    "Skipping unreadable line {} of {}: {error}",
                    index + 1,
                    path.display()
                );
            }
        }
    }
    if damaged {
        crate::services::atomic_file::preserve_broken_copy(path, &raw)?;
    }
    Ok(items)
}

pub(super) fn write_jsonl<T: Serialize>(path: &Path, items: &[T]) -> Result<(), AppError> {
    let mut raw = String::new();
    for item in items {
        raw.push_str(&serde_json::to_string(item)?);
        raw.push('\n');
    }
    write_private(path, &raw)
}

pub(super) fn remove_file_if_exists(path: &Path) -> Result<(), AppError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::storage::test_support::TestDir;
    use std::path::PathBuf;

    #[test]
    fn jsonl_round_trip_skips_blank_and_broken_lines() {
        let dir = TestDir::new("jsonl");
        let path = dir.join("history.jsonl");

        write_jsonl(&path, &[String::from("first"), String::from("second")]).unwrap();
        let mut raw = fs::read_to_string(&path).unwrap();
        raw.push_str("\n{not json}\n");
        fs::write(&path, raw).unwrap();

        let items: Vec<String> = read_jsonl(&path).unwrap();

        assert_eq!(items, vec![String::from("first"), String::from("second")]);
    }

    #[test]
    fn damaged_jsonl_keeps_exact_bytes_once_before_rewriting() {
        let dir = TestDir::new("jsonl-preservation");
        let path = dir.join("history.jsonl");
        let bytes = b"\"valid\"\n{broken\n\xff\n";
        fs::write(&path, bytes).unwrap();
        let items: Vec<String> = read_jsonl(&path).unwrap();
        assert_eq!(items, vec!["valid"]);
        let _: Vec<String> = read_jsonl(&path).unwrap();
        let backups: Vec<_> = fs::read_dir(path.parent().unwrap())
            .unwrap()
            .flatten()
            .filter(|entry| entry.path() != path)
            .collect();
        assert_eq!(backups.len(), 1);
        assert_eq!(fs::read(backups[0].path()).unwrap(), bytes);
        write_jsonl(&path, &items).unwrap();
        assert_eq!(fs::read(backups[0].path()).unwrap(), bytes);
    }

    #[test]
    fn read_jsonl_returns_empty_for_a_missing_file() {
        let items: Vec<String> = read_jsonl(&PathBuf::from("/nonexistent/history.jsonl")).unwrap();

        assert!(items.is_empty());
    }
}
