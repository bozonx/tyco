//! Where the app keeps its files. The directories are created, and closed to
//! other users, on every lookup: the user may delete one while Tyco runs.
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use super::user_data::{user_dir_for, UserData, UserDirAccess};
use crate::errors::AppError;
use crate::models::{StorageInfo, StorageKind, StorageLocation};
use crate::services::atomic_file::create_private_dir;
use crate::services::storage::app_paths::AppPaths;

/// The folder of this device's own files, see `AppPaths::device_dir`.
pub fn device_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = AppPaths::resolve(app)?.device_dir;
    create_private_dir(&dir)?;
    Ok(dir)
}

/// The state folder: logs, the webview, and what is derived from the user
/// data or kept aside from it.
pub fn state_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = AppPaths::resolve(app)?.state_dir;
    create_private_dir(&dir)?;
    Ok(dir)
}

pub fn state_sub_dir(app: &AppHandle, sub: &str) -> Result<PathBuf, AppError> {
    let dir = state_dir(app)?.join(sub);
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
    let user_data = app
        .try_state::<UserData>()
        .map(|data| data.state())
        .ok_or_else(|| {
            AppError::ServiceUnavailable("The data folder is not resolved yet".into())
        })?;
    Ok(StorageInfo {
        locations: group_storage_locations([
            (StorageKind::Device, paths.device_dir),
            (StorageKind::State, paths.state_dir),
            (StorageKind::Cache, paths.cache_dir),
            (StorageKind::Logs, paths.log_dir),
        ]),
        user_data,
    })
}

/// The directory of a storage kind, for the user to open.
pub fn storage_dir(app: &AppHandle, kind: StorageKind) -> Result<PathBuf, AppError> {
    match kind {
        StorageKind::User => user_dir_for(app, UserDirAccess::Read),
        StorageKind::Device => device_dir(app),
        StorageKind::State => state_dir(app),
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
                kinds: vec![StorageKind::State, StorageKind::Logs],
                path: "/state".into(),
            }],
            user_data: crate::models::UserDataState {
                path: "/sync/tyco".into(),
                default_path: "/data".into(),
                is_default: false,
                status: crate::models::UserDataStatus::NotConnected,
                is_writable_by_others: false,
                device_id: String::new(),
                platform: String::from("linux"),
            },
        };

        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(
            json,
            json!({
                "locations": [{ "kinds": ["state", "logs"], "path": "/state" }],
                "userData": {
                    "path": "/sync/tyco",
                    "defaultPath": "/data",
                    "isDefault": false,
                    "status": "notConnected",
                    "isWritableByOthers": false,
                    "deviceId": "",
                    "platform": "linux"
                }
            })
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

        // Linux: every kind in a directory of its own, logs inside the state
        assert_eq!(
            group(&[
                (Device, "/h/.config/id"),
                (State, "/h/.local/state/id"),
                (Cache, "/h/.cache/id"),
                (Logs, "/h/.local/state/id/logs"),
            ]),
            [
                (vec![Device], String::from("/h/.config/id")),
                (vec![State, Logs], String::from("/h/.local/state/id")),
                (vec![Cache], String::from("/h/.cache/id")),
            ]
        );
        // Windows: the device folder, the cache and the logs inside the state
        assert_eq!(
            group(&[
                (Device, "/l/id/device"),
                (State, "/l/id"),
                (Cache, "/l/id"),
                (Logs, "/l/id/logs"),
            ]),
            [(vec![Device, State, Cache, Logs], String::from("/l/id"))]
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
