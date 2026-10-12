use super::blocking;
use crate::errors::AppError;
use crate::services::notes;

/// Saves `text` as a new file in `dir` and returns the path of the created file.
#[tauri::command]
pub async fn save_note(dir: String, file_name: String, text: String) -> Result<String, AppError> {
    blocking(move || {
        let path = notes::save_note(&dir, &file_name, &text)?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await?
}

/// Appends `text` to `file_name` in `dir` (creating it if missing) and returns the path.
#[tauri::command]
pub async fn append_note(dir: String, file_name: String, text: String) -> Result<String, AppError> {
    blocking(move || {
        let path = notes::append_note(&dir, &file_name, &text)?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await?
}
