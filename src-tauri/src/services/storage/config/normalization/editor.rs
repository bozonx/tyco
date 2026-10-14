use super::{ensure_enum_field, ensure_field};
use crate::models::default_user_config;
use serde_json::Value;

pub(in crate::services::storage::config) fn normalize_editor_config(
    user_config: &mut Value,
) -> bool {
    let defaults = default_user_config();
    let Some(config) = user_config.as_object_mut() else {
        return false;
    };
    let mut changed = false;

    changed |= ensure_enum_field(
        config,
        "editorHistoryStorage",
        &defaults["editorHistoryStorage"],
        &["off", "session", "disk"],
    );

    changed |= ensure_field(
        config,
        "editorHistoryMaxItems",
        &defaults["editorHistoryMaxItems"],
        Value::is_u64,
    );

    changed |= ensure_field(
        config,
        "editorHistoryRetentionDays",
        &defaults["editorHistoryRetentionDays"],
        Value::is_u64,
    );

    changed |= ensure_field(
        config,
        "sanitizeSecretsInEditorHistory",
        &defaults["sanitizeSecretsInEditorHistory"],
        Value::is_boolean,
    );

    changed |= ensure_field(
        config,
        "chatHistoryEnabled",
        &defaults["chatHistoryEnabled"],
        Value::is_boolean,
    );

    changed |= ensure_field(
        config,
        "chatHistoryRetentionDays",
        &defaults["chatHistoryRetentionDays"],
        Value::is_u64,
    );

    changed
}
