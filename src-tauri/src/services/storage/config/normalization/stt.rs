use crate::models::default_user_config;
use serde_json::Value;

/// One speech model per provider: the defaults with the user's own settings
/// for that provider laid over them. Entries of unknown providers are dropped,
/// and the active model falls back to the first default when it is not one of
/// them.
pub(in crate::services::storage::config) fn normalize_stt_config(user_config: &mut Value) -> bool {
    let defaults = default_user_config();
    let default_models: Vec<Value> = defaults
        .get("sttModels")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let Some(config) = user_config.as_object_mut() else {
        return false;
    };
    let existing: Vec<&serde_json::Map<String, Value>> = config
        .get("sttModels")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_object)
        .collect();

    let models: Vec<Value> = default_models
        .iter()
        .filter_map(Value::as_object)
        .map(|default_model| {
            let mut model = default_model.clone();
            let provider = default_model.get("provider");
            if let Some(own) = existing
                .iter()
                .find(|model| provider.is_some() && model.get("provider") == provider)
            {
                for key in ["providerModelId", "description", "language", "baseUrl"] {
                    if let Some(value) = own.get(key).filter(|value| value.is_string()) {
                        model.insert(key.into(), value.clone());
                    }
                }
                if let Some(value) = own.get("formatWithLlm").filter(|value| value.is_boolean()) {
                    model.insert("formatWithLlm".into(), value.clone());
                }
            }
            if let Some(id) = default_model.get("id") {
                model.insert(String::from("id"), id.clone());
            }
            Value::Object(model)
        })
        .collect();

    let mut active = config
        .get("selectedSttModelId")
        .cloned()
        .unwrap_or(Value::Null);
    if !models.iter().any(|model| model.get("id") == Some(&active)) {
        active = models
            .first()
            .and_then(|model| model.get("id"))
            .cloned()
            .unwrap_or(Value::Null);
    }
    let models = Value::Array(models);

    if config.get("sttModels") == Some(&models) && config.get("selectedSttModelId") == Some(&active)
    {
        return false;
    }
    config.insert(String::from("sttModels"), models);
    config.insert(String::from("selectedSttModelId"), active);
    true
}
