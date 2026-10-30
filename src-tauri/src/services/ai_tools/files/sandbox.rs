use std::ffi::{OsStr, OsString};

use cap_std::fs::Dir;
use std::fs;
use std::path::{Component, Path, PathBuf};

use super::{Access, AiFileRoot, ProfileFiles, FILES_TOOL_GROUP, PROJECTS_ROOT, WORKSPACE_ROOT};
use crate::errors::AppError;
use crate::services::ai_vault::{self, AiProfile, ProjectAccessMode};

/// A path resolved inside one of the roots.
pub(in crate::services::ai_tools) struct Resolved<'a> {
    pub root: &'a AiFileRoot,
    /// The canonical folder of the root.
    pub root_dir: PathBuf,
    /// Where on disk.
    pub path: PathBuf,
    /// The capability used for I/O after validation; paths cannot escape it.
    pub(super) directory: Dir,
}

impl Resolved<'_> {
    /// The path as the model knows it.
    pub fn virtual_path(&self) -> String {
        virtual_path(self.root, &self.root_dir, &self.path)
    }

    pub(super) fn relative_path(&self) -> &Path {
        let relative = self
            .path
            .strip_prefix(&self.root_dir)
            .expect("Resolved paths stay inside their root");
        if relative.as_os_str().is_empty() {
            Path::new(".")
        } else {
            relative
        }
    }

    /// Opens the parent relative to the pinned root, including when it was
    /// replaced by a symlink after resolve. No ambient path is used for I/O.
    pub(super) fn parent(&self, create: bool) -> Result<(Dir, &OsStr), AppError> {
        let relative = self.relative_path();
        let name = relative
            .file_name()
            .ok_or_else(|| AppError::invalid_input("A root folder cannot be changed"))?;
        let parent = relative
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .unwrap_or(Path::new("."));
        if create {
            self.directory.create_dir_all(parent)?;
        }
        Ok((self.directory.open_dir(parent)?, name))
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
                return Err(AppError::invalid_input(
                    "The path goes through a broken link",
                ))
            }
            Err(_) => {
                let name = existing
                    .file_name()
                    .ok_or_else(|| AppError::invalid_input("The folder is unavailable"))?
                    .to_os_string();
                missing.push(name);
                if !existing.pop() {
                    return Err(AppError::invalid_input("The folder is unavailable"));
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
                ".." => return Err(AppError::invalid_input("A path may not go up with ..")),
                _ => parts.push(part),
            }
        }
        let (root, rest) = match parts.as_slice() {
            [] => {
                return Err(AppError::invalid_input(
                    "Name a path inside workspace/ or projects/<project-id>/",
                ))
            }
            [WORKSPACE_ROOT, rest @ ..] => (self.find_root(WORKSPACE_ROOT)?, rest),
            [PROJECTS_ROOT, id, rest @ ..] => {
                (self.find_root(&format!("{PROJECTS_ROOT}/{id}"))?, rest)
            }
            _ => {
                return Err(AppError::invalid_input(format!(
                    "Unknown path {path}: paths start with workspace/ or projects/<project-id>/"
                )))
            }
        };
        let relative: PathBuf = rest.iter().collect();
        if !relative
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
        {
            return Err(AppError::invalid_input(format!("Invalid path {path}")));
        }
        Ok((root, relative))
    }

    fn find_root(&self, path: &str) -> Result<&AiFileRoot, AppError> {
        self.roots
            .iter()
            .find(|root| root.path == path)
            .ok_or_else(|| AppError::invalid_input(format!("The profile has no access to {path}")))
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
            return Err(AppError::invalid_input(format!(
                "The profile may not {} {}",
                match access {
                    Access::Read => "read",
                    Access::Write => "change",
                },
                root.path
            )));
        }
        if is_forbidden(root, &relative) {
            return Err(AppError::invalid_input(format!(
                "{path} is not available to tools"
            )));
        }
        let root_dir = fs::canonicalize(&root.dir).map_err(|error| {
            AppError::invalid_input(format!(
                "The folder of {} is unavailable: {error}",
                root.path
            ))
        })?;
        let directory = Dir::open_ambient_dir(&root_dir, cap_std::ambient_authority())?;
        let mut real = match (relative.parent(), relative.file_name()) {
            (Some(parent), Some(name)) => canonical_prefix(&root_dir.join(parent))?.join(name),
            _ => root_dir.clone(),
        };
        if follow && fs::symlink_metadata(&real).is_ok_and(|meta| meta.file_type().is_symlink()) {
            real = fs::canonicalize(&real)
                .map_err(|_| AppError::invalid_input(format!("{path} is a broken link")))?;
        }
        let inside = real.strip_prefix(&root_dir).map_err(|_| {
            AppError::invalid_input(format!("{path} leads outside of {}", root.path))
        })?;
        if is_forbidden(root, inside) {
            return Err(AppError::invalid_input(format!(
                "{path} is not available to tools"
            )));
        }
        Ok(Resolved {
            root,
            root_dir,
            path: real,
            directory,
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
        _ => Err(AppError::invalid_input(
            "The file tools are off for this profile",
        )),
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::super::scoped_io;
    use super::*;
    use crate::services::test_support::TestDir;
    use std::os::unix::fs::symlink;

    #[test]
    fn replacing_a_validated_parent_with_an_external_link_cannot_escape() {
        let directory = TestDir::new("sandbox-parent-swap");
        let workspace = directory.join("workspace");
        let outside = directory.join("outside");
        fs::create_dir_all(workspace.join("nested")).unwrap();
        fs::create_dir(&outside).unwrap();
        let files = ProfileFiles::from_roots(vec![AiFileRoot::for_test(
            WORKSPACE_ROOT,
            &workspace,
            ProjectAccessMode::Allow,
            ProjectAccessMode::Allow,
            false,
        )]);
        let target = files
            .resolve("workspace/nested/file.txt", Access::Write, true)
            .unwrap();
        fs::rename(workspace.join("nested"), workspace.join("held")).unwrap();
        symlink(&outside, workspace.join("nested")).unwrap();
        assert!(target.parent(true).is_err());
        assert!(!outside.join("file.txt").exists());
    }

    #[test]
    fn an_open_parent_stays_pinned_after_its_path_is_replaced() {
        let directory = TestDir::new("sandbox-pinned-parent");
        let workspace = directory.join("workspace");
        let outside = directory.join("outside");
        fs::create_dir_all(workspace.join("nested")).unwrap();
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("file.txt"), "outside").unwrap();
        let files = ProfileFiles::from_roots(vec![AiFileRoot::for_test(
            WORKSPACE_ROOT,
            &workspace,
            ProjectAccessMode::Allow,
            ProjectAccessMode::Allow,
            false,
        )]);
        let target = files
            .resolve("workspace/nested/file.txt", Access::Write, true)
            .unwrap();
        let (parent, name) = target.parent(true).unwrap();
        fs::rename(workspace.join("nested"), workspace.join("held")).unwrap();
        symlink(&outside, workspace.join("nested")).unwrap();
        scoped_io::write_file(&parent, name, b"inside", true).unwrap();
        assert_eq!(
            fs::read_to_string(outside.join("file.txt")).unwrap(),
            "outside"
        );
        assert_eq!(
            fs::read_to_string(workspace.join("held/file.txt")).unwrap(),
            "inside"
        );
    }
}
