use std::path::Path;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

use super::run_blocking;
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
    run_blocking(move || {
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
    run_blocking(move || app.state::<PluginStore>().list()).await?
}

#[tauri::command]
pub async fn install_plugin_package(
    app: AppHandle,
    path: String,
    manifest: PluginManifest,
    digest: String,
) -> Result<InstalledPlugin, AppError> {
    run_blocking(move || {
        let result = app
            .state::<PluginStore>()
            .install(Path::new(&path), &manifest, &digest)?;
        publish_plugins_changed(&app);
        Ok(result)
    })
    .await?
}

#[tauri::command]
pub async fn remove_plugin_package(app: AppHandle, id: String) -> Result<(), AppError> {
    run_blocking(move || {
        app.state::<PluginStore>().remove(&id)?;
        publish_plugins_changed(&app);
        Ok(())
    })
    .await?
}

#[tauri::command]
pub async fn restore_plugin_package(app: AppHandle, id: String) -> Result<(), AppError> {
    run_blocking(move || {
        app.state::<PluginStore>().restore(&id)?;
        publish_plugins_changed(&app);
        Ok(())
    })
    .await?
}

fn publish_plugins_changed(app: &AppHandle) {
    if let Err(error) = app.emit("app://plugins-changed", ()) {
        log::warn!("Could not publish plugin changes: {error}");
    }
}

/// Writes only under a notes root saved by the user for this plugin.
#[tauri::command]
pub async fn write_plugin_note(
    app: AppHandle,
    plugin_id: String,
    dir: String,
    file_name: String,
    text: String,
    append: bool,
) -> Result<String, AppError> {
    run_blocking(move || {
        let field = app
            .state::<PluginStore>()
            .notes_directory_field(&plugin_id)?;
        let config = app
            .state::<crate::state::AppState>()
            .snapshot()
            .settings
            .user_config;
        let roots = plugins::approved_note_roots(&config, &plugin_id, &field)?;
        let path =
            crate::services::notes::write_scoped_note(&roots, &dir, &file_name, &text, append)?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await?
}
