use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::errors::AppError;

const DEV_HOME_ENV: &str = "TYCO_DEV_HOME";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppPaths {
    pub config_dir: PathBuf,
    pub data_dir: PathBuf,
    pub cache_dir: PathBuf,
    pub log_dir: PathBuf,
}

impl AppPaths {
    pub fn resolve(app: &AppHandle) -> Result<Self, AppError> {
        if let Some(paths) = dev_paths_from_env(&app.config().identifier)? {
            return Ok(paths);
        }

        let resolver = app.path();
        Ok(Self {
            config_dir: resolver
                .app_config_dir()
                .map_err(|error| AppError::Message(error.to_string()))?,
            data_dir: resolver
                .app_data_dir()
                .map_err(|error| AppError::Message(error.to_string()))?,
            cache_dir: resolver
                .app_cache_dir()
                .map_err(|error| AppError::Message(error.to_string()))?,
            log_dir: resolver
                .app_log_dir()
                .map_err(|error| AppError::Message(error.to_string()))?,
        })
    }
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
    #[cfg(target_os = "linux")]
    return AppPaths {
        config_dir: home.join(".config").join(identifier),
        data_dir: home.join(".local/share").join(identifier),
        cache_dir: home.join(".cache").join(identifier),
        log_dir: home.join(".local/share").join(identifier).join("logs"),
    };

    #[cfg(target_os = "macos")]
    return AppPaths {
        config_dir: home.join("Library/Application Support").join(identifier),
        data_dir: home.join("Library/Application Support").join(identifier),
        cache_dir: home.join("Library/Caches").join(identifier),
        log_dir: home.join("Library/Logs").join(identifier),
    };

    #[cfg(target_os = "windows")]
    return AppPaths {
        config_dir: home.join("AppData/Roaming").join(identifier),
        data_dir: home.join("AppData/Roaming").join(identifier),
        cache_dir: home.join("AppData/Local").join(identifier),
        log_dir: home.join("AppData/Local").join(identifier).join("logs"),
    };

    #[allow(unreachable_code)]
    AppPaths {
        config_dir: home.join(".config").join(identifier),
        data_dir: home.join(".local/share").join(identifier),
        cache_dir: home.join(".cache").join(identifier),
        log_dir: home.join(".local/share").join(identifier).join("logs"),
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
            assert_eq!(paths.cache_dir, home.join(".cache/com.tyco.app"));
            assert_eq!(paths.log_dir, home.join(".local/share/com.tyco.app/logs"));
        }

        #[cfg(target_os = "macos")]
        {
            assert_eq!(
                paths.config_dir,
                home.join("Library/Application Support/com.tyco.app")
            );
            assert_eq!(paths.cache_dir, home.join("Library/Caches/com.tyco.app"));
            assert_eq!(paths.log_dir, home.join("Library/Logs/com.tyco.app"));
        }

        #[cfg(target_os = "windows")]
        {
            assert_eq!(paths.config_dir, home.join("AppData/Roaming/com.tyco.app"));
            assert_eq!(paths.cache_dir, home.join("AppData/Local/com.tyco.app"));
            assert_eq!(paths.log_dir, home.join("AppData/Local/com.tyco.app/logs"));
        }
    }
}
