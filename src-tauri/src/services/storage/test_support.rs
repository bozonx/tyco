use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use crate::models::{EditorHistoryKind, EditorHistoryRecord};

pub(super) struct TestDir(PathBuf);

impl TestDir {
    pub(super) fn new(label: &str) -> Self {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        loop {
            let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "tyco-storage-test-{label}-{}-{unique}",
                std::process::id()
            ));
            match std::fs::create_dir(&path) {
                Ok(()) => return Self(path),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => panic!("Failed to create test directory: {error}"),
            }
        }
    }
}

impl std::ops::Deref for TestDir {
    type Target = Path;

    fn deref(&self) -> &Path {
        &self.0
    }
}

impl AsRef<Path> for TestDir {
    fn as_ref(&self) -> &Path {
        &self.0
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

pub(super) fn history_item(id: &str, text: &str, kind: EditorHistoryKind) -> EditorHistoryRecord {
    EditorHistoryRecord {
        id: id.to_owned(),
        text: text.to_owned(),
        kind,
        operation: None,
        created_at: 1,
        result: None,
        sent: false,
    }
}

pub(super) fn history_texts(history: &[EditorHistoryRecord]) -> Vec<&str> {
    history.iter().map(|item| item.text.as_str()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_labels_get_independent_directories_and_drop_removes_them() {
        let first = TestDir::new("isolation");
        let second = TestDir::new("isolation");
        let first_path = first.to_path_buf();
        let second_path = second.to_path_buf();
        assert_ne!(first_path, second_path);
        std::fs::write(first.join("marker"), "private").unwrap();
        drop(first);
        assert!(!first_path.exists());
        assert!(second_path.is_dir());
        drop(second);
        assert!(!second_path.exists());
    }
}
