use std::fs;

use super::sandbox::virtual_path;
use super::{Access, ProfileFiles, MAX_UPLOAD_BYTES, WORKSPACE_ROOT};
use crate::errors::AppError;
use crate::services::atomic_file::write_user_file;

/// Where the files dropped into a profile chat are kept, inside the workspace.
const UPLOADS_DIR: &str = "uploads";

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
        fs::create_dir_all(&uploads.path)?;
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
            if fs::symlink_metadata(&path).is_ok() {
                continue;
            }
            write_user_file(&path, bytes)?;
            return Ok(virtual_path(uploads.root, &uploads.root_dir, &path));
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
    let cleaned: String = cleaned.chars().take(120).collect();
    if cleaned.is_empty() || cleaned.eq_ignore_ascii_case(".git") {
        "file".into()
    } else {
        cleaned
    }
}
