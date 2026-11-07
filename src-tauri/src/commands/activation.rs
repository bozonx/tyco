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
    profile_id: Option<String>,
    chat_id: Option<String>,
    activation_id: u64,
) -> Result<(), AppError> {
    runtime::open_main_chat(
        &app,
        attachment,
        question,
        auto_send,
        profile_id,
        chat_id,
        activation_id,
    )
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
/// selection. `action_page_index` picks a page of the action menu or of the
/// prompts;
/// `history_origin` filters the history it opens.
#[tauri::command]
pub fn activate_mode(
    app: AppHandle,
    mode: ActivationMode,
    action_page_index: Option<usize>,
    history_origin: Option<crate::models::EditorHistoryOrigin>,
    text: Option<String>,
) -> Result<(), AppError> {
    if !ActivationMode::PUBLIC_MODES.contains(&mode) {
        return Err(AppError::InvalidInput(format!(
            "The mode {} opens only by itself",
            mode.as_str()
        )));
    }
    let mut activation = Activation::new(mode, ActivationSource::Ui);
    if let Some(index) = action_page_index {
        if !matches!(
            mode,
            ActivationMode::SelectionActions | ActivationMode::ChatPrompts
        ) {
            return Err(AppError::InvalidInput("Invalid action page".into()));
        }
        activation.action_page_index = Some(index);
    }
    if history_origin.is_some() && mode != ActivationMode::History {
        return Err(AppError::InvalidInput("Invalid history filter".into()));
    }
    activation.history_origin = history_origin;
    activation.selected_text = text;
    runtime::activate(&app, activation)
}

#[cfg(test)]
mod tests {
    use crate::services::activation::ActivationMode;

    #[test]
    fn parses_valid_and_invalid_modes() {
        assert_eq!(
            ActivationMode::parse("quickInput").unwrap(),
            ActivationMode::QuickInput
        );
        assert_eq!(
            ActivationMode::parse("voice").unwrap(),
            ActivationMode::Voice
        );
        assert_eq!(
            ActivationMode::parse("selectionActions").unwrap(),
            ActivationMode::SelectionActions
        );
        assert!(ActivationMode::parse("invalidMode").is_err());
    }
}
