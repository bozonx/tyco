//! Changing the user data folder. The user says what to do, and the backend
//! never guesses it from what a folder holds: a folder a sync has not filled
//! yet looks empty, or foreign, and a guess would move the data of this
//! device towards the data arriving there.
//!
//! - `move` moves the data into an empty or missing folder;
//! - `connect` uses a folder that holds Tyco data, its marker of a version
//!   this build knows; the data of the current folder stays where it is;
//! - `useDefault` uses the default folder with what it holds, moving nothing:
//!   after the chosen folder went missing, or to use the data left there.
//!
//! The change takes effect after a restart: the folders are not switched in
//! a running app.
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::data_root_relocation::{is_nested, normalized, relocate_with, RootMove};
use super::user_data::{has_marker, marker_version, USER_FORMAT_VERSION, USER_MARKER_FILE};
use crate::errors::AppError;
use crate::models::UserDataRelocationMode;

/// The subfolder offered when the chosen folder holds files of its own.
pub const USER_DATA_SUBFOLDER_NAME: &str = "TyCo";

/// The entries of the user data folder a move takes along; anything else in
/// the folder is not Tyco's.
const USER_DATA_ENTRIES: [&str; 5] = [
    USER_MARKER_FILE,
    "config.json",
    "history",
    "chats",
    "plugins",
];
/// The vault of the default location, which goes along when it is in use.
const VAULT_ENTRY: &str = "ai-vault";

/// What a folder the user data may go to holds.
#[derive(Debug, Clone, Serialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum UserDataTargetKind {
    /// The data is there already.
    Current,
    /// No folder or an empty one: the data can be moved into it.
    Empty,
    /// The data of Tyco, with its marker; `isSupported` when this build
    /// knows the layout.
    #[serde(rename_all = "camelCase")]
    UserData {
        format_version: u64,
        is_supported: bool,
    },
    /// Files of Tyco without the marker: most likely a sync has not finished.
    Unfinished,
    /// Files of some other kind: the data goes into a subfolder instead.
    #[serde(rename_all = "camelCase")]
    Occupied { subfolder_path: String },
    /// Inside the current folder or around it, or in a folder of the app.
    Forbidden,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct UserDataTarget {
    pub path: String,
    /// The default folder of the platform.
    pub is_default: bool,
    pub contents: UserDataTargetKind,
}

/// The folders of the app the user data must stay out of: the device, state,
/// cache and log folders, and an external AI vault.
pub struct Forbidden<'a>(pub Vec<&'a Path>);

fn has_known_entries(dir: &Path) -> bool {
    USER_DATA_ENTRIES
        .iter()
        .chain([&VAULT_ENTRY])
        .any(|entry| fs::symlink_metadata(dir.join(entry)).is_ok())
}

/// What `target` holds, as seen from the user data folder at `current`.
pub fn inspect_target(
    current: &Path,
    target: &Path,
    forbidden: &Forbidden,
) -> Result<UserDataTargetKind, AppError> {
    if !target.is_absolute() {
        return Err(AppError::InvalidInput(format!(
            "The data folder path is not absolute: {}",
            target.display()
        )));
    }
    if normalized(current) == normalized(target) {
        return Ok(UserDataTargetKind::Current);
    }
    if is_nested(current, target) || forbidden.0.iter().any(|dir| is_nested(dir, target)) {
        return Ok(UserDataTargetKind::Forbidden);
    }
    if !target.exists() {
        return Ok(UserDataTargetKind::Empty);
    }
    if !target.is_dir() {
        return Err(AppError::InvalidInput(format!(
            "Not a folder: {}",
            target.display()
        )));
    }
    if has_marker(target) {
        let format_version = marker_version(target).unwrap_or(u64::MAX);
        return Ok(UserDataTargetKind::UserData {
            format_version,
            is_supported: format_version <= USER_FORMAT_VERSION,
        });
    }
    if fs::read_dir(target)?.next().is_none() {
        return Ok(UserDataTargetKind::Empty);
    }
    if has_known_entries(target) {
        return Ok(UserDataTargetKind::Unfinished);
    }
    Ok(UserDataTargetKind::Occupied {
        subfolder_path: target
            .join(USER_DATA_SUBFOLDER_NAME)
            .to_string_lossy()
            .into_owned(),
    })
}

/// What a relocation does, checked against what the folders hold.
#[derive(Debug, PartialEq, Eq)]
pub enum RelocationPlan {
    /// Moves the data from the current folder into `to`.
    Move { to: PathBuf },
    /// Uses `to` as it is; nothing moves.
    Use { to: PathBuf },
}

/// Checks a relocation the user asked for. `target` is the chosen folder of
/// `move` and `connect`; the default folder is `default_dir`.
pub fn plan(
    mode: UserDataRelocationMode,
    current: &Path,
    default_dir: &Path,
    target: Option<&Path>,
    forbidden: &Forbidden,
) -> Result<RelocationPlan, AppError> {
    let chosen = || {
        target
            .map(Path::to_path_buf)
            .ok_or_else(|| AppError::InvalidInput("Choose a folder for the data".into()))
    };
    match mode {
        UserDataRelocationMode::Move => {
            let to = chosen()?;
            match inspect_target(current, &to, forbidden)? {
                UserDataTargetKind::Empty => Ok(RelocationPlan::Move { to }),
                UserDataTargetKind::UserData { .. } => Err(AppError::InvalidInput(format!(
                    "{} holds Tyco data already: connect it instead",
                    to.display()
                ))),
                kind => Err(refusal(&to, &kind)),
            }
        }
        UserDataRelocationMode::Connect => {
            let to = chosen()?;
            match inspect_target(current, &to, forbidden)? {
                UserDataTargetKind::UserData {
                    is_supported: true, ..
                } => Ok(RelocationPlan::Use { to }),
                UserDataTargetKind::UserData { .. } => Err(AppError::UnsupportedConfig(format!(
                    "The data in {} was laid out by a newer version of Tyco; update Tyco to use it",
                    to.display()
                ))),
                UserDataTargetKind::Unfinished => Err(AppError::InvalidInput(format!(
                    "{} has no {USER_MARKER_FILE}: most likely the sync has not finished yet",
                    to.display()
                ))),
                UserDataTargetKind::Empty => Err(AppError::InvalidInput(format!(
                    "{} holds no Tyco data: move the data there instead",
                    to.display()
                ))),
                kind => Err(refusal(&to, &kind)),
            }
        }
        UserDataRelocationMode::UseDefault => {
            if normalized(current) == normalized(default_dir) {
                return Err(AppError::InvalidInput(
                    "The data is in the default folder already".into(),
                ));
            }
            // as `connect`: data of a newer layout would only be read
            if marker_version(default_dir).is_some_and(|version| version > USER_FORMAT_VERSION) {
                return Err(AppError::UnsupportedConfig(format!(
                    "The data in {} was laid out by a newer version of Tyco; update Tyco to use it",
                    default_dir.display()
                )));
            }
            Ok(RelocationPlan::Use {
                to: default_dir.to_path_buf(),
            })
        }
    }
}

fn refusal(target: &Path, kind: &UserDataTargetKind) -> AppError {
    match kind {
        UserDataTargetKind::Current => {
            AppError::InvalidInput(format!("The data is in {} already", target.display()))
        }
        UserDataTargetKind::Occupied { subfolder_path } => AppError::InvalidInput(format!(
            "{} holds other files; use a subfolder such as {subfolder_path}",
            target.display()
        )),
        UserDataTargetKind::Forbidden => AppError::InvalidInput(format!(
            "The data cannot go to {}: it is a folder of the app or of the current data",
            target.display()
        )),
        UserDataTargetKind::Unfinished => AppError::InvalidInput(format!(
            "{} holds files of Tyco without {USER_MARKER_FILE}",
            target.display()
        )),
        UserDataTargetKind::Empty | UserDataTargetKind::UserData { .. } => {
            AppError::InvalidInput(format!("The data cannot go to {}", target.display()))
        }
    }
}

/// Carries out a checked plan: moves the data when it asks, then `commit`s
/// the new folder; a failed commit moves the data back. `moves_vault` takes
/// the default vault along.
pub fn execute(
    plan: &RelocationPlan,
    current: &Path,
    commit: impl FnOnce(&Path) -> Result<(), AppError>,
) -> Result<(), AppError> {
    // the main vault is always inside the data folder and moves with it
    let mut entries: Vec<&str> = USER_DATA_ENTRIES.to_vec();
    entries.push(VAULT_ENTRY);
    match plan {
        RelocationPlan::Move { to } => relocate_with(
            Some(RootMove {
                from: current,
                to,
                entries: Some(&entries),
            }),
            || commit(to),
        ),
        RelocationPlan::Use { to } => relocate_with(None, || commit(to)),
    }
}

/// Refuses a data folder inside an attached vault or holding one.
fn check_against_vaults(config: &serde_json::Value, target: &Path) -> Result<(), AppError> {
    use super::sync_roots::{check_sync_roots, SyncRootKind};
    let vaults = crate::models::user_config::attached_vaults(config);
    let roots: Vec<(PathBuf, SyncRootKind)> = vaults
        .iter()
        .map(|vault| (PathBuf::from(&vault.path), SyncRootKind::Vault))
        .collect();
    let others: Vec<(&Path, SyncRootKind)> = roots
        .iter()
        .map(|(path, kind)| (path.as_path(), *kind))
        .collect();
    check_sync_roots(target, SyncRootKind::DataFolder, &others)
}

/// The folders of the app the data must stay out of.
fn app_folders(paths: &super::app_paths::AppPaths) -> Vec<PathBuf> {
    vec![
        paths.device_dir.clone(),
        paths.state_dir.clone(),
        paths.cache_dir.clone(),
        paths.log_dir.clone(),
    ]
}

/// What a folder holds, for the user to choose what to do with it; `None`
/// asks about the default folder.
pub fn inspect(app: &tauri::AppHandle, path: Option<&str>) -> Result<UserDataTarget, AppError> {
    use tauri::Manager;
    let data = app.state::<super::user_data::UserData>();
    let paths = super::app_paths::AppPaths::resolve(app)?;
    let forbidden = app_folders(&paths);
    let target = path
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map_or_else(|| data.default_dir.clone(), PathBuf::from);
    check_against_vaults(
        &app.state::<crate::state::AppState>().user_config(),
        &target,
    )?;
    let contents = inspect_target(
        &data.dir,
        &target,
        &Forbidden(forbidden.iter().map(PathBuf::as_path).collect()),
    )?;
    Ok(UserDataTarget {
        is_default: normalized(&target) == normalized(&data.default_dir),
        path: target.to_string_lossy().into_owned(),
        contents,
    })
}

/// Changes the user data folder as the user asked, writes it into the device
/// file and restarts the app. Every vault, settings and history operation
/// waits meanwhile; the webview saves its drafts before it asks.
pub fn relocate(
    app: &tauri::AppHandle,
    mode: UserDataRelocationMode,
    path: Option<&str>,
) -> Result<(), AppError> {
    use tauri::Manager;
    let state = app.state::<crate::state::AppState>();
    let data = app.state::<super::user_data::UserData>();
    let device = app.state::<super::device::DeviceStore>();
    let paths = super::app_paths::AppPaths::resolve(app)?;
    {
        let _vault = state.write_vault();
        let _settings = state.lock_settings_update();
        let forbidden = app_folders(&paths);
        let target = path
            .map(str::trim)
            .filter(|path| !path.is_empty())
            .map(PathBuf::from);
        check_against_vaults(
            &state.user_config(),
            target.as_deref().unwrap_or(&data.default_dir),
        )?;
        let plan = plan(
            mode,
            &data.dir,
            &data.default_dir,
            target.as_deref(),
            &Forbidden(forbidden.iter().map(PathBuf::as_path).collect()),
        )?;
        if matches!(plan, RelocationPlan::Move { .. }) && !data.is_writable() {
            return Err(AppError::UserDataUnavailable(format!(
                "The data in {} cannot be moved: the folder is not connected or read only",
                data.dir.display()
            )));
        }
        state.history.while_locked(|| {
            execute(&plan, &data.dir, |to| {
                let configured = if normalized(to) == normalized(&data.default_dir) {
                    String::new()
                } else {
                    to.to_string_lossy().into_owned()
                };
                device.update(|file| file.user_data_path = configured)
            })
        })?;
        // the disk of the new folder is taken as it is
        if let Err(error) = crate::services::settings::persist::reset_base(&paths.state_dir) {
            log::warn!("Could not reset the settings merge base: {error}");
        }
    }
    log::info!("The data folder changed; restarting");
    crate::services::runtime::request_restart(app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::storage::user_data::write_marker;
    use crate::services::test_support::TestDir;

    struct Folders {
        dir: TestDir,
        current: PathBuf,
        default: PathBuf,
        state: PathBuf,
    }

    impl Folders {
        fn new(name: &str) -> Self {
            let dir = TestDir::new(name);
            let current = dir.join("current");
            fs::create_dir_all(current.join("chats")).unwrap();
            write_marker(&current).unwrap();
            fs::write(current.join("config.json"), "{}").unwrap();
            fs::write(current.join("chats/a.json"), "{}").unwrap();
            let default = dir.join("default");
            let state = dir.join("state");
            fs::create_dir_all(&state).unwrap();
            Self {
                current,
                default,
                state,
                dir,
            }
        }

        fn forbidden(&self) -> Forbidden<'_> {
            Forbidden(vec![&self.state])
        }

        fn plan(
            &self,
            mode: UserDataRelocationMode,
            target: Option<&Path>,
        ) -> Result<RelocationPlan, AppError> {
            plan(
                mode,
                &self.current,
                &self.default,
                target,
                &self.forbidden(),
            )
        }
    }

    #[test]
    fn a_target_is_told_apart_by_what_it_holds() {
        let folders = Folders::new("user-data-targets");
        let inspect =
            |target: &Path| inspect_target(&folders.current, target, &folders.forbidden()).unwrap();
        assert_eq!(inspect(&folders.current), UserDataTargetKind::Current);
        assert_eq!(
            inspect(&folders.dir.join("missing")),
            UserDataTargetKind::Empty
        );
        let empty = folders.dir.join("empty");
        fs::create_dir_all(&empty).unwrap();
        assert_eq!(inspect(&empty), UserDataTargetKind::Empty);
        let synced = folders.dir.join("synced");
        fs::create_dir_all(&synced).unwrap();
        write_marker(&synced).unwrap();
        assert_eq!(
            inspect(&synced),
            UserDataTargetKind::UserData {
                format_version: USER_FORMAT_VERSION,
                is_supported: true
            }
        );
        let unfinished = folders.dir.join("unfinished");
        fs::create_dir_all(unfinished.join("chats")).unwrap();
        assert_eq!(inspect(&unfinished), UserDataTargetKind::Unfinished);
        let documents = folders.dir.join("documents");
        fs::create_dir_all(&documents).unwrap();
        fs::write(documents.join("notes.txt"), "x").unwrap();
        assert!(matches!(
            inspect(&documents),
            UserDataTargetKind::Occupied { subfolder_path } if subfolder_path.ends_with(USER_DATA_SUBFOLDER_NAME)
        ));
        assert_eq!(
            inspect(&folders.current.join("inner")),
            UserDataTargetKind::Forbidden
        );
        assert_eq!(inspect(&folders.dir), UserDataTargetKind::Forbidden);
        assert_eq!(
            inspect(&folders.state.join("data")),
            UserDataTargetKind::Forbidden
        );
        assert!(inspect_target(
            &folders.current,
            Path::new("relative"),
            &folders.forbidden()
        )
        .is_err());
    }

    #[test]
    fn moving_takes_the_data_and_nothing_else() {
        let folders = Folders::new("user-data-move");
        fs::write(folders.current.join("notes.txt"), "not ours").unwrap();
        let target = folders.dir.join("sync/TyCo");
        let plan = folders
            .plan(UserDataRelocationMode::Move, Some(&target))
            .unwrap();
        let mut committed = None;
        execute(&plan, &folders.current, |to| {
            committed = Some(to.to_path_buf());
            Ok(())
        })
        .unwrap();
        assert_eq!(committed.as_deref(), Some(target.as_path()));
        assert!(target.join(USER_MARKER_FILE).is_file());
        assert!(target.join("chats/a.json").is_file());
        assert!(!folders.current.join("chats").exists());
        assert!(folders.current.join("notes.txt").is_file());
    }

    #[test]
    fn a_failed_commit_moves_the_data_back() {
        let folders = Folders::new("user-data-move-rollback");
        let target = folders.dir.join("target");
        let plan = folders
            .plan(UserDataRelocationMode::Move, Some(&target))
            .unwrap();
        let result = execute(&plan, &folders.current, |_| {
            Err(AppError::Failed("Injected device file failure".into()))
        });
        assert!(result.is_err());
        assert!(folders.current.join("chats/a.json").is_file());
        assert!(!target.join("chats").exists());
    }

    #[test]
    fn moving_into_a_folder_of_tyco_data_is_refused() {
        let folders = Folders::new("user-data-move-refused");
        let synced = folders.dir.join("synced");
        fs::create_dir_all(&synced).unwrap();
        write_marker(&synced).unwrap();
        let error = folders
            .plan(UserDataRelocationMode::Move, Some(&synced))
            .unwrap_err();
        assert!(error.to_string().contains("connect it instead"), "{error}");
        assert!(folders
            .plan(UserDataRelocationMode::Move, Some(&folders.state))
            .is_err());
    }

    #[test]
    fn connecting_needs_the_marker() {
        let folders = Folders::new("user-data-connect");
        let synced = folders.dir.join("synced");
        fs::create_dir_all(&synced).unwrap();
        write_marker(&synced).unwrap();
        assert_eq!(
            folders
                .plan(UserDataRelocationMode::Connect, Some(&synced))
                .unwrap(),
            RelocationPlan::Use { to: synced.clone() }
        );
        // known entries without the marker: a sync still on its way
        let arriving = folders.dir.join("arriving");
        fs::create_dir_all(&arriving).unwrap();
        fs::write(arriving.join("config.json"), "{}").unwrap();
        let error = folders
            .plan(UserDataRelocationMode::Connect, Some(&arriving))
            .unwrap_err();
        assert!(
            error.to_string().contains("sync has not finished"),
            "{error}"
        );
        let empty = folders.dir.join("empty");
        assert!(folders
            .plan(UserDataRelocationMode::Connect, Some(&empty))
            .is_err());
        let newer = folders.dir.join("newer");
        fs::create_dir_all(&newer).unwrap();
        fs::write(
            newer.join(USER_MARKER_FILE),
            format!(r#"{{"formatVersion":{}}}"#, USER_FORMAT_VERSION + 1),
        )
        .unwrap();
        assert!(matches!(
            folders.plan(UserDataRelocationMode::Connect, Some(&newer)),
            Err(AppError::UnsupportedConfig(_))
        ));
    }

    #[test]
    fn connecting_leaves_the_current_data_in_place() {
        let folders = Folders::new("user-data-connect-keeps");
        let synced = folders.dir.join("synced");
        fs::create_dir_all(&synced).unwrap();
        write_marker(&synced).unwrap();
        let plan = folders
            .plan(UserDataRelocationMode::Connect, Some(&synced))
            .unwrap();
        execute(&plan, &folders.current, |_| Ok(())).unwrap();
        assert!(folders.current.join("chats/a.json").is_file());
    }

    #[test]
    fn use_default_uses_the_default_folder_only_when_supported() {
        let folders = Folders::new("user-data-reset");
        fs::create_dir_all(folders.default.join("chats")).unwrap();
        assert_eq!(
            folders
                .plan(UserDataRelocationMode::UseDefault, None)
                .unwrap(),
            RelocationPlan::Use {
                to: folders.default.clone()
            }
        );
        // data of a newer layout is not used: it would only be read
        fs::write(
            folders.default.join(USER_MARKER_FILE),
            format!(r#"{{"formatVersion":{}}}"#, USER_FORMAT_VERSION + 1),
        )
        .unwrap();
        assert!(matches!(
            folders.plan(UserDataRelocationMode::UseDefault, None),
            Err(AppError::UnsupportedConfig(_))
        ));
    }
}
