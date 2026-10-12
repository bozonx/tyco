use crate::{errors::AppError, services::runtime};
use tauri::AppHandle;
#[tauri::command]
pub fn open_main_chat(
    app: AppHandle,
    attachment: Option<crate::models::ChatAttachment>,
    question: Option<String>,
    auto_send: Option<bool>,
) -> Result<(), AppError> {
    runtime::open_main_chat(&app, attachment, question, auto_send)
}

#[tauri::command]
pub fn open_main_editor(
    app: AppHandle,
    text: Option<String>,
    source_text: Option<String>,
) -> Result<(), AppError> {
    runtime::open_main_editor(&app, text, source_text)
}

#[tauri::command]
pub fn activate_mode(app: AppHandle, mode: String, text: Option<String>) -> Result<(), AppError> {
    let mut activation = crate::services::activation::Activation::from_mode(
        &mode,
        crate::services::activation::ActivationSource::Ui,
    )?;
    activation.selected_text = text;
    runtime::activate(&app, activation)
}

#[cfg(test)]
mod tests {
    use crate::services::activation::StartMode;

    #[test]
    fn parses_valid_and_invalid_modes() {
        assert_eq!(StartMode::parse("write").unwrap(), StartMode::Write);
        assert_eq!(StartMode::parse("aiTasks").unwrap(), StartMode::AiTasks);
        assert_eq!(StartMode::parse("voice").unwrap(), StartMode::Voice);
        assert_eq!(StartMode::parse("select").unwrap(), StartMode::Select);
        assert!(StartMode::parse("invalidMode").is_err());
    }
}
