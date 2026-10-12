use super::super::super::{
    editor_history::DEFAULT_EDITOR_HISTORY_LIMIT, history_limit, EditorHistoryStorage,
};
use crate::models::default_user_config;
use serde_json::Value;

pub(in crate::services::storage::config) fn normalize_editor_config(
    user_config: &mut Value,
) -> bool {
    let defaults = default_user_config();
    // the storage replaced the "memory only" flag and the zero limit that
    // turned the history off; the limit then gets a usable value for when the
    // history is turned on again
    let storage = EditorHistoryStorage::from_config(user_config);
    let zero_limit = history_limit(
        user_config,
        "editorHistoryMaxItems",
        DEFAULT_EDITOR_HISTORY_LIMIT,
    ) == 0;
    let Some(config) = user_config.as_object_mut() else {
        return false;
    };
    let mut changed = false;

    // highlighting and HTML conversion on paste are no longer settings, and
    // the "memory only" flag became the storage
    for removed in ["pasteMode", "editorSyntax", "clearEditorHistoryOnExit"] {
        changed |= config.remove(removed).is_some();
    }

    if config.get("editorHistoryStorage").and_then(Value::as_str) != Some(storage.as_str()) {
        config.insert(
            String::from("editorHistoryStorage"),
            Value::String(storage.as_str().into()),
        );
        changed = true;
    }

    if storage == EditorHistoryStorage::Off && zero_limit {
        config.insert(
            String::from("editorHistoryMaxItems"),
            defaults["editorHistoryMaxItems"].clone(),
        );
        changed = true;
    }

    if config
        .get("editorHistoryMaxItems")
        .and_then(Value::as_u64)
        .is_none()
    {
        config.insert(
            String::from("editorHistoryMaxItems"),
            defaults["editorHistoryMaxItems"].clone(),
        );
        changed = true;
    }

    if config
        .get("editorHistoryRetentionDays")
        .and_then(Value::as_u64)
        .is_none()
    {
        config.insert(
            String::from("editorHistoryRetentionDays"),
            defaults["editorHistoryRetentionDays"].clone(),
        );
        changed = true;
    }

    if config
        .get("sanitizeSecretsInEditorHistory")
        .and_then(Value::as_bool)
        .is_none()
    {
        config.insert(
            String::from("sanitizeSecretsInEditorHistory"),
            defaults["sanitizeSecretsInEditorHistory"].clone(),
        );
        changed = true;
    }

    if config
        .get("chatHistoryEnabled")
        .and_then(Value::as_bool)
        .is_none()
    {
        config.insert(
            String::from("chatHistoryEnabled"),
            defaults["chatHistoryEnabled"].clone(),
        );
        changed = true;
    }

    if config
        .get("chatHistoryRetentionDays")
        .and_then(Value::as_u64)
        .is_none()
    {
        config.insert(
            String::from("chatHistoryRetentionDays"),
            defaults["chatHistoryRetentionDays"].clone(),
        );
        changed = true;
    }

    changed
}
