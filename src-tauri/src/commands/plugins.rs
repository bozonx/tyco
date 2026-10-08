use std::path::Path;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;

use crate::errors::AppError;
use crate::services::plugins::{self, InstalledPlugin, PluginManifest, PluginStore};

#[derive(Serialize)]
pub struct PluginPreview {
    path: String,
    digest: String,
    manifest: PluginManifest,
}

#[tauri::command(async)]
pub fn inspect_plugin_package(app: AppHandle) -> Result<Option<PluginPreview>, AppError> {
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
}
#[tauri::command(async)]
pub fn list_installed_plugins(
    store: State<'_, PluginStore>,
) -> Result<Vec<InstalledPlugin>, AppError> {
    store.list()
}
#[tauri::command(async)]
pub fn install_plugin_package(
    app: AppHandle,
    store: State<'_, PluginStore>,
    path: String,
    manifest: PluginManifest,
    digest: String,
) -> Result<InstalledPlugin, AppError> {
    let result = store.install(Path::new(&path), &manifest, &digest)?;
    app.emit("plugins-changed", ())?;
    Ok(result)
}
#[tauri::command(async)]
pub fn remove_plugin_package(
    app: AppHandle,
    store: State<'_, PluginStore>,
    id: String,
) -> Result<(), AppError> {
    store.remove(&id)?;
    app.emit("plugins-changed", ())?;
    Ok(())
}

#[tauri::command(async)]
pub fn restore_plugin_package(
    app: AppHandle,
    store: State<'_, PluginStore>,
    id: String,
) -> Result<(), AppError> {
    store.restore(&id)?;
    app.emit("plugins-changed", ())?;
    Ok(())
}
