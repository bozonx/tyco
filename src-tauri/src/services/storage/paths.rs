//! Where the app keeps its files. The directories are created, and closed to
//! other users, on every lookup: the user may delete one while Tyco runs.
use std::path::PathBuf;

use tauri::AppHandle;

use crate::errors::AppError;
use crate::models::{StorageInfo, StorageKind, StorageLocation};
use crate::services::atomic_file::create_private_dir;
use crate::services::storage::app_paths::AppPaths;

pub fn app_config_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = AppPaths::resolve(app)?.config_dir;

    create_private_dir(&dir)?;

    Ok(dir)
}

pub fn app_data_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = AppPaths::resolve(app)?.data_dir;

    create_private_dir(&dir)?;

    Ok(dir)
}

pub fn app_data_sub_dir(app: &AppHandle, sub: &str) -> Result<PathBuf, AppError> {
    let dir = app_data_dir(app)?.join(sub);
    create_private_dir(&dir)?;
    Ok(dir)
}

pub(super) fn app_cache_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = AppPaths::resolve(app)?.cache_dir;
    create_private_dir(&dir)?;
    Ok(dir)
}

pub fn app_log_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = AppPaths::resolve(app)?.log_dir;
    create_private_dir(&dir)?;
    Ok(dir)
}

/// Where each kind of file is; listing them creates no directory.
pub fn get_storage_info(app: &AppHandle) -> Result<StorageInfo, AppError> {
    let paths = AppPaths::resolve(app)?;
    Ok(StorageInfo {
        locations: group_storage_locations([
            (StorageKind::Config, paths.config_dir),
            (StorageKind::Data, paths.data_dir),
            (StorageKind::Cache, paths.cache_dir),
            (StorageKind::Logs, paths.log_dir),
        ]),
    })
}

/// The directory of a storage kind, for the user to open.
pub fn storage_dir(app: &AppHandle, kind: StorageKind) -> Result<PathBuf, AppError> {
    match kind {
        StorageKind::Config => app_config_dir(app),
        StorageKind::Data => app_data_dir(app),
        StorageKind::Cache => app_cache_dir(app),
        StorageKind::Logs => app_log_dir(app),
    }
}

/// Only the root directories: a kind in the same directory as another, or
/// inside it, joins that one's location.
pub(super) fn group_storage_locations(
    dirs: impl IntoIterator<Item = (StorageKind, PathBuf)>,
) -> Vec<StorageLocation> {
    let mut roots: Vec<(Vec<StorageKind>, PathBuf)> = Vec::new();
    for (kind, dir) in dirs {
        if let Some((kinds, _)) = roots.iter_mut().find(|(_, root)| dir.starts_with(root)) {
            kinds.push(kind);
            continue;
        }
        // a root inside the new directory joins it instead
        let mut kinds = Vec::new();
        roots.retain(|(nested_kinds, root)| {
            let nested = root.starts_with(&dir);
            if nested {
                kinds.extend(nested_kinds);
            }
            !nested
        });
        kinds.push(kind);
        roots.push((kinds, dir));
    }
    roots
        .into_iter()
        .map(|(kinds, dir)| StorageLocation {
            kinds,
            path: path_to_string(dir),
        })
        .collect()
}

pub(super) fn path_to_string(path: PathBuf) -> String {
    path.to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn storage_info_serializes_locations() {
        let info = StorageInfo {
            locations: vec![StorageLocation {
                kinds: vec![StorageKind::Config, StorageKind::Logs],
                path: "/config".into(),
            }],
        };

        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(
            json,
            json!({ "locations": [{ "kinds": ["config", "logs"], "path": "/config" }] })
        );
    }

    #[test]
    fn groups_storage_locations_by_root() {
        let group = |dirs: &[(StorageKind, &str)]| {
            group_storage_locations(
                dirs.iter()
                    .map(|(kind, dir)| (*kind, PathBuf::from(dir)))
                    .collect::<Vec<_>>(),
            )
            .into_iter()
            .map(|location| (location.kinds, location.path))
            .collect::<Vec<_>>()
        };
        use StorageKind::*;

        // Linux: every kind in a directory of its own
        assert_eq!(
            group(&[
                (Config, "/h/.config/id"),
                (Data, "/h/.local/share/id"),
                (Cache, "/h/.cache/id"),
                (Logs, "/h/.local/state/id/logs"),
            ]),
            [
                (vec![Config], String::from("/h/.config/id")),
                (vec![Data], String::from("/h/.local/share/id")),
                (vec![Cache], String::from("/h/.cache/id")),
                (vec![Logs], String::from("/h/.local/state/id/logs")),
            ]
        );
        // Windows: the same directory, and logs inside the cache
        assert_eq!(
            group(&[
                (Config, "/r/id"),
                (Data, "/r/id"),
                (Cache, "/l/id"),
                (Logs, "/l/id/logs"),
            ]),
            [
                (vec![Config, Data], String::from("/r/id")),
                (vec![Cache, Logs], String::from("/l/id")),
            ]
        );
        // a root listed after the directory inside it
        assert_eq!(
            group(&[(Logs, "/l/id/logs"), (Cache, "/l/id")]),
            [(vec![Logs, Cache], String::from("/l/id"))]
        );
        // a common prefix of the name is not a parent
        assert_eq!(group(&[(Cache, "/l/id"), (Logs, "/l/id2")]).len(), 2);
    }
}
