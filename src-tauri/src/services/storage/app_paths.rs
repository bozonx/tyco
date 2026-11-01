//! Where the app keeps its files, following each platform's conventions:
//!
//! | purpose | Linux (XDG)                 | macOS                          | Windows                |
//! | ------- | --------------------------- | ------------------------------ | ---------------------- |
//! | device  | `~/.config/<id>`            | `~/Library/Application Support/<id>.device` | `%LOCALAPPDATA%\<id>\device` |
//! | data    | `~/.local/share/<id>`       | `~/Library/Application Support/<id>` | `%APPDATA%\<id>` |
//! | state   | `~/.local/state/<id>`       | `~/Library/Application Support/<id>` | `%LOCALAPPDATA%\<id>` |
//! | cache   | `~/.cache/<id>`             | `~/Library/Caches/<id>`        | `%LOCALAPPDATA%\<id>`  |
//! | logs    | `~/.local/state/<id>/logs`  | `~/Library/Logs/<id>`          | `%LOCALAPPDATA%\<id>\logs` |
//!
//! `device` holds the files of this machine only (`device.json`,
//! `secrets.json`); it is never the user data folder nor inside it. `data` is
//! the default user data folder, see `user_data`: the user may pick another
//! one, e.g. a synced folder. On Windows the device folder is a subfolder of
//! the local one, apart from the cache, and never in the roaming `%APPDATA%`,
//! which a domain profile carries to other machines.
//!
//! The webview keeps its own storage (local storage, its HTTP cache) in a
//! `webview` folder of `state`, apart from the app's files; WKWebView on
//! macOS has no such setting.
//!
//! The state directory holds logs, platform webview state and the files
//! derived from the user data or kept aside from it (indexes, recovery
//! copies). `SessionState` lives only in memory.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::errors::AppError;

#[cfg(debug_assertions)]
const DEV_HOME_ENV: &str = "TYCO_DEV_HOME";
/// The folder of the webview storage, see `AppPaths::webview_dir`.
const WEBVIEW_DIR: &str = "webview";
/// The device folder inside the local one on Windows.
#[cfg_attr(not(any(target_os = "windows", test)), allow(dead_code))]
const DEVICE_SUBDIR: &str = "device";

/// The device folder next to the data folder, where the platform puts the
/// config into the data folder (macOS).
#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
fn sibling_device_dir(data_dir: &Path) -> PathBuf {
    let mut name = data_dir.file_name().unwrap_or_default().to_os_string();
    name.push(".device");
    data_dir.with_file_name(name)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppPaths {
    /// The files of this machine only.
    pub device_dir: PathBuf,
    /// The default user data folder.
    pub data_dir: PathBuf,
    pub state_dir: PathBuf,
    pub cache_dir: PathBuf,
    pub log_dir: PathBuf,
}

impl AppPaths {
    /// Where the webviews keep their storage; `None` where it cannot be set.
    pub fn webview_dir(&self) -> Option<PathBuf> {
        if cfg!(target_os = "macos") {
            None
        } else {
            Some(self.state_dir.join(WEBVIEW_DIR))
        }
    }

    pub fn resolve(app: &AppHandle) -> Result<Self, AppError> {
        let identifier = &app.config().identifier;
        if let Some(paths) = dev_paths_from_env(identifier)? {
            return Ok(paths);
        }

        let resolver = app.path();
        let data_dir = resolver.app_data_dir()?;
        let state_dir = if cfg!(target_os = "macos") {
            data_dir.clone()
        } else if cfg!(target_os = "windows") {
            resolver.app_local_data_dir()?
        } else {
            xdg_state_dir(identifier)?
        };
        let log_dir = if cfg!(any(target_os = "macos", target_os = "windows")) {
            resolver.app_log_dir()?
        } else {
            state_dir.join("logs")
        };
        let device_dir = if cfg!(target_os = "windows") {
            state_dir.join(DEVICE_SUBDIR)
        } else if cfg!(target_os = "macos") {
            sibling_device_dir(&data_dir)
        } else {
            resolver.app_config_dir()?
        };
        Ok(Self {
            device_dir,
            data_dir,
            state_dir,
            cache_dir: resolver.app_cache_dir()?,
            log_dir,
        })
    }
}

/// The log directory where the logger has to know it before the app is
/// built; `None` leaves it to Tauri, whose directory is the right one there.
pub fn early_log_dir(identifier: &str) -> Result<Option<PathBuf>, AppError> {
    if let Some(paths) = dev_paths_from_env(identifier)? {
        return Ok(Some(paths.log_dir));
    }
    if cfg!(any(target_os = "macos", target_os = "windows")) {
        return Ok(None);
    }
    // without a home directory Tauri's directory is still better than none
    Ok(xdg_state_dir(identifier).ok().map(|dir| dir.join("logs")))
}

fn xdg_state_dir(identifier: &str) -> Result<PathBuf, AppError> {
    let state_home = state_home(
        std::env::var_os("XDG_STATE_HOME").map(PathBuf::from),
        std::env::var_os("HOME").map(PathBuf::from),
    )
    .ok_or_else(|| {
        AppError::ServiceUnavailable(String::from("Could not find the home directory"))
    })?;
    Ok(state_home.join(identifier))
}

/// `$XDG_STATE_HOME`, or its default when it is unset or not absolute, as
/// the specification asks.
fn state_home(xdg_state_home: Option<PathBuf>, home: Option<PathBuf>) -> Option<PathBuf> {
    xdg_state_home
        .filter(|path| path.is_absolute())
        .or_else(|| {
            home.filter(|path| path.is_absolute())
                .map(|home| home.join(".local/state"))
        })
}

#[cfg(debug_assertions)]
pub fn dev_paths_from_env(identifier: &str) -> Result<Option<AppPaths>, AppError> {
    let Some(home) = std::env::var_os(DEV_HOME_ENV) else {
        return Ok(None);
    };
    let home = PathBuf::from(home);
    if !home.is_absolute() {
        return Err(AppError::InvalidInput(format!(
            "{DEV_HOME_ENV} must be an absolute path: {}",
            home.display()
        )));
    }

    Ok(Some(dev_paths(&home, identifier)))
}

#[cfg(not(debug_assertions))]
pub fn dev_paths_from_env(_identifier: &str) -> Result<Option<AppPaths>, AppError> {
    Ok(None)
}

#[cfg(any(debug_assertions, test))]
fn dev_paths(home: &Path, identifier: &str) -> AppPaths {
    #[cfg(target_os = "macos")]
    let paths = AppPaths {
        device_dir: sibling_device_dir(&home.join("Library/Application Support").join(identifier)),
        data_dir: home.join("Library/Application Support").join(identifier),
        state_dir: home.join("Library/Application Support").join(identifier),
        cache_dir: home.join("Library/Caches").join(identifier),
        log_dir: home.join("Library/Logs").join(identifier),
    };

    #[cfg(target_os = "windows")]
    let paths = AppPaths {
        device_dir: home
            .join("AppData/Local")
            .join(identifier)
            .join(DEVICE_SUBDIR),
        data_dir: home.join("AppData/Roaming").join(identifier),
        state_dir: home.join("AppData/Local").join(identifier),
        cache_dir: home.join("AppData/Local").join(identifier),
        log_dir: home.join("AppData/Local").join(identifier).join("logs"),
    };

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let paths = AppPaths {
        device_dir: home.join(".config").join(identifier),
        data_dir: home.join(".local/share").join(identifier),
        state_dir: home.join(".local/state").join(identifier),
        cache_dir: home.join(".cache").join(identifier),
        log_dir: home.join(".local/state").join(identifier).join("logs"),
    };

    paths
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dev_paths_follow_the_platform_home_layout() {
        let home = Path::new("/repository/dev_files/platform");
        let paths = dev_paths(home, "com.tyco.app");

        #[cfg(target_os = "linux")]
        {
            assert_eq!(paths.device_dir, home.join(".config/com.tyco.app"));
            assert_eq!(
                paths.webview_dir(),
                Some(home.join(".local/state/com.tyco.app/webview"))
            );
            assert_eq!(paths.data_dir, home.join(".local/share/com.tyco.app"));
            assert_eq!(paths.state_dir, home.join(".local/state/com.tyco.app"));
            assert_eq!(paths.cache_dir, home.join(".cache/com.tyco.app"));
            assert_eq!(paths.log_dir, home.join(".local/state/com.tyco.app/logs"));
        }

        #[cfg(target_os = "macos")]
        {
            assert_eq!(
                paths.device_dir,
                home.join("Library/Application Support/com.tyco.app.device")
            );
            assert_eq!(paths.state_dir, paths.data_dir);
            assert_eq!(paths.cache_dir, home.join("Library/Caches/com.tyco.app"));
            assert_eq!(paths.log_dir, home.join("Library/Logs/com.tyco.app"));
        }

        #[cfg(target_os = "windows")]
        {
            assert_eq!(
                paths.device_dir,
                home.join("AppData/Local/com.tyco.app/device")
            );
            assert_eq!(paths.data_dir, home.join("AppData/Roaming/com.tyco.app"));
            assert_eq!(paths.state_dir, home.join("AppData/Local/com.tyco.app"));
            assert_eq!(paths.cache_dir, home.join("AppData/Local/com.tyco.app"));
            assert_eq!(paths.log_dir, home.join("AppData/Local/com.tyco.app/logs"));
        }
    }

    #[test]
    fn the_device_folder_is_never_the_data_folder_nor_inside_it() {
        let paths = dev_paths(Path::new("/home/user"), "com.tyco.app");
        assert!(!paths.device_dir.starts_with(&paths.data_dir));
        assert!(!paths.data_dir.starts_with(&paths.device_dir));
        assert_ne!(paths.device_dir, paths.state_dir);
        assert_ne!(paths.device_dir, paths.cache_dir);
        assert_eq!(
            sibling_device_dir(Path::new("/a/com.tyco.app")),
            PathBuf::from("/a/com.tyco.app.device")
        );
    }

    #[test]
    fn state_home_falls_back_to_the_xdg_default() {
        let home = Some(PathBuf::from("/home/user"));
        assert_eq!(
            state_home(Some(PathBuf::from("/var/state")), home.clone()),
            Some(PathBuf::from("/var/state"))
        );
        assert_eq!(
            state_home(None, home.clone()),
            Some(PathBuf::from("/home/user/.local/state"))
        );
        // a relative value is invalid and ignored
        assert_eq!(
            state_home(Some(PathBuf::from("state")), home),
            Some(PathBuf::from("/home/user/.local/state"))
        );
        assert_eq!(state_home(None, None), None);
    }
}
