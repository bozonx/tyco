use super::{ensure_enum_field, ensure_field};
use crate::models::default_user_config;
use serde_json::Value;

pub(in crate::services::storage::config) fn normalize_appearance_config(
    user_config: &mut Value,
) -> bool {
    let defaults = default_user_config();
    let Some(config) = user_config.as_object_mut() else {
        return false;
    };
    let mut changed = false;

    changed |= ensure_enum_field(
        config,
        "theme",
        &defaults["theme"],
        &["auto", "light", "dark"],
    );

    changed |= ensure_enum_field(
        config,
        "contrast",
        &defaults["contrast"],
        &["auto", "normal", "more"],
    );

    changed |= ensure_enum_field(
        config,
        "motion",
        &defaults["motion"],
        &["auto", "normal", "reduced"],
    );

    changed |= ensure_field(config, "uiScale", &defaults["uiScale"], |value| {
        matches!(value.as_u64(), Some(70..=200))
    });

    changed
}
