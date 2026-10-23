use crate::{errors::AppError, models::SessionState};
use serde_json::Value;

pub const VALID_SESSION_STATE_KEYS: &[&str] = &[
    "lastChatId",
    "lastMode",
    "lastChatModelId",
    "lastProfileChatIds",
    "recentAiPrompts",
    "recentTranslateLanguages",
];

/// `current` with the fields of `patch` replaced; a `null` clears a field.
pub fn merge_session_state(
    current: &SessionState,
    patch: serde_json::Map<String, Value>,
) -> Result<SessionState, AppError> {
    for key in patch.keys() {
        if !VALID_SESSION_STATE_KEYS.contains(&key.as_str()) {
            return Err(AppError::InvalidInput(format!(
                "Unknown field in session state patch: {key}"
            )));
        }
    }
    let mut merged = serde_json::to_value(current)?;
    if let Some(fields) = merged.as_object_mut() {
        fields.extend(patch);
    }
    Ok(serde_json::from_value(merged)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn session_state_without_the_menu_history_reads_with_defaults() {
        let state: SessionState = serde_json::from_value(json!({ "lastChatId": "chat" })).unwrap();

        assert!(state.recent_ai_prompts.is_empty());
        assert!(state.recent_translate_languages.is_empty());

        let merged = merge_session_state(
            &state,
            json!({ "recentAiPrompts": ["shorter"] })
                .as_object()
                .unwrap()
                .clone(),
        )
        .unwrap();

        assert_eq!(merged.recent_ai_prompts, vec![String::from("shorter")]);
        assert_eq!(merged.last_chat_id.as_deref(), Some("chat"));
    }

    #[test]
    fn merge_session_state_replaces_only_the_patched_fields() {
        let current = SessionState {
            last_chat_id: Some(String::from("chat")),
            last_mode: Some(crate::services::activation::ActivationMode::Editor),
            ..SessionState::default()
        };
        let patch = json!({ "lastMode": "quickInput" });

        let merged = merge_session_state(&current, patch.as_object().unwrap().clone()).unwrap();

        assert_eq!(merged.last_chat_id.as_deref(), Some("chat"));
        assert_eq!(
            merged.last_mode,
            Some(crate::services::activation::ActivationMode::QuickInput)
        );

        let cleared = merge_session_state(
            &merged,
            json!({ "lastChatId": null }).as_object().unwrap().clone(),
        )
        .unwrap();
        assert_eq!(cleared.last_chat_id, None);
    }

    #[test]
    fn merge_session_state_rejects_a_mistyped_field() {
        let patch = json!({ "lastMode": 1 });
        assert!(
            merge_session_state(&SessionState::default(), patch.as_object().unwrap().clone())
                .is_err()
        );
    }

    #[test]
    fn merge_session_state_rejects_an_unknown_field() {
        let patch = json!({ "nonExistentKey": "value" });
        assert!(
            merge_session_state(&SessionState::default(), patch.as_object().unwrap().clone())
                .is_err()
        );
    }
}
