//! The files of the memory-only histories ("While TyCo is running"): images
//! and attachment originals of the session chats and the call recordings of
//! the session dialogs. They live in a folder of this run, see
//! `platform::session_files`, removed at quit and at the next start.
//! Images and attachments are named by their hash, like on disk, so the
//! folder serves every chat scope at once.
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use tauri::AppHandle;

use super::recordings::RecordingDirs;
use crate::errors::AppError;

#[derive(Clone, Debug)]
pub struct SessionFiles {
    root: PathBuf,
}

impl SessionFiles {
    pub fn of_app(app: &AppHandle) -> Self {
        Self::at(
            crate::services::platform::session_files::session_files_root(&app.config().identifier),
        )
    }

    pub fn at(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn chat_images(&self) -> PathBuf {
        self.root.join("chats").join("images")
    }

    pub fn chat_attachments(&self) -> PathBuf {
        self.root.join("chats").join("attachments")
    }

    /// Where the session dialogs keep their recordings, finished and running.
    pub fn recordings(&self) -> RecordingDirs {
        RecordingDirs::in_folders(self.root.join("recordings"), &self.root.join("state"))
    }

    /// Removes every file of the session.
    pub fn clear(&self) -> Result<(), AppError> {
        match fs::remove_dir_all(&self.root) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.into()),
            _ => Ok(()),
        }
    }

    /// Removes the images and attachments no session chat refers to any more,
    /// `kept` being the ids of those still referred to.
    pub fn prune_chat_files(&self, kept: &HashSet<String>) -> Result<(), AppError> {
        for dir in [self.chat_images(), self.chat_attachments()] {
            prune_dir(&dir, kept)?;
        }
        Ok(())
    }
}

fn prune_dir(dir: &Path, kept: &HashSet<String>) -> Result<(), AppError> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    for entry in entries {
        let path = entry?.path();
        // an image is `<id>.<extension>`, an attachment `<id>`
        let id = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or_default();
        if path.is_file() && !kept.contains(id) {
            fs::remove_file(&path)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::storage::test_support::TestDir;

    #[test]
    fn prunes_what_no_chat_refers_to_and_clears_everything() {
        let dir = TestDir::new("session-files");
        let files = SessionFiles::at(dir.join("session"));
        fs::create_dir_all(files.chat_images()).unwrap();
        fs::create_dir_all(files.chat_attachments()).unwrap();
        fs::write(files.chat_images().join("kept.webp"), b"a").unwrap();
        fs::write(files.chat_images().join("gone.webp"), b"b").unwrap();
        fs::write(files.chat_attachments().join("gone"), b"c").unwrap();

        files
            .prune_chat_files(&HashSet::from(["kept".to_string()]))
            .unwrap();
        assert!(files.chat_images().join("kept.webp").exists());
        assert!(!files.chat_images().join("gone.webp").exists());
        assert!(!files.chat_attachments().join("gone").exists());

        files.clear().unwrap();
        assert!(!dir.join("session").exists());
        files.clear().unwrap();
    }
}
