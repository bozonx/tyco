//! The file tools of a conversation. The model reaches the files attached to
//! the conversation under `attachments/`, read-only, and in a profile's chat
//! with its file tools on, the profile's `workspace/` and the projects the
//! profile has permissions for, by paths like `workspace/notes.md` and
//! `projects/<project-id>/src/main.rs`; it never sees, nor names, an absolute
//! path. See `dev_docs/chat-files.md`.
//!
//! The webview asks the user about `ask`; here a path is kept inside its root,
//! `deny` is enforced, and the files Tyco owns stay out of reach.

mod attachments;
mod copies;
mod reader;
mod sandbox;
mod scoped_io;
mod writer;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::file_search;
use super::permissions;
use crate::errors::AppError;
use crate::services::ai_workspace::{AiProfile, ProjectAccessMode};

pub use self::attachments::{AiAttachedFile, Attachments, ATTACHMENTS_ROOT};

/// Whether a model path is inside `attachments/`.
pub(super) fn attachment_part_of(path: &str) -> bool {
    attachments::attachment_part(path).is_some()
}
#[cfg(test)]
pub(super) use self::reader::page_lines;
pub(super) use self::reader::page_lines_from;
pub(super) use self::sandbox::{is_forbidden, virtual_path, Resolved};
#[cfg(test)]
pub(super) use self::writer::apply_edit;

pub const WORKSPACE_ROOT: &str = "workspace";
pub const PROJECTS_ROOT: &str = "projects";

/// Larger files are not read whole: the model searches them instead.
pub const MAX_READ_BYTES: u64 = 10 * 1024 * 1024;
pub const MAX_WRITE_BYTES: usize = 5 * 1024 * 1024;
pub use crate::desktop_contract::MAX_CHAT_FILE_BYTES as MAX_UPLOAD_BYTES;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Access {
    Read,
    Write,
    Delete,
}

/// A folder the model may reach, as the profile sees it.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct AiFileRoot {
    /// What the model calls it: `workspace` or `projects/<id>`.
    pub path: String,
    /// The project's name; none for the workspace.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub description: Option<String>,
    pub read: ProjectAccessMode,
    pub write: ProjectAccessMode,
    /// Never freer than `write`.
    pub delete: ProjectAccessMode,
    #[serde(skip)]
    pub(super) dir: PathBuf,
    /// An internal project keeps `project.json` at its top.
    #[serde(skip)]
    pub(super) has_project_file: bool,
    /// Why the folder cannot be reached on this device: an external project
    /// without its folder here.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub unavailable: Option<String>,
}

impl AiFileRoot {
    #[cfg(test)]
    pub(super) fn for_test(
        path: &str,
        dir: &Path,
        read: ProjectAccessMode,
        write: ProjectAccessMode,
        has_project_file: bool,
    ) -> Self {
        Self {
            path: path.into(),
            name: None,
            description: None,
            delete: write.clone(),
            read,
            write,
            dir: dir.to_path_buf(),
            has_project_file,
            unavailable: None,
        }
    }

    pub(super) fn access(&self, access: Access) -> &ProjectAccessMode {
        match access {
            Access::Read => &self.read,
            Access::Write => &self.write,
            Access::Delete => &self.delete,
        }
    }
}

/// One call of a file tool, as the webview sends it.
#[derive(Debug, Clone, Deserialize, PartialEq, ts_rs::TS)]
#[serde(
    tag = "operation",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AiFileToolRequest {
    ListDir {
        /// Empty lists the roots.
        #[serde(default)]
        #[ts(as = "Option<String>", optional)]
        path: String,
        #[ts(optional = nullable)]
        depth: Option<usize>,
        /// A glob on file names, e.g. `*.md`.
        #[ts(optional = nullable)]
        pattern: Option<String>,
    },
    ReadFile {
        path: String,
        /// The first line to read, from 1.
        #[ts(optional = nullable)]
        offset: Option<usize>,
        /// Characters to skip in the first line, from 0 (Unicode scalar values).
        #[ts(optional = nullable)]
        character_offset: Option<usize>,
        /// How many lines to read.
        #[ts(optional = nullable)]
        limit: Option<usize>,
        /// Whole lines are read up to this many characters.
        #[ts(optional = nullable)]
        max_characters: Option<usize>,
    },
    SearchFiles {
        /// Empty searches every root the profile may read.
        #[serde(default)]
        #[ts(as = "Option<String>", optional)]
        path: String,
        /// Text the lines must contain.
        #[ts(optional = nullable)]
        query: Option<String>,
        /// A glob the file names must match.
        #[ts(optional = nullable)]
        name_pattern: Option<String>,
        #[serde(default)]
        #[ts(as = "Option<bool>", optional)]
        is_regex: bool,
    },
    WriteFile {
        path: String,
        content: String,
        #[serde(default)]
        #[ts(as = "Option<bool>", optional)]
        create_only: bool,
    },
    EditFile {
        path: String,
        old_text: String,
        new_text: String,
        #[serde(default)]
        #[ts(as = "Option<bool>", optional)]
        replace_all: bool,
    },
    MovePath {
        from: String,
        to: String,
    },
    DeletePath {
        path: String,
    },
}

impl AiFileToolRequest {
    /// The name the model calls the tool by.
    /// Whether the call only reads the conversation's attachments.
    pub fn reads_attachments(&self) -> bool {
        match self {
            Self::ListDir { path, .. }
            | Self::ReadFile { path, .. }
            | Self::SearchFiles { path, .. } => attachment_part_of(path),
            _ => false,
        }
    }

    pub fn tool_name(&self) -> &'static str {
        match self {
            Self::ListDir { .. } => "list_files",
            Self::ReadFile { .. } => "read_file",
            Self::SearchFiles { .. } => "search_files",
            Self::WriteFile { .. } => "write_file",
            Self::EditFile { .. } => "edit_file",
            Self::MovePath { .. } => "move_path",
            Self::DeletePath { .. } => "delete_path",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
#[ts(rename = "AiFileEntryKind")]
pub enum EntryKind {
    File,
    Dir,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "AiFileEntry")]
pub struct DirEntry {
    /// A folder's path ends with `/`.
    pub path: String,
    pub kind: EntryKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "AiFileSearchMatch")]
pub struct SearchMatch {
    pub path: String,
    /// None when the file matched by its name.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub line: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub text: Option<String>,
}

/// What a file tool did, for the webview to tell the model.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[serde(
    tag = "operation",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AiFileToolOutput {
    ListDir {
        path: String,
        entries: Vec<DirEntry>,
        is_truncated: bool,
    },
    ReadFile {
        path: String,
        content: String,
        start_line: usize,
        end_line: usize,
        total_lines: usize,
        /// The offset to read on from; none at the end of the file.
        #[serde(skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        next_offset: Option<usize>,
        /// Characters to skip when continuing a partially read line.
        #[serde(skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        next_character_offset: Option<usize>,
    },
    /// A PDF or DOCX: the webview reads its text from the bytes.
    ReadDocument {
        path: String,
        media_type: String,
    },
    SearchFiles {
        matches: Vec<SearchMatch>,
        is_truncated: bool,
    },
    WriteFile {
        path: String,
        is_created: bool,
        bytes: usize,
    },
    EditFile {
        path: String,
        replacement_count: usize,
    },
    MovePath {
        from: String,
        to: String,
    },
    DeletePath {
        path: String,
    },
}

/// A change the user is asked about, before it is made.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct AiFileChangePreview {
    pub path: String,
    /// None for a file the change creates.
    pub before: Option<String>,
    pub after: String,
}

/// What the file tools of one conversation reach: its attachments, and the
/// folders of its profile with the permissions to each.
pub struct ConversationFiles<'a> {
    roots: Vec<AiFileRoot>,
    attachments: Attachments<'a>,
    /// Why the profile's folders are out of reach, when they are.
    folders_off: Option<&'static str>,
    /// The profile of a profile chat, whose tool settings each call follows.
    profile: Option<AiProfile>,
    /// The user config, read for the call: the tools switched off everywhere.
    config: Arc<Value>,
}

impl<'a> ConversationFiles<'a> {
    fn new(
        mut roots: Vec<AiFileRoot>,
        attachments: Attachments<'a>,
        folders_off: Option<&'static str>,
    ) -> Self {
        if !attachments.is_empty() {
            roots.insert(0, attachments.root());
        }
        Self {
            roots,
            attachments,
            folders_off,
            profile: None,
            config: Arc::new(Value::Null),
        }
    }

    /// Follows the tools the user config switches off everywhere.
    pub fn with_config(mut self, config: Arc<Value>) -> Self {
        self.config = config;
        self
    }

    pub(super) fn with_profile(mut self, profile: AiProfile) -> Self {
        self.profile = Some(profile);
        self
    }

    #[cfg(test)]
    pub(super) fn from_roots(roots: Vec<AiFileRoot>) -> Self {
        Self::new(roots, Attachments::none(), None)
    }

    #[cfg(test)]
    pub(super) fn with_attachments(roots: Vec<AiFileRoot>, attachments: Attachments<'a>) -> Self {
        Self::new(roots, attachments, None)
    }
}

impl ConversationFiles<'_> {
    pub fn roots(&self) -> &[AiFileRoot] {
        &self.roots
    }

    #[cfg(test)]
    pub fn run(&self, request: AiFileToolRequest) -> Result<AiFileToolOutput, AppError> {
        self.run_reviewed(request, None)
    }

    pub fn run_reviewed(
        &self,
        mut request: AiFileToolRequest,
        preview: Option<AiFileChangePreview>,
    ) -> Result<AiFileToolOutput, AppError> {
        static MUTATIONS: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _guard = matches!(
            &request,
            AiFileToolRequest::WriteFile { .. }
                | AiFileToolRequest::EditFile { .. }
                | AiFileToolRequest::MovePath { .. }
                | AiFileToolRequest::DeletePath { .. }
        )
        .then(|| MUTATIONS.lock().unwrap_or_else(|error| error.into_inner()));
        if let Some(preview) = preview {
            if self.preview(request.clone())? != preview {
                return Err(AppError::invalid_input(
                    "The file changed since approval. Request a new preview.",
                ));
            }
            if let (None, AiFileToolRequest::WriteFile { create_only, .. }) =
                (preview.before, &mut request)
            {
                *create_only = true;
            }
        }
        self.run_with(request, |path| {
            trash::delete(path)
                .map_err(|error| AppError::Failed(format!("Could not move to the trash: {error}")))
        })
    }

    /// Runs a call; `remove` takes a deleted path away, to the trash in the app.
    pub(super) fn run_with(
        &self,
        request: AiFileToolRequest,
        remove: impl FnOnce(&Path) -> Result<(), AppError>,
    ) -> Result<AiFileToolOutput, AppError> {
        self.ensure_tool_allowed(&request)?;
        match &request {
            AiFileToolRequest::WriteFile { path, .. }
            | AiFileToolRequest::EditFile { path, .. }
            | AiFileToolRequest::DeletePath { path } => self.ensure_writable(path)?,
            AiFileToolRequest::MovePath { from, to } => {
                self.ensure_writable(from)?;
                self.ensure_writable(to)?;
            }
            _ => {}
        }
        match request {
            AiFileToolRequest::ListDir { path, pattern, .. }
                if attachments::attachment_part(&path).is_some() =>
            {
                self.list_attachments(&path, pattern.as_deref())
            }
            AiFileToolRequest::ListDir {
                path,
                depth,
                pattern,
            } => self.list_dir(&path, depth, pattern.as_deref()),
            AiFileToolRequest::ReadFile {
                path,
                offset,
                limit,
                max_characters,
                character_offset,
            } if attachments::attachment_part(&path).is_some() => {
                self.read_attachment(&path, offset, limit, max_characters, character_offset)
            }
            AiFileToolRequest::ReadFile {
                path,
                offset,
                limit,
                max_characters,
                character_offset,
            } => self.read_file(&path, offset, limit, max_characters, character_offset),
            AiFileToolRequest::SearchFiles {
                path,
                query,
                name_pattern,
                is_regex,
            } => file_search::search(
                self,
                &path,
                query.as_deref(),
                name_pattern.as_deref(),
                is_regex,
            ),
            AiFileToolRequest::WriteFile {
                path,
                content,
                create_only,
            } => self.write_file(&path, &content, create_only),
            AiFileToolRequest::EditFile {
                path,
                old_text,
                new_text,
                replace_all,
            } => self.edit_file(&path, &old_text, &new_text, replace_all),
            AiFileToolRequest::MovePath { from, to } => self.move_path(&from, &to),
            AiFileToolRequest::DeletePath { path } => {
                let target = self.resolve(&path, Access::Delete, false)?;
                if target.is_root() {
                    return Err(AppError::invalid_input("A root folder cannot be deleted"));
                }
                fs::symlink_metadata(&target.path)
                    .map_err(|_| AppError::invalid_input(format!("{path} does not exist")))?;
                let path = target.virtual_path();
                remove(&target.path)?;
                Ok(AiFileToolOutput::DeletePath { path })
            }
        }
    }
}

impl ConversationFiles<'_> {
    /// Refuses a tool switched off in the settings; the roots decide the
    /// rest. Reading the conversation's attachments is the always-on
    /// `attachments` source, which that switch does not take away.
    pub(super) fn ensure_tool_allowed(&self, request: &AiFileToolRequest) -> Result<(), AppError> {
        if request.reads_attachments() {
            return Ok(());
        }
        permissions::ensure_file_tool_allowed(&self.config, request.tool_name())
    }
}
