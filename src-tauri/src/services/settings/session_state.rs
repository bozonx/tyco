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

/// Replaces patched fields, except profile chat ids which merge by profile.
/// A `null` clears an optional field.
pub fn merge_session_state(
    current: &SessionState,
    mut patch: serde_json::Map<String, Value>,
) -> Result<SessionState, AppError> {
    for key in patch.keys() {
        if !VALID_SESSION_STATE_KEYS.contains(&key.as_str()) {
            return Err(AppError::InvalidInput(format!(
                "Unknown field in session state patch: {key}"
            )));
        }
    }
    // Merge under the settings lock so independent windows cannot overwrite
    // another profile's last chat with a stale client snapshot.
    if let Some(Value::Object(ids)) = patch.get_mut("lastProfileChatIds") {
        let mut merged_ids = serde_json::to_value(&current.last_profile_chat_ids)?;
        if let Some(current_ids) = merged_ids.as_object_mut() {
            current_ids.extend(std::mem::take(ids));
            *ids = std::mem::take(current_ids);
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
    fn profile_chat_patches_preserve_other_profiles_in_either_order() {
        let first = json!({ "lastProfileChatIds": { "writer": "chat-1" } });
        let second = json!({ "lastProfileChatIds": { "reviewer": "chat-2" } });
        for patches in [[&first, &second], [&second, &first]] {
            let mut state = SessionState::default();
            for patch in patches {
                state = merge_session_state(&state, patch.as_object().unwrap().clone()).unwrap();
            }
            assert_eq!(state.last_profile_chat_ids["writer"], "chat-1");
            assert_eq!(state.last_profile_chat_ids["reviewer"], "chat-2");
            let updated = merge_session_state(
                &state,
                json!({ "lastProfileChatIds": { "writer": "chat-3" } })
                    .as_object()
                    .unwrap()
                    .clone(),
            )
            .unwrap();
            assert_eq!(updated.last_profile_chat_ids["writer"], "chat-3");
            assert_eq!(updated.last_profile_chat_ids["reviewer"], "chat-2");
        }
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
