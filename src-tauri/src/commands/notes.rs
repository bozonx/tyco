use crate::errors::AppError;
use crate::services::notes;

/// Saves `text` as a new file in `dir` and returns the path of the created file.
#[tauri::command]
pub fn save_note(dir: String, file_name: String, text: String) -> Result<String, AppError> {
    let path = notes::save_note(&dir, &file_name, &text)?;

    Ok(path.to_string_lossy().into_owned())
}
