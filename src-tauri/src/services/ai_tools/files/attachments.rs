//! `attachments/`: the originals of the files attached to the conversation,
//! read-only. They live in the conversation's file store rather than in a
//! folder, so they are read by id, never by a path on disk.

use std::collections::HashSet;

use serde::Deserialize;

use super::reader::{document_media_type, text_of, DEFAULT_READ_LINES};
use super::{
    page_lines_from, AiFileRoot, AiFileToolOutput, ConversationFiles, DirEntry, EntryKind,
    MAX_READ_BYTES,
};
use crate::errors::AppError;
use crate::services::ai_vault::ProjectAccessMode;

pub const ATTACHMENTS_ROOT: &str = "attachments";
const MAX_NAME_LENGTH: usize = 255;

/// A file attached to the conversation, as the webview names it.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct AiAttachedFile {
    /// The file name the model reaches it by, unique in the conversation.
    pub name: String,
    /// The id of the original in the conversation's file store.
    pub id: String,
}

/// Reads an original by its id.
pub type ReadAttachment<'a> = Box<dyn Fn(&str) -> Result<Vec<u8>, AppError> + 'a>;

/// The attachments of one conversation and how to read them.
pub struct Attachments<'a> {
    files: Vec<AiAttachedFile>,
    read: ReadAttachment<'a>,
}

impl<'a> Attachments<'a> {
    /// Checks that every name is one plain, unique file name.
    pub fn new(files: Vec<AiAttachedFile>, read: ReadAttachment<'a>) -> Result<Self, AppError> {
        let mut names = HashSet::new();
        for file in &files {
            crate::services::chat_images::validate_id(&file.id)?;
            let name = file.name.as_str();
            if name.is_empty()
                || name.chars().count() > MAX_NAME_LENGTH
                || name == "."
                || name == ".."
                || name.contains(['/', '\\'])
                || name.chars().any(char::is_control)
                || !names.insert(name.to_lowercase())
            {
                return Err(AppError::invalid_input(format!(
                    "Invalid attachment name {name}"
                )));
            }
        }
        Ok(Self { files, read })
    }

    pub fn none() -> Self {
        Self {
            files: Vec::new(),
            read: Box::new(|_| Err(AppError::invalid_input("The chat has no attachments"))),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.files.is_empty()
    }

    /// The root the model sees them under.
    pub(super) fn root(&self) -> AiFileRoot {
        AiFileRoot {
            path: ATTACHMENTS_ROOT.into(),
            name: None,
            description: Some("Files attached to this conversation, read-only".into()),
            read: ProjectAccessMode::Allow,
            write: ProjectAccessMode::Deny,
            dir: Default::default(),
            has_project_file: false,
            unavailable: None,
        }
    }
}

/// The rest of a model path inside `attachments/`; none for other paths.
pub(super) fn attachment_part(path: &str) -> Option<Vec<&str>> {
    let mut parts = path
        .split(['/', '\\'])
        .filter(|part| !part.is_empty() && *part != ".");
    (parts.next() == Some(ATTACHMENTS_ROOT)).then(|| parts.collect())
}

fn shown(name: &str) -> String {
    format!("{ATTACHMENTS_ROOT}/{name}")
}

fn read_only() -> AppError {
    AppError::invalid_input(
        "attachments/ is read-only: write a copy into workspace/ to change a file",
    )
}

impl ConversationFiles<'_> {
    fn attached(&self, path: &str) -> Result<&AiAttachedFile, AppError> {
        let parts = attachment_part(path).unwrap_or_default();
        let [name] = parts.as_slice() else {
            return Err(AppError::invalid_input(format!("{path} is not a file")));
        };
        self.attachments
            .files
            .iter()
            .find(|file| file.name == *name)
            .ok_or_else(|| AppError::invalid_input(format!("{path} does not exist")))
    }

    pub(super) fn attachment_bytes(&self, path: &str) -> Result<Vec<u8>, AppError> {
        let file = self.attached(path)?;
        let bytes = (self.attachments.read)(&file.id)?;
        if bytes.len() as u64 > MAX_READ_BYTES {
            return Err(AppError::ResourceLimit(format!(
                "{path} is too large to read"
            )));
        }
        Ok(bytes)
    }

    /// Fails for a change inside `attachments/`.
    pub(super) fn ensure_writable(&self, path: &str) -> Result<(), AppError> {
        match attachment_part(path) {
            Some(_) => Err(read_only()),
            None => Ok(()),
        }
    }

    pub(super) fn list_attachments(
        &self,
        path: &str,
        pattern: Option<&str>,
    ) -> Result<AiFileToolOutput, AppError> {
        if !attachment_part(path).unwrap_or_default().is_empty() {
            return Err(AppError::invalid_input(format!("{path} is not a folder")));
        }
        let matcher = pattern
            .filter(|pattern| !pattern.is_empty())
            .map(super::super::file_search::glob)
            .transpose()?;
        let entries = self
            .attachments
            .files
            .iter()
            .filter(|file| {
                matcher
                    .as_ref()
                    .is_none_or(|matcher| matcher.is_match(&file.name))
            })
            .map(|file| DirEntry {
                path: shown(&file.name),
                kind: EntryKind::File,
                size: (self.attachments.read)(&file.id)
                    .ok()
                    .map(|bytes| bytes.len() as u64),
            })
            .collect();
        Ok(AiFileToolOutput::ListDir {
            path: ATTACHMENTS_ROOT.into(),
            entries,
            is_truncated: false,
        })
    }

    pub(super) fn read_attachment(
        &self,
        path: &str,
        offset: Option<usize>,
        limit: Option<usize>,
        max_characters: Option<usize>,
        character_offset: Option<usize>,
    ) -> Result<AiFileToolOutput, AppError> {
        let file = self.attached(path)?;
        let shown = shown(&file.name);
        if let Some(media_type) = document_media_type(std::path::Path::new(&file.name)) {
            return Ok(AiFileToolOutput::ReadDocument {
                path: shown,
                media_type: media_type.into(),
            });
        }
        let text = text_of(self.attachment_bytes(path)?, &shown)?;
        let page = page_lines_from(
            &text,
            offset.unwrap_or(1),
            limit.unwrap_or(DEFAULT_READ_LINES),
            max_characters.unwrap_or(usize::MAX),
            character_offset.unwrap_or(0),
        )?;
        Ok(AiFileToolOutput::ReadFile {
            path: shown,
            content: page.content,
            start_line: page.start_line,
            end_line: page.end_line,
            total_lines: page.total_lines,
            next_offset: page.next_offset,
            next_character_offset: page.next_character_offset,
        })
    }

    /// The attachments a search looks in: every one for the root, or the
    /// one `path` names, with their model paths and bytes.
    pub(in crate::services::ai_tools) fn searched_attachments(
        &self,
        path: &str,
    ) -> Result<Vec<(String, Vec<u8>)>, AppError> {
        let selected: Vec<&AiAttachedFile> = match attachment_part(path) {
            Some(parts) if parts.is_empty() => self.attachments.files.iter().collect(),
            Some(_) => vec![self.attached(path)?],
            None => self.attachments.files.iter().collect(),
        };
        Ok(selected
            .into_iter()
            .filter_map(|file| {
                let bytes = (self.attachments.read)(&file.id)
                    .inspect_err(|error| {
                        log::debug!("Skipping attachment {} in a search: {error}", file.name)
                    })
                    .ok()?;
                Some((shown(&file.name), bytes))
            })
            .collect())
    }
}
