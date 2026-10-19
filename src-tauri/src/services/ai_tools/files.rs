//! The file tools of a profile's chat. The model reaches the profile's
//! `workspace/` and the projects the profile has permissions for, by paths
//! like `workspace/notes.md` and `projects/<project-id>/src/main.rs`; it never
//! sees, nor names, an absolute path.
//!
//! The webview asks the user about `ask`; here a path is kept inside its root,
//! `deny` is enforced, and the files Tyco owns stay out of reach.

mod reader;
mod sandbox;
mod uploads;
mod writer;

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::file_search;
use crate::errors::AppError;
use crate::services::ai_vault::ProjectAccessMode;

#[cfg(test)]
pub(super) use self::reader::page_lines;
pub(super) use self::sandbox::{is_forbidden, virtual_path, Resolved};
#[cfg(test)]
pub(super) use self::writer::apply_edit;

/// The tool group of the file tools; mirrors FILES_TOOL_GROUP_ID in the webview.
pub const FILES_TOOL_GROUP: &str = "files";
pub const WORKSPACE_ROOT: &str = "workspace";
pub const PROJECTS_ROOT: &str = "projects";

/// Larger files are not read whole: the model searches them instead.
pub const MAX_READ_BYTES: u64 = 10 * 1024 * 1024;
pub const MAX_WRITE_BYTES: usize = 5 * 1024 * 1024;
/// Mirrors MAX_CHAT_FILE_BYTES: a dropped file is kept as it was attached.
pub const MAX_UPLOAD_BYTES: usize = 10 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Access {
    Read,
    Write,
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
    #[serde(skip)]
    pub(super) dir: PathBuf,
    /// An internal project keeps `project.json` at its top.
    #[serde(skip)]
    pub(super) has_project_file: bool,
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
            read,
            write,
            dir: dir.to_path_buf(),
            has_project_file,
        }
    }

    pub(super) fn access(&self, access: Access) -> &ProjectAccessMode {
        match access {
            Access::Read => &self.read,
            Access::Write => &self.write,
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
#[derive(Debug, Clone, Serialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct AiFileChangePreview {
    pub path: String,
    /// None for a file the change creates.
    pub before: Option<String>,
    pub after: String,
}

fn invalid(message: impl Into<String>) -> AppError {
    AppError::InvalidInput(message.into())
}

/// The folders a profile's file tools reach, with its permissions to each.
pub struct ProfileFiles {
    roots: Vec<AiFileRoot>,
}

impl ProfileFiles {
    #[cfg(test)]
    pub(super) fn from_roots(roots: Vec<AiFileRoot>) -> Self {
        Self { roots }
    }

    pub fn roots(&self) -> &[AiFileRoot] {
        &self.roots
    }

    pub fn run(&self, request: AiFileToolRequest) -> Result<AiFileToolOutput, AppError> {
        self.run_with(request, |path| {
            trash::delete(path)
                .map_err(|error| AppError::Message(format!("Could not move to the trash: {error}")))
        })
    }

    /// Runs a call; `remove` takes a deleted path away, to the trash in the app.
    pub(super) fn run_with(
        &self,
        request: AiFileToolRequest,
        remove: impl FnOnce(&Path) -> Result<(), AppError>,
    ) -> Result<AiFileToolOutput, AppError> {
        match request {
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
            } => self.read_file(&path, offset, limit, max_characters),
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
            AiFileToolRequest::WriteFile { path, content } => self.write_file(&path, &content),
            AiFileToolRequest::EditFile {
                path,
                old_text,
                new_text,
                replace_all,
            } => self.edit_file(&path, &old_text, &new_text, replace_all),
            AiFileToolRequest::MovePath { from, to } => self.move_path(&from, &to),
            AiFileToolRequest::DeletePath { path } => {
                let target = self.resolve(&path, Access::Write, false)?;
                if target.is_root() {
                    return Err(invalid("A root folder cannot be deleted"));
                }
                fs::symlink_metadata(&target.path)
                    .map_err(|_| invalid(format!("{path} does not exist")))?;
                let path = target.virtual_path();
                remove(&target.path)?;
                Ok(AiFileToolOutput::DeletePath { path })
            }
        }
    }
}
