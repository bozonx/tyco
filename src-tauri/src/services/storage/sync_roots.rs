//! The roots the user may sync, the data folder and the attached vaults,
//! never lie inside one another: the watcher would see one file twice, and
//! moving one root would drag the other along.
use std::path::Path;

use super::data_root_relocation::normalized;
use crate::errors::AppError;

/// The parts of a path as compared: symlinks resolved, and on Windows without
/// the `\\?\` prefix and without case.
fn comparable_parts(path: &Path) -> Vec<String> {
    parts_of(&normalized(path).to_string_lossy(), cfg!(windows))
}

fn parts_of(path: &str, is_windows: bool) -> Vec<String> {
    let path = if is_windows {
        let path = path.strip_prefix(r"\\?\UNC\").map_or_else(
            || path.strip_prefix(r"\\?\").unwrap_or(path).to_owned(),
            |rest| format!(r"\\{rest}"),
        );
        path.to_lowercase()
    } else {
        path.to_owned()
    };
    let separators: &[char] = if is_windows { &['\\', '/'] } else { &['/'] };
    path.split(separators)
        .filter(|part| !part.is_empty() && *part != ".")
        .map(str::to_owned)
        .collect()
}

/// Whether one of the folders is the other or inside it.
fn is_nested_parts(first: &[String], second: &[String]) -> bool {
    first.starts_with(second) || second.starts_with(first)
}

/// What `kind` names in messages: the data folder or a vault.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SyncRootKind {
    DataFolder,
    Vault,
}

impl SyncRootKind {
    fn label(self) -> &'static str {
        match self {
            Self::DataFolder => "the data folder",
            Self::Vault => "an attached AI vault",
        }
    }
}

/// Refuses `candidate`, a root about to be chosen, when it lies inside one of
/// `others`, the roots there already, or holds one of them.
pub fn check_sync_roots(
    candidate: &Path,
    kind: SyncRootKind,
    others: &[(&Path, SyncRootKind)],
) -> Result<(), AppError> {
    let candidate_parts = comparable_parts(candidate);
    for (other, other_kind) in others {
        if is_nested_parts(&candidate_parts, &comparable_parts(other)) {
            return Err(AppError::InvalidInput(format!(
                "{} {} cannot be inside {} {} or hold it: choose a folder outside it",
                capitalized(kind.label()),
                candidate.display(),
                other_kind.label(),
                other.display()
            )));
        }
    }
    Ok(())
}

fn capitalized(text: &str) -> String {
    let mut chars = text.chars();
    chars.next().map_or_else(String::new, |first| {
        first.to_uppercase().chain(chars).collect()
    })
}

/// Whether `path` lies inside `root` or is it, compared as the roots are.
pub fn is_inside(path: &Path, root: &Path) -> bool {
    comparable_parts(path).starts_with(&comparable_parts(root))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::test_support::TestDir;

    #[test]
    fn a_root_inside_another_is_refused_both_ways() {
        let dir = TestDir::new("sync-roots-nested");
        let sync = dir.join("Sync");
        let data = sync.join("TyCo");
        std::fs::create_dir_all(&data).unwrap();
        // a vault holding the data folder
        assert!(check_sync_roots(
            &sync,
            SyncRootKind::Vault,
            &[(&data, SyncRootKind::DataFolder)]
        )
        .is_err());
        // the data folder moved into a vault
        assert!(check_sync_roots(
            &data,
            SyncRootKind::DataFolder,
            &[(&sync, SyncRootKind::Vault)]
        )
        .is_err());
        // a vault in a vault, and the same folder twice
        let work = dir.join("work");
        assert!(check_sync_roots(
            &work.join("inner"),
            SyncRootKind::Vault,
            &[(&work, SyncRootKind::Vault)]
        )
        .is_err());
        assert!(
            check_sync_roots(&work, SyncRootKind::Vault, &[(&work, SyncRootKind::Vault)]).is_err()
        );
        // folders side by side, even with a shared name prefix
        assert!(check_sync_roots(
            &dir.join("work-2"),
            SyncRootKind::Vault,
            &[
                (&work, SyncRootKind::Vault),
                (&data, SyncRootKind::DataFolder)
            ]
        )
        .is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn a_root_reached_by_a_symlink_is_the_same_root() {
        let dir = TestDir::new("sync-roots-symlink");
        let data = dir.join("data");
        std::fs::create_dir_all(&data).unwrap();
        let link = dir.join("link");
        std::os::unix::fs::symlink(&data, &link).unwrap();
        assert!(check_sync_roots(
            &link.join("vault"),
            SyncRootKind::Vault,
            &[(&data, SyncRootKind::DataFolder)]
        )
        .is_err());
    }

    #[test]
    fn windows_paths_compare_without_case_and_prefix() {
        let first = parts_of(r"\\?\C:\Users\Me\Sync", true);
        let second = parts_of(r"c:\users\me\sync\TyCo", true);
        assert!(is_nested_parts(&first, &second));
        assert_eq!(
            parts_of(r"\\?\UNC\server\share\Vault", true),
            parts_of(r"\\SERVER\share\vault", true)
        );
        // case matters elsewhere
        assert!(!is_nested_parts(
            &parts_of("/home/me/Sync", false),
            &parts_of("/home/me/sync/TyCo", false)
        ));
    }
}
