use std::fs;
use std::path::Path;

use super::sandbox::Resolved;
use super::{
    invalid, Access, DirEntry, EntryKind, FileToolOutput, ProfileFiles, MAX_READ_BYTES,
    MAX_WRITE_BYTES,
};
use crate::errors::AppError;
use crate::services::ai_tools::file_search;
use crate::services::ai_vault::ProjectAccessMode;

const DEFAULT_READ_LINES: usize = 2000;
/// The bytes looked at to tell a binary file from a text one.
const BINARY_PROBE_BYTES: usize = 8192;

impl ProfileFiles {
    pub(super) fn list_dir(
        &self,
        path: &str,
        depth: Option<usize>,
        pattern: Option<&str>,
    ) -> Result<FileToolOutput, AppError> {
        if path
            .split(['/', '\\'])
            .all(|part| part.is_empty() || part == ".")
        {
            let entries = self
                .roots
                .iter()
                .filter(|root| root.read != ProjectAccessMode::Deny)
                .map(|root| DirEntry {
                    path: format!("{}/", root.path),
                    kind: EntryKind::Dir,
                    size: None,
                })
                .collect();
            return Ok(FileToolOutput::ListDir {
                path: String::new(),
                entries,
                is_truncated: false,
            });
        }
        let target = self.resolve(path, Access::Read, true)?;
        if !target.path.is_dir() {
            return Err(invalid(format!("{path} is not a folder")));
        }
        let (entries, is_truncated) = file_search::list(&target, depth, pattern)?;
        Ok(FileToolOutput::ListDir {
            path: target.virtual_path(),
            entries,
            is_truncated,
        })
    }

    /// Reads an existing file of a root, for the webview to extract a
    /// document's text from.
    pub fn read_bytes(&self, path: &str) -> Result<Vec<u8>, AppError> {
        let target = self.resolve(path, Access::Read, true)?;
        let meta =
            fs::metadata(&target.path).map_err(|_| invalid(format!("{path} does not exist")))?;
        if !meta.is_file() {
            return Err(invalid(format!("{path} is not a file")));
        }
        if meta.len() > MAX_READ_BYTES {
            return Err(AppError::ResourceLimit(format!(
                "{path} is too large to read"
            )));
        }
        Ok(fs::read(&target.path)?)
    }

    pub(super) fn read_file(
        &self,
        path: &str,
        offset: Option<usize>,
        limit: Option<usize>,
        max_characters: Option<usize>,
    ) -> Result<FileToolOutput, AppError> {
        let target = self.resolve(path, Access::Read, true)?;
        let meta =
            fs::metadata(&target.path).map_err(|_| invalid(format!("{path} does not exist")))?;
        if meta.is_dir() {
            return Err(invalid(format!(
                "{path} is a folder: list it with list_dir"
            )));
        }
        if meta.len() > MAX_READ_BYTES {
            return Err(AppError::ResourceLimit(format!(
                "{path} is {} bytes, too large to read: search it with search_files instead",
                meta.len()
            )));
        }
        if let Some(media_type) = document_media_type(&target.path) {
            return Ok(FileToolOutput::ReadDocument {
                path: target.virtual_path(),
                media_type: media_type.into(),
            });
        }
        let text = read_text(&target.path, path)?;
        let page = page_lines(
            &text,
            offset.unwrap_or(1),
            limit.unwrap_or(DEFAULT_READ_LINES),
            max_characters.unwrap_or(usize::MAX),
        )?;
        Ok(FileToolOutput::ReadFile {
            path: target.virtual_path(),
            content: page.content,
            start_line: page.start_line,
            end_line: page.end_line,
            total_lines: page.total_lines,
            next_offset: page.next_offset,
        })
    }
}

fn document_media_type(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_string_lossy().to_ascii_lowercase();
    match extension.as_str() {
        "pdf" => Some("application/pdf"),
        "docx" => Some("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        _ => None,
    }
}

/// The text of a file; a binary one is refused.
fn read_text(path: &Path, shown: &str) -> Result<String, AppError> {
    let bytes = fs::read(path)?;
    if bytes[..bytes.len().min(BINARY_PROBE_BYTES)].contains(&0) {
        return Err(invalid(format!("{shown} is a binary file")));
    }
    let text = match String::from_utf8(bytes) {
        Ok(text) => text,
        Err(error) => String::from_utf8_lossy(error.as_bytes()).into_owned(),
    };
    Ok(text
        .strip_prefix('\u{feff}')
        .map(str::to_string)
        .unwrap_or(text))
}

pub(super) fn read_existing_text(target: &Resolved<'_>, shown: &str) -> Result<String, AppError> {
    let meta =
        fs::metadata(&target.path).map_err(|_| invalid(format!("{shown} does not exist")))?;
    if !meta.is_file() {
        return Err(invalid(format!("{shown} is not a file")));
    }
    if meta.len() > MAX_WRITE_BYTES as u64 {
        return Err(AppError::ResourceLimit(format!(
            "{shown} is too large to edit"
        )));
    }
    read_text(&target.path, shown)
}

pub(in crate::services::ai_tools) struct LinePage {
    pub content: String,
    pub start_line: usize,
    pub end_line: usize,
    pub total_lines: usize,
    pub next_offset: Option<usize>,
}

/// Whole lines from `offset` (from 1), at most `limit` of them and
/// `max_characters` in all; a first line longer than that is cut.
pub(in crate::services::ai_tools) fn page_lines(
    text: &str,
    offset: usize,
    limit: usize,
    max_characters: usize,
) -> Result<LinePage, AppError> {
    let lines: Vec<&str> = text.split_inclusive('\n').collect();
    let total_lines = lines.len();
    let start = offset.max(1) - 1;
    if total_lines == 0 {
        return Ok(LinePage {
            content: String::new(),
            start_line: 0,
            end_line: 0,
            total_lines,
            next_offset: None,
        });
    }
    if start >= total_lines {
        return Err(invalid(format!(
            "Offset {offset} is past the end: the file has {total_lines} lines"
        )));
    }
    let mut content = String::new();
    let mut characters = 0;
    let mut end = start;
    for line in lines.iter().skip(start).take(limit.max(1)) {
        let count = line.chars().count();
        if characters + count > max_characters {
            if end == start {
                content = line.chars().take(max_characters).collect();
                end += 1;
            }
            break;
        }
        content.push_str(line);
        characters += count;
        end += 1;
    }
    Ok(LinePage {
        content,
        start_line: start + 1,
        end_line: end,
        total_lines,
        next_offset: (end < total_lines).then_some(end + 1),
    })
}
