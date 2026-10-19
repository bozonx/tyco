//! The files last dropped onto each window. The webview gets their paths
//! with the drop event and may read only those, never a path of its choosing.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::locks::MutexExt;

#[derive(Default)]
pub struct DroppedFiles(Mutex<HashMap<String, Vec<PathBuf>>>);

impl DroppedFiles {
    /// A new drop replaces what the window was given before.
    pub fn record(&self, window_label: &str, paths: &[PathBuf]) {
        self.0
            .locked()
            .insert(window_label.to_owned(), paths.to_vec());
    }

    pub fn forget(&self, window_label: &str) {
        self.0.locked().remove(window_label);
    }

    pub fn was_dropped(&self, window_label: &str, path: &Path) -> bool {
        self.0
            .locked()
            .get(window_label)
            .is_some_and(|paths| paths.iter().any(|dropped| dropped == path))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_last_drop_onto_the_same_window_is_readable() {
        let files = DroppedFiles::default();
        files.record("main", &[PathBuf::from("/tmp/a.txt")]);
        assert!(files.was_dropped("main", Path::new("/tmp/a.txt")));
        assert!(!files.was_dropped("quick", Path::new("/tmp/a.txt")));
        assert!(!files.was_dropped("main", Path::new("/etc/passwd")));

        files.record("main", &[PathBuf::from("/tmp/b.txt")]);
        assert!(!files.was_dropped("main", Path::new("/tmp/a.txt")));
        files.forget("main");
        assert!(!files.was_dropped("main", Path::new("/tmp/b.txt")));
    }
}
