use crate::{errors::AppError, services::runtime};
use tauri::AppHandle;
#[tauri::command]
pub fn open_main_chat(
    app: AppHandle,
    attachment: Option<crate::models::ChatAttachment>,
    question: Option<String>,
    auto_send: Option<bool>,
    activation_id: u64,
) -> Result<(), AppError> {
    runtime::open_main_chat(&app, attachment, question, auto_send, activation_id)
}

#[tauri::command]
pub fn open_main_editor(
    app: AppHandle,
    text: Option<String>,
    source_text: Option<String>,
    activation_id: u64,
) -> Result<(), AppError> {
    runtime::open_main_editor(&app, text, source_text, activation_id)
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
    use crate::services::activation::ActivationMode;

    #[test]
    fn parses_valid_and_invalid_modes() {
        assert_eq!(
            ActivationMode::parse("write").unwrap(),
            ActivationMode::Write
        );
        assert_eq!(
            ActivationMode::parse("aiTasks").unwrap(),
            ActivationMode::AiTasks
        );
        assert_eq!(
            ActivationMode::parse("voice").unwrap(),
            ActivationMode::Voice
        );
        assert_eq!(
            ActivationMode::parse("select").unwrap(),
            ActivationMode::Select
        );
        assert!(ActivationMode::parse("invalidMode").is_err());
    }
}
