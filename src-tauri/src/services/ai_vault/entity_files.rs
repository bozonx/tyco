//! The files of a profile or a project as a tree to copy, count or remove.
//! Links inside the tree are kept: one that leads elsewhere in the same
//! tree is copied as a link, relative so that it still leads there in the
//! copy. One that leads out of the tree, or nowhere, is refused: TyCo
//! follows no link out of a project or a profile.
use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};

use crate::errors::AppError;

/// What a link of a tree leads to.
enum LinkTarget {
    /// Elsewhere in the tree: the target relative to the folder of the link,
    /// and whether it is a folder.
    Inside { relative: PathBuf, is_dir: bool },
    /// Out of the tree, or nowhere.
    Outside,
}

/// Where the link `link` of the tree at the canonical `root` leads.
fn link_target(root: &Path, link: &Path) -> LinkTarget {
    let (Ok(real), Some(parent)) = (fs::canonicalize(link), link.parent()) else {
        return LinkTarget::Outside;
    };
    let Ok(parent) = fs::canonicalize(parent) else {
        return LinkTarget::Outside;
    };
    if !real.starts_with(root) {
        return LinkTarget::Outside;
    }
    LinkTarget::Inside {
        relative: relative_path(&parent, &real),
        is_dir: real.is_dir(),
    }
}

/// `to` relative to the folder `from`; both canonical.
fn relative_path(from: &Path, to: &Path) -> PathBuf {
    let from: Vec<Component> = from.components().collect();
    let to: Vec<Component> = to.components().collect();
    let common = from.iter().zip(&to).take_while(|(a, b)| a == b).count();
    let mut relative = PathBuf::new();
    for _ in common..from.len() {
        relative.push("..");
    }
    for part in &to[common..] {
        relative.push(part.as_os_str());
    }
    if relative.as_os_str().is_empty() {
        relative.push(".");
    }
    relative
}

/// What a tree holds, for the settings to show before a transfer.
#[derive(Debug, Default, Clone, Serialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct TreeSummary {
    /// Files, links counted as files.
    pub file_count: u64,
    pub total_bytes: u64,
    /// A `.git` folder anywhere in the tree.
    pub has_git: bool,
    /// Links that lead out of the tree or nowhere, relative to it with `/`.
    pub outside_links: Vec<String>,
}

/// Counts the entries `entries` of the tree at `root`.
pub(super) fn summarize(root: &Path, entries: &[PathBuf]) -> Result<TreeSummary, AppError> {
    let root = fs::canonicalize(root)?;
    let mut summary = TreeSummary::default();
    for entry in entries {
        summarize_entry(&root, entry, &mut summary)?;
    }
    Ok(summary)
}

fn summarize_entry(root: &Path, path: &Path, summary: &mut TreeSummary) -> Result<(), AppError> {
    let meta = path.symlink_metadata()?;
    let kind = meta.file_type();
    if kind.is_symlink() {
        if matches!(link_target(root, path), LinkTarget::Outside) {
            summary.outside_links.push(shown(root, path));
        }
        summary.file_count += 1;
    } else if kind.is_dir() {
        if path.file_name().is_some_and(|name| name == ".git") {
            summary.has_git = true;
        }
        for entry in fs::read_dir(path)? {
            summarize_entry(root, &entry?.path(), summary)?;
        }
    } else {
        summary.file_count += 1;
        summary.total_bytes += meta.len();
    }
    Ok(())
}

/// `path` relative to `root`, with `/`.
fn shown(root: &Path, path: &Path) -> String {
    let path = fs::canonicalize(path.parent().unwrap_or(path))
        .map(|parent| parent.join(path.file_name().unwrap_or_default()))
        .unwrap_or_else(|_| path.to_path_buf());
    path.strip_prefix(root)
        .unwrap_or(&path)
        .components()
        .map(|part| part.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

/// Refuses a tree at `root` with a link that leads out of it or nowhere.
pub(super) fn check_links(root: &Path) -> Result<(), AppError> {
    let entries = fs::read_dir(root)?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<Result<Vec<_>, _>>()?;
    check_entry_links(root, &entries)
}

/// Refuses the entries `entries` of the tree at `root` when one of them
/// holds a link that leads out of the tree or nowhere.
pub(super) fn check_entry_links(root: &Path, entries: &[PathBuf]) -> Result<(), AppError> {
    let summary = summarize(root, entries)?;
    match summary.outside_links.first() {
        Some(link) => Err(AppError::InvalidInput(format!(
            "{link} is a link that leads outside of the folder: move it by hand"
        ))),
        None => Ok(()),
    }
}

/// Copies `from`, an entry of the tree at `root`, to `to`. A link leading
/// elsewhere in the tree is made again as a relative link; one leading out
/// of it is refused. A failure leaves what was copied for the caller to
/// remove.
pub(super) fn copy_tree(root: &Path, from: &Path, to: &Path) -> Result<(), AppError> {
    let root = fs::canonicalize(root)?;
    copy_entry(&root, from, to)
}

fn copy_entry(root: &Path, from: &Path, to: &Path) -> Result<(), AppError> {
    let kind = from.symlink_metadata()?.file_type();
    if kind.is_symlink() {
        let LinkTarget::Inside { relative, is_dir } = link_target(root, from) else {
            return Err(AppError::InvalidInput(format!(
                "{} is a link that leads outside of the folder: move it by hand",
                from.display()
            )));
        };
        crate::services::platform::filesystem::create_link(&relative, to, is_dir)?;
    } else if kind.is_dir() {
        fs::create_dir(to)?;
        for entry in fs::read_dir(from)? {
            let entry = entry?;
            copy_entry(root, &entry.path(), &to.join(entry.file_name()))?;
        }
    } else {
        fs::copy(from, to)?;
    }
    Ok(())
}

/// Removes `path` whatever it is, a link as a link.
pub(super) fn remove_entry(path: &Path) -> std::io::Result<()> {
    let kind = path.symlink_metadata()?.file_type();
    if kind.is_symlink() {
        crate::services::platform::filesystem::remove_link(path)
    } else if kind.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::services::test_support::TestDir;
    use std::os::unix::fs::symlink;

    #[test]
    fn relative_paths_climb_to_the_common_folder() {
        assert_eq!(
            relative_path(Path::new("/a/b/c"), Path::new("/a/d/e")),
            PathBuf::from("../../d/e")
        );
        assert_eq!(
            relative_path(Path::new("/a"), Path::new("/a/b")),
            PathBuf::from("b")
        );
        assert_eq!(
            relative_path(Path::new("/a/b"), Path::new("/a/b")),
            PathBuf::from(".")
        );
    }

    #[test]
    fn links_inside_the_tree_are_copied_relative_and_outside_ones_refused() {
        let dir = TestDir::new("entity-files-links");
        let root = dir.join("root");
        fs::create_dir_all(root.join("docs/deep")).unwrap();
        fs::write(root.join("docs/deep/a.md"), "a").unwrap();
        // an absolute link inside the tree becomes relative in the copy
        symlink(root.join("docs/deep"), root.join("docs/shortcut")).unwrap();
        symlink("deep/a.md", root.join("docs/a-link.md")).unwrap();

        let summary = summarize(&root, &[root.join("docs")]).unwrap();
        assert_eq!(summary.file_count, 3);
        assert_eq!(summary.total_bytes, 1);
        assert!(summary.outside_links.is_empty());

        copy_tree(&root, &root.join("docs"), &dir.join("copy")).unwrap();
        assert_eq!(
            fs::read_link(dir.join("copy/shortcut")).unwrap(),
            PathBuf::from("deep")
        );
        assert_eq!(fs::read_to_string(dir.join("copy/a-link.md")).unwrap(), "a");
        // the copy no longer depends on the source
        fs::remove_dir_all(&root).unwrap();
        assert_eq!(
            fs::read_to_string(dir.join("copy/shortcut/a.md")).unwrap(),
            "a"
        );
    }

    #[test]
    fn a_link_out_of_the_tree_or_nowhere_is_listed_and_refused() {
        let dir = TestDir::new("entity-files-outside");
        let root = dir.join("root");
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::create_dir_all(dir.join("secret")).unwrap();
        symlink(dir.join("secret"), root.join("out")).unwrap();
        symlink("missing", root.join("broken")).unwrap();

        let summary = summarize(
            &root,
            &[root.join("out"), root.join("broken"), root.join(".git")],
        )
        .unwrap();
        assert!(summary.has_git);
        assert_eq!(summary.outside_links, vec!["out", "broken"]);
        assert!(check_links(&root).is_err());
        assert!(copy_tree(&root, &root.join("out"), &dir.join("copy")).is_err());

        remove_entry(&root.join("out")).unwrap();
        assert!(dir.join("secret").is_dir(), "only the link is removed");
    }
}
