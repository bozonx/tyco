use crate::{errors::AppError, models::DesktopSnapshot, state::AppState};
use tauri::State;
#[tauri::command]
pub fn get_desktop_state(state: State<'_, AppState>) -> Result<DesktopSnapshot, AppError> {
    Ok(state.snapshot())
}
