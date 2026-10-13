use super::{
    app_config_dir, app_state_dir, fs, read_or_quarantine, write_json, AppError, AppHandle,
    LocalState, Path, Value, STATE_FILE_NAME,
};

pub fn read_or_create_local_state(app: &AppHandle) -> Result<LocalState, AppError> {
    let path = app_state_dir(app)?.join(STATE_FILE_NAME);
    move_legacy_file(&app_config_dir(app)?.join(STATE_FILE_NAME), &path);

    if let Some(state) = read_or_quarantine(&path, |raw| Ok(serde_json::from_str(raw)?))? {
        return Ok(state);
    }

    let default_state = LocalState::default();
    if let Err(error) = save_local_state(app, &default_state) {
        log::error!("Could not save the local state: {error}");
    }

    Ok(default_state)
}

pub const VALID_LOCAL_STATE_KEYS: &[&str] = &[
    "lastChatId",
    "lastMode",
    "lastChatModelId",
    "recentAiPrompts",
    "recentTranslateLanguages",
    "diffMode",
    "translationViewMode",
];

/// `current` with the fields of `patch` replaced; a `null` clears a field.
pub fn merge_local_state(
    current: &LocalState,
    patch: serde_json::Map<String, Value>,
) -> Result<LocalState, AppError> {
    for key in patch.keys() {
        if !VALID_LOCAL_STATE_KEYS.contains(&key.as_str()) {
            return Err(AppError::InvalidInput(format!(
                "Unknown field in local state patch: {key}"
            )));
        }
    }
    let mut merged = serde_json::to_value(current)?;
    if let Some(fields) = merged.as_object_mut() {
        fields.extend(patch);
    }
    Ok(serde_json::from_value(merged)?)
}

/// Moves a file kept by an older version to its current place, unless that
/// already has one. A failure only costs what the file remembered.
fn move_legacy_file(legacy: &Path, path: &Path) {
    if legacy == path || !legacy.exists() || path.exists() {
        return;
    }
    if let Err(error) = fs::rename(legacy, path) {
        log::warn!(
            "Could not move {} to {}: {error}",
            legacy.display(),
            path.display()
        );
    }
}

pub fn save_local_state(app: &AppHandle, local_state: &LocalState) -> Result<(), AppError> {
    let path = app_state_dir(app)?.join(STATE_FILE_NAME);
    write_json(&path, local_state)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::storage::test_support::TestDir;
    use serde_json::json;

    #[test]
    fn local_state_without_the_menu_history_reads_with_defaults() {
        let state: LocalState = serde_json::from_value(json!({ "lastChatId": "chat" })).unwrap();

        assert!(state.recent_ai_prompts.is_empty());
        assert!(state.recent_translate_languages.is_empty());

        let merged = merge_local_state(
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
    fn merge_local_state_replaces_only_the_patched_fields() {
        let current = LocalState {
            last_chat_id: Some(String::from("chat")),
            last_mode: Some(crate::services::activation::ActivationMode::Editor),
            ..LocalState::default()
        };
        let patch = json!({ "lastMode": "write" });

        let merged = merge_local_state(&current, patch.as_object().unwrap().clone()).unwrap();

        assert_eq!(merged.last_chat_id.as_deref(), Some("chat"));
        assert_eq!(
            merged.last_mode,
            Some(crate::services::activation::ActivationMode::Write)
        );

        let cleared = merge_local_state(
            &merged,
            json!({ "lastChatId": null }).as_object().unwrap().clone(),
        )
        .unwrap();
        assert_eq!(cleared.last_chat_id, None);
    }

    #[test]
    fn merge_local_state_rejects_a_mistyped_field() {
        let patch = json!({ "lastMode": 1 });
        assert!(
            merge_local_state(&LocalState::default(), patch.as_object().unwrap().clone()).is_err()
        );
    }

    #[test]
    fn merge_local_state_rejects_an_unknown_field() {
        let patch = json!({ "nonExistentKey": "value" });
        assert!(
            merge_local_state(&LocalState::default(), patch.as_object().unwrap().clone()).is_err()
        );
    }

    #[test]
    fn moves_a_legacy_file_once() {
        let dir = TestDir::new("legacy-file");
        let legacy = dir.join("old.json");
        let path = dir.join("new.json");

        fs::write(&legacy, "old").unwrap();
        move_legacy_file(&legacy, &path);
        assert_eq!(fs::read_to_string(&path).unwrap(), "old");
        assert!(!legacy.exists());

        // the current file wins over a legacy one
        fs::write(&legacy, "older").unwrap();
        move_legacy_file(&legacy, &path);
        assert_eq!(fs::read_to_string(&path).unwrap(), "old");
    }
}
