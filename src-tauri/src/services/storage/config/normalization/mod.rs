use serde_json::{Map, Value};

fn ensure_field(
    fields: &mut Map<String, Value>,
    key: &str,
    default: &Value,
    is_valid: impl FnOnce(&Value) -> bool,
) -> bool {
    if fields.get(key).is_some_and(is_valid) {
        return false;
    }
    fields.insert(key.to_owned(), default.clone());
    true
}

fn ensure_enum_field(
    fields: &mut Map<String, Value>,
    key: &str,
    default: &Value,
    allowed: &[&str],
) -> bool {
    ensure_field(fields, key, default, |value| {
        value.as_str().is_some_and(|value| allowed.contains(&value))
    })
}

mod stt;
pub(super) use stt::normalize_stt_config;

mod hotkeys;
pub(super) use hotkeys::normalize_hotkeys_config;

mod appearance;
pub(super) use appearance::normalize_appearance_config;

mod language;
pub(super) use language::normalize_language_config;

mod editor;
pub(super) use editor::normalize_editor_config;

mod translation;
pub(super) use translation::normalize_translation_config;

mod actions;
pub(super) use actions::normalize_main_actions_config;

mod ai;
pub(super) use ai::normalize_ai_rules_and_tasks;

mod window_insertion;
pub(super) use window_insertion::normalize_window_insertion_config;

#[cfg(test)]
mod tests;
