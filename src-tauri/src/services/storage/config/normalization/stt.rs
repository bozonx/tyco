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
                model.extend((*own).clone());
            }
            if let Some(id) = default_model.get("id") {
                model.insert(String::from("id"), id.clone());
            }
            Value::Object(model)
        })
        .collect();

    let mut usage = config
        .get("aiModelUsage")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let active_is_known = usage
        .get("stt")
        .is_some_and(|active| models.iter().any(|model| model.get("id") == Some(active)));
    if !active_is_known {
        let first_id = models
            .first()
            .and_then(|model| model.get("id"))
            .cloned()
            .unwrap_or(Value::Null);
        usage.insert(String::from("stt"), first_id);
    }
    let models = Value::Array(models);
    let usage = Value::Object(usage);

    if config.get("sttModels") == Some(&models) && config.get("aiModelUsage") == Some(&usage) {
        return false;
    }
    config.insert(String::from("sttModels"), models);
    config.insert(String::from("aiModelUsage"), usage);
    true
}
