//! The user data folder: everything the user made and set up (settings,
//! commands, history, chats, plugins, profiles), in one folder the user may
//! sync to other machines. It is the default data folder of the platform
//! unless the user chose another one (`userDataPath` of `device.json`).
//!
//! `tyco-user.json` marks a folder as Tyco's. A chosen folder without it, or
//! one that is missing or empty, is not connected: nothing is created or
//! written there, as an empty set of data a sync tool spreads would wipe out
//! the real one. A folder laid out by a newer Tyco is read and never written.
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};

use crate::locks::RwLockExt;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::errors::AppError;
use crate::models::{UserDataState, UserDataStatus};
use crate::services::atomic_file::{create_private_dir, write_private};
use crate::services::variables::{Builtins, VariableValues};

pub const USER_MARKER_FILE: &str = "tyco-user.json";
/// The layout of the folder: names of files and folders, not the schema of
/// the settings, which `configVersion` counts.
pub const USER_FORMAT_VERSION: u64 = 1;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UserMarker {
    format_version: u64,
    /// Made once with the marker and never changed: every device of the
    /// folder reads the same one, see [`marker_data_id`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    data_id: Option<String>,
}

/// What a folder's marker says.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Marker {
    Missing,
    Unreadable,
    Version(u64),
}

fn read_marker(dir: &Path) -> Marker {
    match fs::read(dir.join(USER_MARKER_FILE)) {
        Ok(raw) => serde_json::from_slice::<UserMarker>(&raw)
            .map_or(Marker::Unreadable, |marker| {
                Marker::Version(marker.format_version)
            }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Marker::Missing,
        Err(_) => Marker::Unreadable,
    }
}

/// Whether `dir` has a marker, of any version: a folder of Tyco data.
pub fn has_marker(dir: &Path) -> bool {
    !matches!(read_marker(dir), Marker::Missing)
}

/// The format version of the marker in `dir`, when it can be read.
pub fn marker_version(dir: &Path) -> Option<u64> {
    match read_marker(dir) {
        Marker::Version(version) => Some(version),
        _ => None,
    }
}

/// The id of the data folder in `dir`, when its marker has one; markers
/// made before the id have none.
pub fn marker_data_id(dir: &Path) -> Option<String> {
    let raw = fs::read(dir.join(USER_MARKER_FILE)).ok()?;
    serde_json::from_slice::<UserMarker>(&raw)
        .ok()?
        .data_id
        .filter(|id| !id.trim().is_empty())
}

pub fn write_marker(dir: &Path) -> Result<(), AppError> {
    write_private(
        &dir.join(USER_MARKER_FILE),
        &serde_json::to_string_pretty(&UserMarker {
            format_version: USER_FORMAT_VERSION,
            data_id: Some(crate::services::random_id::new_uuid()),
        })?,
    )
}

/// Which access an operation needs: a folder of a newer layout is read only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UserDirAccess {
    Read,
    Write,
}

/// The user data folder this process uses; resolved once at startup.
#[derive(Debug, Clone)]
pub struct UserData {
    pub dir: PathBuf,
    pub default_dir: PathBuf,
    pub status: UserDataStatus,
    pub is_writable_by_others: bool,
    /// The id of this device, set once the device file is read.
    pub device_id: String,
    disconnected: Arc<AtomicBool>,
}

impl UserData {
    /// Resolves the folder: the default one when `configured` is empty, which
    /// gets its marker when it has none, or the chosen one, used only as it
    /// is.
    pub fn resolve(default_dir: &Path, configured: &str) -> Self {
        let configured = configured.trim();
        let (dir, status) = if configured.is_empty() {
            (default_dir.to_path_buf(), open_default_dir(default_dir))
        } else {
            let dir = PathBuf::from(configured);
            let status = chosen_dir_status(&dir);
            (dir, status)
        };
        let is_writable_by_others = status != UserDataStatus::NotConnected
            && !configured.is_empty()
            && is_writable_by_others(&dir);
        Self {
            dir,
            default_dir: default_dir.to_path_buf(),
            status,
            is_writable_by_others,
            device_id: String::new(),
            disconnected: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn is_default(&self) -> bool {
        self.dir == self.default_dir
    }

    pub fn state(&self) -> UserDataState {
        UserDataState {
            path: self.dir.to_string_lossy().into_owned(),
            default_path: self.default_dir.to_string_lossy().into_owned(),
            is_default: self.is_default(),
            status: self.current_status(),
            is_writable_by_others: self.is_writable_by_others,
            device_id: self.device_id.clone(),
            platform: crate::services::platform::hotkeys::platform_name().to_owned(),
        }
    }

    /// The folder, when it allows `access`.
    pub fn dir_for(&self, access: UserDirAccess) -> Result<&Path, AppError> {
        match (self.current_status(), access) {
            (UserDataStatus::Connected, _) | (UserDataStatus::NewerFormat, UserDirAccess::Read) => {
                Ok(&self.dir)
            }
            (UserDataStatus::NotConnected, _) => Err(AppError::UserDataUnavailable(format!(
                "The data folder is not connected: {}",
                self.dir.display()
            ))),
            (UserDataStatus::NewerFormat, UserDirAccess::Write) => {
                Err(AppError::UserDataUnavailable(format!(
                    "The data folder was laid out by a newer version of Tyco and is read only: {}",
                    self.dir.display()
                )))
            }
        }
    }

    pub fn is_writable(&self) -> bool {
        self.dir_for(UserDirAccess::Write).is_ok()
    }

    fn current_status(&self) -> UserDataStatus {
        // Once disconnected, resuming requires a restart, including when a
        // mounted folder returns. Cached services must not reconnect silently.
        if self.status == UserDataStatus::NotConnected || self.disconnected.load(Ordering::SeqCst) {
            return UserDataStatus::NotConnected;
        }
        let current = chosen_dir_status(&self.dir);
        if current == UserDataStatus::NotConnected {
            self.disconnected.store(true, Ordering::SeqCst);
        }
        if current == UserDataStatus::Connected && self.status == UserDataStatus::NewerFormat {
            UserDataStatus::NewerFormat
        } else {
            current
        }
    }
}

// Guard cached paths too: plugins, config files and history retain paths beyond
// the call that resolved them. Recheck before creating or mutating their files.
static USER_ROOTS: RwLock<Vec<UserData>> = RwLock::new(Vec::new());

pub(crate) fn register_write_guard(data: &UserData) {
    let mut roots = USER_ROOTS.write_locked();
    roots.retain(|root| root.dir != data.dir);
    roots.push(data.clone());
}

pub(crate) fn ensure_write_allowed(path: &Path) -> Result<(), AppError> {
    ensure_access_allowed(path, UserDirAccess::Write)
}

pub(crate) fn ensure_read_allowed(path: &Path) -> Result<(), AppError> {
    ensure_access_allowed(path, UserDirAccess::Read)
}

fn ensure_access_allowed(path: &Path, access: UserDirAccess) -> Result<(), AppError> {
    let roots = USER_ROOTS.read_locked();
    if let Some(root) = roots
        .iter()
        .filter(|root| path.starts_with(&root.dir))
        .max_by_key(|root| root.dir.components().count())
    {
        root.dir_for(access)?;
    }
    Ok(())
}

/// The default folder is not chosen by the user and never counts as synced:
/// it is created, and marked, when it is not there. What it holds already,
/// e.g. data of an earlier installation, is used as it is.
fn open_default_dir(dir: &Path) -> UserDataStatus {
    if matches!(read_marker(dir), Marker::Version(version) if version > USER_FORMAT_VERSION) {
        return UserDataStatus::NewerFormat;
    }
    if let Err(error) = create_private_dir(dir) {
        log::error!(
            "Could not create the data folder {}: {error}",
            dir.display()
        );
        return UserDataStatus::NotConnected;
    }
    match read_marker(dir) {
        Marker::Version(version) if version > USER_FORMAT_VERSION => UserDataStatus::NewerFormat,
        Marker::Version(_) => UserDataStatus::Connected,
        marker => {
            if marker == Marker::Unreadable {
                if let Err(error) =
                    crate::services::atomic_file::quarantine(&dir.join(USER_MARKER_FILE))
                {
                    log::warn!("Could not set the unreadable data folder marker aside: {error}");
                }
            }
            match write_marker(dir) {
                Ok(()) => UserDataStatus::Connected,
                Err(error) => {
                    log::error!("Could not mark the data folder {}: {error}", dir.display());
                    UserDataStatus::NotConnected
                }
            }
        }
    }
}

/// A chosen folder is used only when it is there with its marker.
fn chosen_dir_status(dir: &Path) -> UserDataStatus {
    if !dir.is_absolute() || !dir.is_dir() {
        return UserDataStatus::NotConnected;
    }
    match read_marker(dir) {
        Marker::Version(version) if version > USER_FORMAT_VERSION => UserDataStatus::NewerFormat,
        Marker::Version(_) => UserDataStatus::Connected,
        // an empty folder, e.g. a mount point of a drive not mounted, or one
        // a sync has not filled yet
        Marker::Missing | Marker::Unreadable => UserDataStatus::NotConnected,
    }
}

/// Whether other users may write into `dir` or its parent: then they may
/// change the commands Tyco runs. Checked on Linux only.
#[cfg(unix)]
fn is_writable_by_others(dir: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    // SAFETY: geteuid has no preconditions and cannot fail.
    let user = unsafe { libc::geteuid() };
    [Some(dir), dir.parent()]
        .into_iter()
        .flatten()
        .filter_map(|path| fs::metadata(path).ok())
        .any(|metadata| {
            let is_shared = metadata.mode() & 0o022 != 0;
            // a sticky folder such as /tmp lets nobody replace another's entry
            let is_sticky_parent = metadata.mode() & 0o1000 != 0;
            (metadata.uid() != user && metadata.uid() != 0) || (is_shared && !is_sticky_parent)
        })
}

#[cfg(not(unix))]
fn is_writable_by_others(_dir: &Path) -> bool {
    false
}

/// Resolves the folders at startup and manages what is built on them: the
/// device file, the user data folder, the plugin store and the config files.
/// Kept-aside copies of their files go to the recovery folder of the state.
pub fn open_user_data(app: &tauri::App) -> Result<UserData, AppError> {
    use super::device::{DeviceStore, DEVICE_FILE_NAME};
    use crate::services::atomic_file::register_recovery_root;
    use crate::services::plugins::PluginStore;

    let paths = super::app_paths::AppPaths::resolve(app.handle())?;
    let recovery = paths.state_dir.join(RECOVERY_DIR);
    register_recovery_root(&paths.device_dir, &recovery.join("device"));
    let device = DeviceStore::open(
        paths.device_dir.join(DEVICE_FILE_NAME),
        crate::services::platform::machine::machine_id(),
    )?;
    let mut data = UserData::resolve(&paths.data_dir, &device.snapshot().user_data_path);
    data.device_id = device.device_id();
    register_write_guard(&data);
    match data.status {
        UserDataStatus::Connected => {
            register_recovery_root(&data.dir, &recovery.join("user"));
            app.manage(PluginStore::new(data.dir.join(PLUGINS_DIR)));
        }
        UserDataStatus::NewerFormat => {
            register_recovery_root(&data.dir, &recovery.join("user"));
            app.manage(PluginStore::read_only(data.dir.join(PLUGINS_DIR)));
        }
        UserDataStatus::NotConnected => {
            log::warn!("The data folder is not connected: {}", data.dir.display());
            app.manage(PluginStore::unavailable(format!(
                "The data folder is not connected: {}",
                data.dir.display()
            )));
        }
    }
    app.manage(crate::services::settings::persist::ConfigFiles::new(
        &data,
        &paths.state_dir,
    ));
    app.manage(device);
    app.manage(data.clone());
    Ok(data)
}

/// The folder of the state that keeps the copies set aside.
pub const RECOVERY_DIR: &str = "recovery";
/// The folder of the user data that holds the installed plugins.
pub const PLUGINS_DIR: &str = "plugins";

/// The user data folder of the app, for writing: an error while it is not
/// connected or of a newer layout.
pub fn user_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    user_dir_for(app, UserDirAccess::Write)
}

pub fn user_dir_for(app: &AppHandle, access: UserDirAccess) -> Result<PathBuf, AppError> {
    let data = app.try_state::<UserData>().ok_or_else(|| {
        AppError::ServiceUnavailable(String::from("The data folder is not resolved yet"))
    })?;
    data.dir_for(access).map(Path::to_path_buf)
}

/// The values the variables of `config` have on this device, the built-in
/// ones included; see `services::variables`.
pub fn variable_values(app: &AppHandle, config: &serde_json::Value) -> VariableValues {
    let data = app.try_state::<UserData>();
    let user_dir = data
        .as_ref()
        .map(|data| data.dir.to_string_lossy().into_owned())
        .unwrap_or_default();
    let device_id = data
        .as_ref()
        .map(|data| data.device_id.clone())
        .unwrap_or_default();
    VariableValues::of(
        config,
        &Builtins {
            user_dir: &user_dir,
            device_id: &device_id,
        },
    )
}

/// A folder of the user data folder, created for writing.
pub fn user_sub_dir(app: &AppHandle, sub: &str) -> Result<PathBuf, AppError> {
    let dir = user_dir(app)?.join(sub);
    create_private_dir(&dir)?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::test_support::TestDir;

    #[test]
    fn the_default_folder_is_created_and_marked() {
        let dir = TestDir::new("user-data-default");
        let default = dir.join("share/com.tyco.app");
        let data = UserData::resolve(&default, "");
        assert_eq!(data.status, UserDataStatus::Connected);
        assert!(data.is_default());
        assert_eq!(marker_version(&default), Some(USER_FORMAT_VERSION));
        assert!(data.dir_for(UserDirAccess::Write).is_ok());
    }

    #[test]
    fn the_default_folder_keeps_what_it_holds() {
        let dir = TestDir::new("user-data-default-existing");
        fs::create_dir_all(dir.join("chats")).unwrap();
        fs::write(dir.join("chats/a.json"), "{}").unwrap();
        let data = UserData::resolve(&dir, "");
        assert_eq!(data.status, UserDataStatus::Connected);
        assert_eq!(fs::read_to_string(dir.join("chats/a.json")).unwrap(), "{}");
    }

    #[test]
    fn a_chosen_folder_without_its_marker_is_not_connected() {
        let dir = TestDir::new("user-data-chosen");
        let default = dir.join("default");
        for chosen in [dir.join("missing"), dir.join("empty"), dir.join("unmarked")] {
            if chosen.ends_with("empty") {
                fs::create_dir_all(&chosen).unwrap();
            }
            if chosen.ends_with("unmarked") {
                fs::create_dir_all(chosen.join("chats")).unwrap();
                fs::write(chosen.join("config.json"), "{}").unwrap();
            }
            let data = UserData::resolve(&default, chosen.to_str().unwrap());
            assert_eq!(data.status, UserDataStatus::NotConnected, "{chosen:?}");
            assert!(matches!(
                data.dir_for(UserDirAccess::Read),
                Err(AppError::UserDataUnavailable(_))
            ));
            // nothing is created there
            assert!(!chosen.join(USER_MARKER_FILE).exists());
        }
        assert!(!dir.join("missing").exists());
        assert_eq!(fs::read_dir(dir.join("empty")).unwrap().count(), 0);
        let data = UserData::resolve(&default, "relative/path");
        assert_eq!(data.status, UserDataStatus::NotConnected);
    }

    #[test]
    fn a_marked_chosen_folder_is_connected() {
        let dir = TestDir::new("user-data-marked");
        let chosen = dir.join("sync");
        fs::create_dir_all(&chosen).unwrap();
        write_marker(&chosen).unwrap();
        let data = UserData::resolve(&dir.join("default"), chosen.to_str().unwrap());
        assert_eq!(data.status, UserDataStatus::Connected);
        assert!(!data.is_default());
        assert_eq!(data.dir_for(UserDirAccess::Write).unwrap(), chosen);
    }

    #[test]
    fn a_folder_of_a_newer_layout_is_read_only() {
        let dir = TestDir::new("user-data-newer");
        let chosen = dir.join("sync");
        fs::create_dir_all(&chosen).unwrap();
        fs::write(
            chosen.join(USER_MARKER_FILE),
            format!(r#"{{"formatVersion":{}}}"#, USER_FORMAT_VERSION + 1),
        )
        .unwrap();
        let data = UserData::resolve(&dir.join("default"), chosen.to_str().unwrap());
        assert_eq!(data.status, UserDataStatus::NewerFormat);
        assert!(data.dir_for(UserDirAccess::Read).is_ok());
        assert!(data.dir_for(UserDirAccess::Write).is_err());
        let default = UserData::resolve(&chosen, "");
        assert_eq!(default.status, UserDataStatus::NewerFormat);
    }

    #[test]
    fn cached_writers_do_not_recreate_a_disconnected_root() {
        let dir = TestDir::new("user-data-disconnect");
        let root = dir.join("chosen");
        fs::create_dir(&root).unwrap();
        write_marker(&root).unwrap();
        let data = UserData::resolve(&dir.join("default"), root.to_str().unwrap());
        register_write_guard(&data);
        fs::rename(&root, dir.join("unmounted")).unwrap();
        assert!(create_private_dir(&root.join("history/editor")).is_err());
        assert!(!root.exists());
        assert_eq!(data.state().status, UserDataStatus::NotConnected);
        fs::rename(dir.join("unmounted"), &root).unwrap();
        assert!(
            data.dir_for(UserDirAccess::Write).is_err(),
            "a restart is required"
        );
    }

    #[test]
    fn a_marker_changed_to_a_newer_layout_blocks_cached_writers() {
        let dir = TestDir::new("user-data-newer-live");
        write_marker(&dir).unwrap();
        let data = UserData::resolve(&dir.join("default"), dir.to_str().unwrap());
        register_write_guard(&data);
        fs::write(dir.join(USER_MARKER_FILE), r#"{"formatVersion":2}"#).unwrap();
        assert!(data.dir_for(UserDirAccess::Read).is_ok());
        assert!(write_private(&dir.join("config.json"), "{}").is_err());
        assert!(!dir.join("config.json").exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_others_may_write_to_is_reported() {
        use std::os::unix::fs::PermissionsExt;
        let dir = TestDir::new("user-data-shared");
        let parent = dir.join("parent");
        let chosen = parent.join("sync");
        fs::create_dir_all(&chosen).unwrap();
        fs::set_permissions(&parent, fs::Permissions::from_mode(0o700)).unwrap();
        fs::set_permissions(&chosen, fs::Permissions::from_mode(0o700)).unwrap();
        write_marker(&chosen).unwrap();
        let data = UserData::resolve(&dir.join("default"), chosen.to_str().unwrap());
        assert!(!data.is_writable_by_others);
        fs::set_permissions(&chosen, fs::Permissions::from_mode(0o777)).unwrap();
        let data = UserData::resolve(&dir.join("default"), chosen.to_str().unwrap());
        assert!(data.is_writable_by_others);
        fs::set_permissions(&chosen, fs::Permissions::from_mode(0o700)).unwrap();
    }
}
