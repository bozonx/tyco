//! Where the app keeps its files, following each platform's conventions:
//!
//! | purpose | Linux (XDG)                 | macOS                          | Windows                |
//! | ------- | --------------------------- | ------------------------------ | ---------------------- |
//! | config  | `~/.config/<id>`            | `~/Library/Application Support/<id>` | `%APPDATA%\<id>` |
//! | data    | `~/.local/share/<id>`       | `~/Library/Application Support/<id>` | `%APPDATA%\<id>` |
//! | state   | `~/.local/state/<id>`       | `~/Library/Application Support/<id>` | `%LOCALAPPDATA%\<id>` |
//! | cache   | `~/.cache/<id>`             | `~/Library/Caches/<id>`        | `%LOCALAPPDATA%\<id>`  |
//! | logs    | `~/.local/state/<id>/logs`  | `~/Library/Logs/<id>`          | `%LOCALAPPDATA%\<id>\logs` |
//!
//! State is what the app remembers between runs but the user would not back
//! up: the last mode, the last chat. Tauri has no state directory, and puts
//! the logs into the data directory on Linux, while the XDG base directory
//! specification keeps both in `$XDG_STATE_HOME`.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::errors::AppError;

const DEV_HOME_ENV: &str = "TYCO_DEV_HOME";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppPaths {
    pub config_dir: PathBuf,
    pub data_dir: PathBuf,
    pub state_dir: PathBuf,
    pub cache_dir: PathBuf,
    pub log_dir: PathBuf,
}

impl AppPaths {
    pub fn resolve(app: &AppHandle) -> Result<Self, AppError> {
        let identifier = &app.config().identifier;
        if let Some(paths) = dev_paths_from_env(identifier)? {
            return Ok(paths);
        }

        let resolver = app.path();
        let error = |error: tauri::Error| AppError::Message(error.to_string());
        let data_dir = resolver.app_data_dir().map_err(error)?;
        let state_dir = if cfg!(target_os = "macos") {
            data_dir.clone()
        } else if cfg!(target_os = "windows") {
            resolver.app_local_data_dir().map_err(error)?
        } else {
            xdg_state_dir(identifier)?
        };
        let log_dir = if cfg!(any(target_os = "macos", target_os = "windows")) {
            resolver.app_log_dir().map_err(error)?
        } else {
            state_dir.join("logs")
        };
        Ok(Self {
            config_dir: resolver.app_config_dir().map_err(error)?,
            data_dir,
            state_dir,
            cache_dir: resolver.app_cache_dir().map_err(error)?,
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
    .ok_or_else(|| AppError::Message(String::from("Could not find the home directory")))?;
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
        return Err(AppError::Message(format!(
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

fn dev_paths(home: &Path, identifier: &str) -> AppPaths {
    #[cfg(target_os = "macos")]
    return AppPaths {
        config_dir: home.join("Library/Application Support").join(identifier),
        data_dir: home.join("Library/Application Support").join(identifier),
        state_dir: home.join("Library/Application Support").join(identifier),
        cache_dir: home.join("Library/Caches").join(identifier),
        log_dir: home.join("Library/Logs").join(identifier),
    };

    #[cfg(target_os = "windows")]
    return AppPaths {
        config_dir: home.join("AppData/Roaming").join(identifier),
        data_dir: home.join("AppData/Roaming").join(identifier),
        state_dir: home.join("AppData/Local").join(identifier),
        cache_dir: home.join("AppData/Local").join(identifier),
        log_dir: home.join("AppData/Local").join(identifier).join("logs"),
    };

    #[allow(unreachable_code)]
    AppPaths {
        config_dir: home.join(".config").join(identifier),
        data_dir: home.join(".local/share").join(identifier),
        state_dir: home.join(".local/state").join(identifier),
        cache_dir: home.join(".cache").join(identifier),
        log_dir: home.join(".local/state").join(identifier).join("logs"),
    }
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
            assert_eq!(paths.config_dir, home.join(".config/com.tyco.app"));
            assert_eq!(paths.data_dir, home.join(".local/share/com.tyco.app"));
            assert_eq!(paths.state_dir, home.join(".local/state/com.tyco.app"));
            assert_eq!(paths.cache_dir, home.join(".cache/com.tyco.app"));
            assert_eq!(paths.log_dir, home.join(".local/state/com.tyco.app/logs"));
        }

        #[cfg(target_os = "macos")]
        {
            assert_eq!(
                paths.config_dir,
                home.join("Library/Application Support/com.tyco.app")
            );
            assert_eq!(paths.state_dir, paths.data_dir);
            assert_eq!(paths.cache_dir, home.join("Library/Caches/com.tyco.app"));
            assert_eq!(paths.log_dir, home.join("Library/Logs/com.tyco.app"));
        }

        #[cfg(target_os = "windows")]
        {
            assert_eq!(paths.config_dir, home.join("AppData/Roaming/com.tyco.app"));
            assert_eq!(paths.state_dir, home.join("AppData/Local/com.tyco.app"));
            assert_eq!(paths.cache_dir, home.join("AppData/Local/com.tyco.app"));
            assert_eq!(paths.log_dir, home.join("AppData/Local/com.tyco.app/logs"));
        }
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
