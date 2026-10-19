use std::fs;

use super::reader::read_existing_text;
use super::{
    invalid, Access, AiFileChangePreview, AiFileToolOutput, AiFileToolRequest, ProfileFiles,
    MAX_WRITE_BYTES,
};
use crate::errors::AppError;
use crate::services::atomic_file::write_user_file;

impl ProfileFiles {
    pub(super) fn write_file(
        &self,
        path: &str,
        content: &str,
    ) -> Result<AiFileToolOutput, AppError> {
        if content.len() > MAX_WRITE_BYTES {
            return Err(AppError::ResourceLimit(format!(
                "The content is larger than {MAX_WRITE_BYTES} bytes"
            )));
        }
        let target = self.resolve(path, Access::Write, true)?;
        if target.is_root() || target.path.is_dir() {
            return Err(invalid(format!("{path} is a folder")));
        }
        let is_created = !target.path.exists();
        if let Some(parent) = target.path.parent() {
            fs::create_dir_all(parent)?;
        }
        write_user_file(&target.path, content.as_bytes())?;
        Ok(AiFileToolOutput::WriteFile {
            path: target.virtual_path(),
            is_created,
            bytes: content.len(),
        })
    }

    pub(super) fn edit_file(
        &self,
        path: &str,
        old_text: &str,
        new_text: &str,
        replace_all: bool,
    ) -> Result<AiFileToolOutput, AppError> {
        let target = self.resolve(path, Access::Write, true)?;
        let before = read_existing_text(&target, path)?;
        let (after, replacement_count) = apply_edit(&before, old_text, new_text, replace_all)?;
        write_user_file(&target.path, after.as_bytes())?;
        Ok(AiFileToolOutput::EditFile {
            path: target.virtual_path(),
            replacement_count,
        })
    }

    pub(super) fn move_path(&self, from: &str, to: &str) -> Result<AiFileToolOutput, AppError> {
        let source = self.resolve(from, Access::Write, false)?;
        let destination = self.resolve(to, Access::Write, false)?;
        if source.is_root() || destination.is_root() {
            return Err(invalid("A root folder cannot be moved"));
        }
        let meta = fs::symlink_metadata(&source.path)
            .map_err(|_| invalid(format!("{from} does not exist")))?;
        if fs::symlink_metadata(&destination.path).is_ok() {
            return Err(invalid(format!("{to} already exists")));
        }
        if meta.is_dir() && destination.path.starts_with(&source.path) {
            return Err(invalid("A folder cannot be moved into itself"));
        }
        if let Some(parent) = destination.path.parent() {
            fs::create_dir_all(parent)?;
        }
        if let Err(error) = fs::rename(&source.path, &destination.path) {
            // another file system, e.g. from the workspace to an external project
            if !meta.is_file() {
                return Err(error.into());
            }
            fs::copy(&source.path, &destination.path)?;
            fs::remove_file(&source.path)?;
        }
        Ok(AiFileToolOutput::MovePath {
            from: source.virtual_path(),
            to: destination.virtual_path(),
        })
    }

    /// What a write or an edit would change, without changing anything.
    pub fn preview(&self, request: AiFileToolRequest) -> Result<AiFileChangePreview, AppError> {
        match request {
            AiFileToolRequest::WriteFile { path, content } => {
                let target = self.resolve(&path, Access::Write, true)?;
                let before = if target.path.is_file() {
                    Some(read_existing_text(&target, &path)?)
                } else {
                    None
                };
                Ok(AiFileChangePreview {
                    path: target.virtual_path(),
                    before,
                    after: content,
                })
            }
            AiFileToolRequest::EditFile {
                path,
                old_text,
                new_text,
                replace_all,
            } => {
                let target = self.resolve(&path, Access::Write, true)?;
                let before = read_existing_text(&target, &path)?;
                let (after, _) = apply_edit(&before, &old_text, &new_text, replace_all)?;
                Ok(AiFileChangePreview {
                    path: target.virtual_path(),
                    before: Some(before),
                    after,
                })
            }
            _ => Err(invalid("Only a write or an edit has a preview")),
        }
    }
}

/// The text with `old_text` replaced: exactly once, or everywhere with
/// `replace_all`. Line ends of the file are kept when the model wrote `\n`.
pub(in crate::services::ai_tools) fn apply_edit(
    text: &str,
    old_text: &str,
    new_text: &str,
    replace_all: bool,
) -> Result<(String, usize), AppError> {
    if old_text.is_empty() {
        return Err(invalid(
            "old_text is empty: write the whole file with write_file instead",
        ));
    }
    let (old_text, new_text) =
        if !text.contains(old_text) && text.contains("\r\n") && !old_text.contains("\r\n") {
            (
                old_text.replace('\n', "\r\n"),
                new_text.replace('\n', "\r\n"),
            )
        } else {
            (old_text.to_string(), new_text.to_string())
        };
    let count = text.matches(old_text.as_str()).count();
    match count {
        0 => Err(invalid(
            "old_text was not found in the file: read it again and copy the text exactly",
        )),
        1 => Ok((text.replacen(old_text.as_str(), &new_text, 1), 1)),
        _ if replace_all => Ok((text.replace(old_text.as_str(), &new_text), count)),
        _ => Err(invalid(format!(
            "old_text was found {count} times: add surrounding text to make it unique, or set replaceAll"
        ))),
    }
}
