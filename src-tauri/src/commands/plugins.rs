use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use ts_rs::TS;

use super::run_blocking;
use crate::errors::AppError;
use crate::locks::MutexExt;
use crate::services::plugins::{self, InstalledPlugin, PluginManifest, PluginStore};

// The dialog waits for the user and the store reads packages of up to tens of
// megabytes, so every command runs on the blocking pool.

/// What a picked package would install, for the user to confirm.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PluginPackagePreview {
    /// What `install_plugin_package` takes to install this package.
    inspection_id: String,
    #[ts(type = "PluginManifest")]
    manifest: PluginManifest,
}

struct Inspection {
    id: String,
    path: PathBuf,
    digest: String,
    manifest: PluginManifest,
}

/// The package picked last; the webview confirms it by its id and never
/// names a file to install.
#[derive(Default)]
pub struct PluginInspection(Mutex<Option<Inspection>>);

/// Lets the user pick a package and reads its manifest without running it.
#[tauri::command]
pub async fn pick_plugin_package(app: AppHandle) -> Result<Option<PluginPackagePreview>, AppError> {
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
        let id = format!("{digest}-{}", crate::services::clock::now_ns());
        let preview = PluginPackagePreview {
            inspection_id: id.clone(),
            manifest: package.manifest.clone(),
        };
        *app.state::<PluginInspection>().0.locked() = Some(Inspection {
            id,
            path,
            digest,
            manifest: package.manifest,
        });
        Ok(Some(preview))
    })
    .await?
}

#[tauri::command]
pub async fn list_installed_plugins(app: AppHandle) -> Result<Vec<InstalledPlugin>, AppError> {
    run_blocking(move || app.state::<PluginStore>().list()).await?
}

/// Installs the package `pick_plugin_package` showed, unless the file changed
/// since.
#[tauri::command]
pub async fn install_plugin_package(
    app: AppHandle,
    inspection_id: String,
) -> Result<InstalledPlugin, AppError> {
    run_blocking(move || {
        let inspection = app
            .state::<PluginInspection>()
            .0
            .locked()
            .take_if(|inspection| inspection.id == inspection_id)
            .ok_or_else(|| AppError::Stale("The plugin package is no longer picked".into()))?;
        let result = app.state::<PluginStore>().install(
            &inspection.path,
            &inspection.manifest,
            &inspection.digest,
        )?;
        publish_plugins_changed(&app);
        Ok(result)
    })
    .await?
}

#[tauri::command]
pub async fn uninstall_plugin_package(app: AppHandle, id: String) -> Result<(), AppError> {
    run_blocking(move || {
        app.state::<PluginStore>().remove(&id)?;
        publish_plugins_changed(&app);
        Ok(())
    })
    .await?
}

/// Brings back the version the last installation replaced.
#[tauri::command]
pub async fn restore_previous_plugin_package(app: AppHandle, id: String) -> Result<(), AppError> {
    run_blocking(move || {
        app.state::<PluginStore>().restore(&id)?;
        publish_plugins_changed(&app);
        Ok(())
    })
    .await?
}

fn publish_plugins_changed(app: &AppHandle) {
    if let Err(error) = crate::events::emit::<crate::events::PluginsChanged, _>(app, ()) {
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
        let config = app.state::<crate::state::AppState>().user_config();
        let roots = plugins::approved_note_roots(&config, &plugin_id, &field)?;
        let path =
            crate::services::notes::write_scoped_note(&roots, &dir, &file_name, &text, append)?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await?
}
