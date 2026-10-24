use std::io;

use super::scoped_io;

use super::sandbox::virtual_path;
use super::{Access, ProfileFiles, MAX_UPLOAD_BYTES, WORKSPACE_ROOT};
use crate::errors::AppError;

/// Where the files dropped into a profile chat are kept, inside the workspace.
const UPLOADS_DIR: &str = "uploads";
const MAX_UPLOAD_FILENAME_LENGTH: usize = 120;

impl ProfileFiles {
    /// Keeps a file dropped into the chat in `workspace/uploads/`, under a
    /// name no other upload has; returns the path the model reaches it by.
    pub fn save_upload(&self, name: &str, bytes: &[u8]) -> Result<String, AppError> {
        if bytes.len() > MAX_UPLOAD_BYTES {
            return Err(AppError::ResourceLimit(
                "The file is too large to keep".into(),
            ));
        }
        let uploads = self.resolve(
            &format!("{WORKSPACE_ROOT}/{UPLOADS_DIR}"),
            Access::Write,
            true,
        )?;
        uploads.directory.create_dir_all(uploads.relative_path())?;
        let directory = uploads.directory.open_dir(uploads.relative_path())?;
        let name = upload_file_name(name);
        let (stem, extension) = match name.rsplit_once('.') {
            Some((stem, extension)) if !stem.is_empty() => {
                (stem.to_string(), format!(".{extension}"))
            }
            _ => (name.clone(), String::new()),
        };
        for index in 0..1000 {
            let candidate = if index == 0 {
                name.clone()
            } else {
                format!("{stem} ({index}){extension}")
            };
            let path = uploads.path.join(&candidate);
            match scoped_io::write_file(&directory, candidate.as_ref(), bytes, false) {
                Ok(()) => return Ok(virtual_path(uploads.root, &uploads.root_dir, &path)),
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error.into()),
            }
        }
        Err(AppError::ResourceLimit(
            "Too many uploads with this name".into(),
        ))
    }
}

/// A name for a dropped file that is one plain file name.
fn upload_file_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or_default();
    let cleaned: String = base
        .chars()
        .map(|c| {
            if c.is_control() || ":*?\"<>|".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned.trim().trim_start_matches('.').trim();
    let cleaned: String = cleaned.chars().take(MAX_UPLOAD_FILENAME_LENGTH).collect();
    if cleaned.is_empty() || cleaned.eq_ignore_ascii_case(".git") {
        "file".into()
    } else {
        cleaned
    }
}
