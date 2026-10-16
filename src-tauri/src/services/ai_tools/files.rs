//! The file tools of a profile's chat. The model reaches the profile's
//! `workspace/` and the projects the profile has permissions for, by paths
//! like `workspace/notes.md` and `projects/<project-id>/src/main.rs`; it never
//! sees, nor names, an absolute path.
//!
//! The webview asks the user about `ask`; here a path is kept inside its root,
//! `deny` is enforced, and the files Tyco owns stay out of reach.

use std::ffi::OsString;
use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::file_search;
use crate::errors::AppError;
use crate::services::ai_vault::{self, AiProfile, ProjectAccessMode};
use crate::services::atomic_file::write_user_file;

/// The tool group of the file tools; mirrors FILES_TOOL_GROUP_ID in the webview.
pub const FILES_TOOL_GROUP: &str = "files";
pub const WORKSPACE_ROOT: &str = "workspace";
pub const PROJECTS_ROOT: &str = "projects";
/// Where the files dropped into a profile chat are kept, inside the workspace.
const UPLOADS_DIR: &str = "uploads";

/// Larger files are not read whole: the model searches them instead.
pub const MAX_READ_BYTES: u64 = 10 * 1024 * 1024;
pub const MAX_WRITE_BYTES: usize = 5 * 1024 * 1024;
/// Mirrors MAX_CHAT_FILE_BYTES: a dropped file is kept as it was attached.
pub const MAX_UPLOAD_BYTES: usize = 10 * 1024 * 1024;
const DEFAULT_READ_LINES: usize = 2000;
/// The bytes looked at to tell a binary file from a text one.
const BINARY_PROBE_BYTES: usize = 8192;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Access {
    Read,
    Write,
}

/// A folder the model may reach, as the profile sees it.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileRoot {
    /// What the model calls it: `workspace` or `projects/<id>`.
    pub path: String,
    /// The project's name; none for the workspace.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub read: ProjectAccessMode,
    pub write: ProjectAccessMode,
    #[serde(skip)]
    pub(super) dir: PathBuf,
    /// An internal project keeps `project.json` at its top.
    #[serde(skip)]
    pub(super) has_project_file: bool,
}

impl FileRoot {
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

    fn access(&self, access: Access) -> &ProjectAccessMode {
        match access {
            Access::Read => &self.read,
            Access::Write => &self.write,
        }
    }
}

/// One call of a file tool, as the webview sends it.
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(
    tag = "operation",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum FileToolRequest {
    ListDir {
        /// Empty lists the roots.
        #[serde(default)]
        path: String,
        depth: Option<usize>,
        /// A glob on file names, e.g. `*.md`.
        pattern: Option<String>,
    },
    ReadFile {
        path: String,
        /// The first line to read, from 1.
        offset: Option<usize>,
        /// How many lines to read.
        limit: Option<usize>,
        /// Whole lines are read up to this many characters.
        max_characters: Option<usize>,
    },
    SearchFiles {
        /// Empty searches every root the profile may read.
        #[serde(default)]
        path: String,
        /// Text the lines must contain.
        query: Option<String>,
        /// A glob the file names must match.
        name_pattern: Option<String>,
        #[serde(default)]
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

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    File,
    Dir,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    /// A folder's path ends with `/`.
    pub path: String,
    pub kind: EntryKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub path: String,
    /// None when the file matched by its name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

/// What a file tool did, for the webview to tell the model.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(
    tag = "operation",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum FileToolOutput {
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
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileChangePreview {
    pub path: String,
    /// None for a file the change creates.
    pub before: Option<String>,
    pub after: String,
}

fn invalid(message: impl Into<String>) -> AppError {
    AppError::InvalidInput(message.into())
}

/// A path resolved inside one of the roots.
pub(super) struct Resolved<'a> {
    pub root: &'a FileRoot,
    /// The canonical folder of the root.
    pub root_dir: PathBuf,
    /// Where on disk.
    pub path: PathBuf,
}

impl Resolved<'_> {
    /// The path as the model knows it.
    pub fn virtual_path(&self) -> String {
        virtual_path(self.root, &self.root_dir, &self.path)
    }

    fn is_root(&self) -> bool {
        self.path == self.root_dir
    }
}

/// The model's path of a file on disk inside the root.
pub(super) fn virtual_path(root: &FileRoot, root_dir: &Path, path: &Path) -> String {
    let relative = path.strip_prefix(root_dir).unwrap_or(path);
    let mut text = root.path.clone();
    for component in relative.components() {
        text.push('/');
        text.push_str(&component.as_os_str().to_string_lossy());
    }
    text
}

/// Whether a path inside a root is one of the files Tyco or git own.
pub(super) fn is_forbidden(root: &FileRoot, relative: &Path) -> bool {
    let mut components = relative.components().peekable();
    let mut is_top = true;
    while let Some(component) = components.next() {
        let name = component.as_os_str().to_string_lossy();
        if name.eq_ignore_ascii_case(".git") {
            return true;
        }
        if is_top
            && components.peek().is_none()
            && root.has_project_file
            && name.eq_ignore_ascii_case(ai_vault::PROJECT_FILE)
        {
            return true;
        }
        is_top = false;
    }
    false
}

/// The canonical form of a path whose end may not exist yet: the deepest
/// existing ancestor is resolved, the rest is plain names.
fn canonical_prefix(path: &Path) -> Result<PathBuf, AppError> {
    let mut existing = path.to_path_buf();
    let mut missing: Vec<OsString> = Vec::new();
    loop {
        match fs::canonicalize(&existing) {
            Ok(canonical) => {
                return Ok(missing
                    .iter()
                    .rev()
                    .fold(canonical, |path, name| path.join(name)))
            }
            // there is an entry, but it leads nowhere: a broken link
            Err(_) if fs::symlink_metadata(&existing).is_ok() => {
                return Err(invalid("The path goes through a broken link"))
            }
            Err(_) => {
                let name = existing
                    .file_name()
                    .ok_or_else(|| invalid("The folder is unavailable"))?
                    .to_os_string();
                missing.push(name);
                if !existing.pop() {
                    return Err(invalid("The folder is unavailable"));
                }
            }
        }
    }
}

/// The folders a profile's file tools reach, with its permissions to each.
pub struct ProfileFiles {
    roots: Vec<FileRoot>,
}

impl ProfileFiles {
    /// The profile's roots as they are on disk now. A profile whose file tools
    /// are off reaches none.
    pub fn load(vault_root: &Path, profile_id: &str) -> Result<Self, AppError> {
        let profile = ai_vault::get_profile(vault_root, profile_id)?;
        ensure_files_enabled(&profile)?;
        let mut roots = vec![FileRoot {
            path: WORKSPACE_ROOT.into(),
            name: None,
            description: None,
            read: ProjectAccessMode::Allow,
            write: ProjectAccessMode::Allow,
            dir: ai_vault::profile_workspace_dir(vault_root, profile_id)?,
            has_project_file: false,
        }];
        for project in ai_vault::list_projects(vault_root)? {
            let Some(permission) = profile.project_permissions.get(&project.id) else {
                continue;
            };
            if permission.read == ProjectAccessMode::Deny
                && permission.write == ProjectAccessMode::Deny
            {
                continue;
            }
            let dir = match ai_vault::project_files_dir(vault_root, &project) {
                Ok(dir) => dir,
                Err(error) => {
                    log::warn!("Skipping the files of project {}: {error}", project.id);
                    continue;
                }
            };
            roots.push(FileRoot {
                path: format!("{PROJECTS_ROOT}/{}", project.id),
                name: Some(project.name.clone()),
                description: project
                    .description
                    .clone()
                    .filter(|text| !text.trim().is_empty()),
                read: permission.read.clone(),
                write: permission.write.clone(),
                dir,
                has_project_file: !project.is_external,
            });
        }
        Ok(Self { roots })
    }

    #[cfg(test)]
    pub(super) fn from_roots(roots: Vec<FileRoot>) -> Self {
        Self { roots }
    }

    pub fn roots(&self) -> &[FileRoot] {
        &self.roots
    }

    /// The root a path starts with and the rest of it, checked to be plain
    /// names inside the root.
    fn locate(&self, path: &str) -> Result<(&FileRoot, PathBuf), AppError> {
        let mut parts = Vec::new();
        for part in path.split(['/', '\\']) {
            match part {
                "" | "." => continue,
                ".." => return Err(invalid("A path may not go up with ..")),
                _ => parts.push(part),
            }
        }
        let (root, rest) = match parts.as_slice() {
            [] => {
                return Err(invalid(
                    "Name a path inside workspace/ or projects/<project-id>/",
                ))
            }
            [WORKSPACE_ROOT, rest @ ..] => (self.find_root(WORKSPACE_ROOT)?, rest),
            [PROJECTS_ROOT, id, rest @ ..] => {
                (self.find_root(&format!("{PROJECTS_ROOT}/{id}"))?, rest)
            }
            _ => {
                return Err(invalid(format!(
                    "Unknown path {path}: paths start with workspace/ or projects/<project-id>/"
                )))
            }
        };
        let relative: PathBuf = rest.iter().collect();
        if !relative
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
        {
            return Err(invalid(format!("Invalid path {path}")));
        }
        Ok((root, relative))
    }

    fn find_root(&self, path: &str) -> Result<&FileRoot, AppError> {
        self.roots
            .iter()
            .find(|root| root.path == path)
            .ok_or_else(|| invalid(format!("The profile has no access to {path}")))
    }

    /// Where a path is on disk, kept inside its root.
    ///
    /// `follow` resolves a link at the end of the path, for an operation on
    /// what it points to; without it the link itself is moved or deleted.
    pub(super) fn resolve(
        &self,
        path: &str,
        access: Access,
        follow: bool,
    ) -> Result<Resolved<'_>, AppError> {
        let (root, relative) = self.locate(path)?;
        if *root.access(access) == ProjectAccessMode::Deny {
            return Err(invalid(format!(
                "The profile may not {} {}",
                match access {
                    Access::Read => "read",
                    Access::Write => "change",
                },
                root.path
            )));
        }
        if is_forbidden(root, &relative) {
            return Err(invalid(format!("{path} is not available to tools")));
        }
        let root_dir = fs::canonicalize(&root.dir).map_err(|error| {
            invalid(format!(
                "The folder of {} is unavailable: {error}",
                root.path
            ))
        })?;
        let mut real = match (relative.parent(), relative.file_name()) {
            (Some(parent), Some(name)) => canonical_prefix(&root_dir.join(parent))?.join(name),
            _ => root_dir.clone(),
        };
        if follow && fs::symlink_metadata(&real).is_ok_and(|meta| meta.file_type().is_symlink()) {
            real =
                fs::canonicalize(&real).map_err(|_| invalid(format!("{path} is a broken link")))?;
        }
        let inside = real
            .strip_prefix(&root_dir)
            .map_err(|_| invalid(format!("{path} leads outside of {}", root.path)))?;
        if is_forbidden(root, inside) {
            return Err(invalid(format!("{path} is not available to tools")));
        }
        Ok(Resolved {
            root,
            root_dir,
            path: real,
        })
    }

    pub fn run(&self, request: FileToolRequest) -> Result<FileToolOutput, AppError> {
        self.run_with(request, |path| {
            trash::delete(path)
                .map_err(|error| AppError::Message(format!("Could not move to the trash: {error}")))
        })
    }

    /// Runs a call; `remove` takes a deleted path away, to the trash in the app.
    pub(super) fn run_with(
        &self,
        request: FileToolRequest,
        remove: impl FnOnce(&Path) -> Result<(), AppError>,
    ) -> Result<FileToolOutput, AppError> {
        match request {
            FileToolRequest::ListDir {
                path,
                depth,
                pattern,
            } => self.list_dir(&path, depth, pattern.as_deref()),
            FileToolRequest::ReadFile {
                path,
                offset,
                limit,
                max_characters,
            } => self.read_file(&path, offset, limit, max_characters),
            FileToolRequest::SearchFiles {
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
            FileToolRequest::WriteFile { path, content } => self.write_file(&path, &content),
            FileToolRequest::EditFile {
                path,
                old_text,
                new_text,
                replace_all,
            } => self.edit_file(&path, &old_text, &new_text, replace_all),
            FileToolRequest::MovePath { from, to } => self.move_path(&from, &to),
            FileToolRequest::DeletePath { path } => {
                let target = self.resolve(&path, Access::Write, false)?;
                if target.is_root() {
                    return Err(invalid("A root folder cannot be deleted"));
                }
                fs::symlink_metadata(&target.path)
                    .map_err(|_| invalid(format!("{path} does not exist")))?;
                let path = target.virtual_path();
                remove(&target.path)?;
                Ok(FileToolOutput::DeletePath { path })
            }
        }
    }

    fn list_dir(
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

    fn read_file(
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

    fn write_file(&self, path: &str, content: &str) -> Result<FileToolOutput, AppError> {
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
        Ok(FileToolOutput::WriteFile {
            path: target.virtual_path(),
            is_created,
            bytes: content.len(),
        })
    }

    fn edit_file(
        &self,
        path: &str,
        old_text: &str,
        new_text: &str,
        replace_all: bool,
    ) -> Result<FileToolOutput, AppError> {
        let target = self.resolve(path, Access::Write, true)?;
        let before = read_existing_text(&target, path)?;
        let (after, replacement_count) = apply_edit(&before, old_text, new_text, replace_all)?;
        write_user_file(&target.path, after.as_bytes())?;
        Ok(FileToolOutput::EditFile {
            path: target.virtual_path(),
            replacement_count,
        })
    }

    fn move_path(&self, from: &str, to: &str) -> Result<FileToolOutput, AppError> {
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
        Ok(FileToolOutput::MovePath {
            from: source.virtual_path(),
            to: destination.virtual_path(),
        })
    }

    /// What a write or an edit would change, without changing anything.
    pub fn preview(&self, request: FileToolRequest) -> Result<FileChangePreview, AppError> {
        match request {
            FileToolRequest::WriteFile { path, content } => {
                let target = self.resolve(&path, Access::Write, true)?;
                let before = if target.path.is_file() {
                    Some(read_existing_text(&target, &path)?)
                } else {
                    None
                };
                Ok(FileChangePreview {
                    path: target.virtual_path(),
                    before,
                    after: content,
                })
            }
            FileToolRequest::EditFile {
                path,
                old_text,
                new_text,
                replace_all,
            } => {
                let target = self.resolve(&path, Access::Write, true)?;
                let before = read_existing_text(&target, &path)?;
                let (after, _) = apply_edit(&before, &old_text, &new_text, replace_all)?;
                Ok(FileChangePreview {
                    path: target.virtual_path(),
                    before: Some(before),
                    after,
                })
            }
            _ => Err(invalid("Only a write or an edit has a preview")),
        }
    }

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

fn ensure_files_enabled(profile: &AiProfile) -> Result<(), AppError> {
    let group = profile
        .tools
        .as_ref()
        .and_then(|tools| tools.groups.get(FILES_TOOL_GROUP));
    match group {
        Some(group) if group.is_enabled && group.access != ProjectAccessMode::Deny => Ok(()),
        _ => Err(invalid("The file tools are off for this profile")),
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

fn read_existing_text(target: &Resolved<'_>, shown: &str) -> Result<String, AppError> {
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

pub(super) struct LinePage {
    pub content: String,
    pub start_line: usize,
    pub end_line: usize,
    pub total_lines: usize,
    pub next_offset: Option<usize>,
}

/// Whole lines from `offset` (from 1), at most `limit` of them and
/// `max_characters` in all; a first line longer than that is cut.
pub(super) fn page_lines(
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

/// The text with `old_text` replaced: exactly once, or everywhere with
/// `replace_all`. Line ends of the file are kept when the model wrote `\n`.
pub(super) fn apply_edit(
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
        0 => Err(invalid("old_text was not found in the file: read it again and copy the text exactly")),
        1 => Ok((text.replacen(old_text.as_str(), &new_text, 1), 1)),
        _ if replace_all => Ok((text.replace(old_text.as_str(), &new_text), count)),
        _ => Err(invalid(format!(
            "old_text was found {count} times: add surrounding text to make it unique, or set replaceAll"
        ))),
    }
}
