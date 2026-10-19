use crate::{
    errors::AppError,
    services::activation::{Activation, ActivationMode, ActivationSource},
    services::runtime,
};
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

/// Opens `mode` as the user would with a hotkey, with `text` in place of the
/// selection. `launcher_page_id` picks a page of the command overlay.
#[tauri::command]
pub fn activate_mode(
    app: AppHandle,
    mode: ActivationMode,
    launcher_page_id: Option<String>,
    text: Option<String>,
) -> Result<(), AppError> {
    if !ActivationMode::PUBLIC_MODES.contains(&mode) {
        return Err(AppError::InvalidInput(format!(
            "The mode {} opens only by itself",
            mode.as_str()
        )));
    }
    let mut activation = Activation::new(mode, ActivationSource::Ui);
    if let Some(page_id) = launcher_page_id {
        if mode != ActivationMode::CommandLauncher || page_id.trim().is_empty() {
            return Err(AppError::InvalidInput("Invalid command page".into()));
        }
        activation.launcher_page_id = Some(page_id);
    }
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
