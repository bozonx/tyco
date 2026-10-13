use serde_json::Value;

pub(in crate::services::storage::config) fn normalize_appearance_config(
    user_config: &mut Value,
) -> bool {
    crate::services::config_schema::normalize_config_fields(
        user_config,
        &["theme", "contrast", "motion", "uiScale"],
    )
}
