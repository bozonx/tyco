use std::io;

use super::scoped_io;

use super::reader::read_existing_text;
use super::{
    Access, AiFileChangePreview, AiFileToolOutput, AiFileToolRequest, ProfileFiles, MAX_WRITE_BYTES,
};
use crate::errors::AppError;

impl ProfileFiles {
    pub(super) fn write_file(
        &self,
        path: &str,
        content: &str,
    ) -> Result<AiFileToolOutput, AppError> {
        ensure_write_size(content.len())?;
        let target = self.resolve(path, Access::Write, true)?;
        if target.is_root() {
            return Err(AppError::invalid_input(format!("{path} is a folder")));
        }
        let is_created = match target.directory.metadata(target.relative_path()) {
            Ok(metadata) if metadata.is_dir() => {
                return Err(AppError::invalid_input(format!("{path} is a folder")))
            }
            Ok(_) => false,
            Err(error) if error.kind() == io::ErrorKind::NotFound => true,
            Err(error) => return Err(error.into()),
        };
        let (parent, name) = target.parent(true)?;
        scoped_io::write_file(&parent, name, content.as_bytes(), true)?;
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
        let (parent, name) = target.parent(false)?;
        scoped_io::write_file(&parent, name, after.as_bytes(), true)?;
        Ok(AiFileToolOutput::EditFile {
            path: target.virtual_path(),
            replacement_count,
        })
    }

    pub(super) fn move_path(&self, from: &str, to: &str) -> Result<AiFileToolOutput, AppError> {
        let source = self.resolve(from, Access::Write, false)?;
        let destination = self.resolve(to, Access::Write, false)?;
        if source.is_root() || destination.is_root() {
            return Err(AppError::invalid_input("A root folder cannot be moved"));
        }
        let (source_parent, source_name) = source.parent(false)?;
        let meta = source_parent.symlink_metadata(source_name)?;
        if meta.is_dir() && destination.path.starts_with(&source.path) {
            return Err(AppError::invalid_input(
                "A folder cannot be moved into itself",
            ));
        }
        let (destination_parent, destination_name) = destination.parent(true)?;
        match destination_parent.symlink_metadata(destination_name) {
            Ok(_) => return Err(AppError::invalid_input(format!("{to} already exists"))),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        if let Err(error) = crate::services::platform::filesystem::rename_no_replace(
            &source_parent,
            source_name,
            &destination_parent,
            destination_name,
        ) {
            if error.kind() != io::ErrorKind::CrossesDevices || !meta.is_file() {
                return Err(error.into());
            }
            scoped_io::copy_move(
                &source_parent,
                source_name,
                &destination_parent,
                destination_name,
            )?;
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
                ensure_write_size(content.len())?;
                let target = self.resolve(&path, Access::Write, true)?;
                if target.is_root() {
                    return Err(AppError::invalid_input(format!("{path} is a folder")));
                }
                let before = match target.directory.metadata(target.relative_path()) {
                    Ok(_) => Some(read_existing_text(&target, &path)?),
                    Err(error) if error.kind() == io::ErrorKind::NotFound => None,
                    Err(error) => return Err(error.into()),
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
            _ => Err(AppError::invalid_input(
                "Only a write or an edit has a preview",
            )),
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
        return Err(AppError::invalid_input(
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
    if count > 0 && (count == 1 || replace_all) {
        let result_bytes = count
            .checked_mul(new_text.len())
            .and_then(|added| (text.len() - count * old_text.len()).checked_add(added))
            .ok_or_else(|| AppError::ResourceLimit("The edited file is too large".into()))?;
        ensure_write_size(result_bytes)?;
    }
    match count {
        0 => Err(AppError::invalid_input(
            "old_text was not found in the file: read it again and copy the text exactly",
        )),
        1 => Ok((text.replacen(old_text.as_str(), &new_text, 1), 1)),
        _ if replace_all => Ok((text.replace(old_text.as_str(), &new_text), count)),
        _ => Err(AppError::invalid_input(format!(
            "old_text was found {count} times: add surrounding text to make it unique, or set replaceAll"
        ))),
    }
}

fn ensure_write_size(bytes: usize) -> Result<(), AppError> {
    if bytes > MAX_WRITE_BYTES {
        return Err(AppError::ResourceLimit(format!(
            "The content is larger than {MAX_WRITE_BYTES} bytes"
        )));
    }
    Ok(())
}
