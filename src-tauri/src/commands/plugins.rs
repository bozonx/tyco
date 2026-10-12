use std::path::Path;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

use super::blocking;
use crate::errors::AppError;
use crate::services::plugins::{self, InstalledPlugin, PluginManifest, PluginStore};

// The dialog waits for the user and the store reads packages of up to tens of
// megabytes, so every command runs on the blocking pool.

#[derive(Serialize)]
pub struct PluginPreview {
    path: String,
    digest: String,
    manifest: PluginManifest,
}

#[tauri::command]
pub async fn inspect_plugin_package(app: AppHandle) -> Result<Option<PluginPreview>, AppError> {
    blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .add_filter("TyCo plugin", &["tyco-plugin"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = file
            .into_path()
            .map_err(|reason| AppError::Message(reason.to_string()))?;
        let (package, digest) = plugins::inspect(&path)?;
        Ok(Some(PluginPreview {
            path: path.to_string_lossy().into_owned(),
            manifest: package.manifest,
            digest,
        }))
    })
    .await?
}

#[tauri::command]
pub async fn list_installed_plugins(app: AppHandle) -> Result<Vec<InstalledPlugin>, AppError> {
    blocking(move || app.state::<PluginStore>().list()).await?
}

#[tauri::command]
pub async fn install_plugin_package(
    app: AppHandle,
    path: String,
    manifest: PluginManifest,
    digest: String,
) -> Result<InstalledPlugin, AppError> {
    blocking(move || {
        let result = app
            .state::<PluginStore>()
            .install(Path::new(&path), &manifest, &digest)?;
        app.emit("plugins-changed", ())?;
        Ok(result)
    })
    .await?
}

#[tauri::command]
pub async fn remove_plugin_package(app: AppHandle, id: String) -> Result<(), AppError> {
    blocking(move || {
        app.state::<PluginStore>().remove(&id)?;
        app.emit("plugins-changed", ())?;
        Ok(())
    })
    .await?
}

#[tauri::command]
pub async fn restore_plugin_package(app: AppHandle, id: String) -> Result<(), AppError> {
    blocking(move || {
        app.state::<PluginStore>().restore(&id)?;
        app.emit("plugins-changed", ())?;
        Ok(())
    })
    .await?
}
