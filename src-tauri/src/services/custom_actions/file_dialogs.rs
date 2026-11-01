use crate::services::platform::shell;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
/// A file picked by the user, as a command that runs it.
pub fn pick_script_file(app: &AppHandle) -> Option<String> {
    let path = app.dialog().file().blocking_pick_file()?.into_path().ok()?;
    Some(shell::script_invocation(&path.to_string_lossy()))
}

/// A file picked by the user, as its path.
pub fn pick_file(app: &AppHandle) -> Option<String> {
    let path = app.dialog().file().blocking_pick_file()?.into_path().ok()?;
    Some(path.to_string_lossy().into_owned())
}

pub fn pick_directory(app: &AppHandle) -> Option<String> {
    let path = app
        .dialog()
        .file()
        .blocking_pick_folder()?
        .into_path()
        .ok()?;
    Some(path.to_string_lossy().into_owned())
}
