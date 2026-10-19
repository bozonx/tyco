use std::ffi::OsString;
use std::fs;
use std::path::{Component, Path, PathBuf};

use super::{
    invalid, Access, AiFileRoot, ProfileFiles, FILES_TOOL_GROUP, PROJECTS_ROOT, WORKSPACE_ROOT,
};
use crate::errors::AppError;
use crate::services::ai_vault::{self, AiProfile, ProjectAccessMode};

/// A path resolved inside one of the roots.
pub(in crate::services::ai_tools) struct Resolved<'a> {
    pub root: &'a AiFileRoot,
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

    pub(super) fn is_root(&self) -> bool {
        self.path == self.root_dir
    }
}

/// The model's path of a file on disk inside the root.
pub(in crate::services::ai_tools) fn virtual_path(
    root: &AiFileRoot,
    root_dir: &Path,
    path: &Path,
) -> String {
    let relative = path.strip_prefix(root_dir).unwrap_or(path);
    let mut text = root.path.clone();
    for component in relative.components() {
        text.push('/');
        text.push_str(&component.as_os_str().to_string_lossy());
    }
    text
}

/// Whether a path inside a root is one of the files Tyco or git own.
pub(in crate::services::ai_tools) fn is_forbidden(root: &AiFileRoot, relative: &Path) -> bool {
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

impl ProfileFiles {
    /// The profile's roots as they are on disk now. A profile whose file tools
    /// are off reaches none.
    pub fn load(vault_root: &Path, profile_id: &str) -> Result<Self, AppError> {
        let profile = ai_vault::get_profile(vault_root, profile_id)?;
        ensure_files_enabled(&profile)?;
        let mut roots = vec![AiFileRoot {
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
            roots.push(AiFileRoot {
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

    /// The root a path starts with and the rest of it, checked to be plain
    /// names inside the root.
    fn locate(&self, path: &str) -> Result<(&AiFileRoot, PathBuf), AppError> {
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

    fn find_root(&self, path: &str) -> Result<&AiFileRoot, AppError> {
        self.roots
            .iter()
            .find(|root| root.path == path)
            .ok_or_else(|| invalid(format!("The profile has no access to {path}")))
    }

    /// Where a path is on disk, kept inside its root.
    ///
    /// `follow` resolves a link at the end of the path, for an operation on
    /// what it points to; without it the link itself is moved or deleted.
    pub(in crate::services::ai_tools) fn resolve(
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
