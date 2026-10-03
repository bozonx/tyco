use crate::errors::AppError;
use crate::services::notes;

/// Saves `text` as a new file in `dir` and returns the path of the created file.
#[tauri::command(async)]
pub fn save_note(dir: String, file_name: String, text: String) -> Result<String, AppError> {
    let path = notes::save_note(&dir, &file_name, &text)?;

    Ok(path.to_string_lossy().into_owned())
}

/// Appends `text` to `file_name` in `dir` (creating it if missing) and returns the path.
#[tauri::command(async)]
pub fn append_note(dir: String, file_name: String, text: String) -> Result<String, AppError> {
    let path = notes::append_note(&dir, &file_name, &text)?;

    Ok(path.to_string_lossy().into_owned())
}
