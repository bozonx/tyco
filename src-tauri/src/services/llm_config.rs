//! The `llm` section of the user config, and the move to it from the flat
//! `llmModels` list plus the LLM entries of `aiModelUsage`.
//!
//! Keys used to sit in the config next to each model. The migration moves them
//! into `services::secrets`, bound to the endpoint they were used with, and
//! drops them from the config.

use serde_json::{json, Map, Value};
use tauri::AppHandle;

use crate::services::secrets::{normalize_origin, SecretStore};

pub const LLM_TASKS: [&str; 5] = [
    "translate",
    "voiceCorrection",
    "correction",
    "aiTasks",
    "chat",
];

const DEFAULT_MODEL_ID: &str = "local-qwen";
const DEFAULT_LOCAL_PROVIDER_ID: &str = "local";

/// Keep in sync with `DEFAULT_LLM_CONFIG` in `packages/shared/src/user-config.ts`.
pub fn default_llm_config() -> Value {
    json!({
      "providers": [
        { "id": "google", "type": "google", "name": "Google Gemini" },
        { "id": "openrouter", "type": "openrouter", "name": "OpenRouter" },
        { "id": "deepseek", "type": "deepseek", "name": "DeepSeek" },
        {
          "id": DEFAULT_LOCAL_PROVIDER_ID,
          "type": "openai-compatible",
          "name": "Ollama",
          "baseUrl": "http://localhost:11434/v1"
        }
      ],
      "models": [
        {
          "id": DEFAULT_MODEL_ID,
          "provider": DEFAULT_LOCAL_PROVIDER_ID,
          "model": "qwen2.5:7b",
          "name": "Qwen 2.5 7B",
          "temperature": 0.2
        },
        {
          "id": "gemini-flash",
          "provider": "google",
          "model": "gemini-2.5-flash",
          "name": "Gemini 2.5 Flash",
          "temperature": 0.2
        },
        {
          "id": "deepseek-chat",
          "provider": "deepseek",
          "model": "deepseek-chat",
          "name": "DeepSeek Chat",
          "temperature": 0.2
        },
        {
          "id": "openrouter-gpt-4-1-mini",
          "provider": "openrouter",
          "model": "openai/gpt-4.1-mini",
          "name": "GPT-4.1 mini",
          "temperature": 0.2
        }
      ],
      "tasks": {
        "translate": [DEFAULT_MODEL_ID],
        "voiceCorrection": [DEFAULT_MODEL_ID],
        "correction": [DEFAULT_MODEL_ID],
        "aiTasks": [DEFAULT_MODEL_ID],
        "chat": [DEFAULT_MODEL_ID]
      }
    })
}

/// A key found in a legacy model, to be stored as a secret.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MigratedSecret {
    pub id: String,
    pub value: String,
    pub origin: String,
}

/// Migrates in place. Returns `None` when there was nothing to migrate,
/// otherwise the keys the caller has to store before saving the config.
pub fn migrate_llm_config(config: &mut Value) -> Option<Vec<MigratedSecret>> {
    let object = config.as_object_mut()?;
    let has_llm = object.get("llm").is_some_and(Value::is_object);
    let legacy_models = object.remove("llmModels");
    let legacy_usage = take_legacy_usage(object);

    if has_llm {
        return (legacy_models.is_some() || !legacy_usage.is_empty()).then(Vec::new);
    }

    let (llm, secrets) = build_llm_config(
        legacy_models.as_ref().and_then(Value::as_array),
        &legacy_usage,
    );
    object.insert(String::from("llm"), llm);
    Some(secrets)
}

/// Runs the migration and stores the keys it moved out of the config. Changes
/// nothing when a key cannot be stored: dropping it from the config first
/// would lose it.
pub fn migrate_user_config(app: &AppHandle, config: &mut Value) -> bool {
    let mut migrated = config.clone();
    let Some(secrets) = migrate_llm_config(&mut migrated) else {
        return false;
    };

    if !secrets.is_empty() {
        let stored = SecretStore::load_for_app(app).and_then(|store| {
            secrets.iter().try_for_each(|secret| {
                store.set(&secret.id, &secret.value, Some(vec![secret.origin.clone()]))
            })
        });
        if let Err(error) = stored {
            log::error!("LLM config migration postponed, keys could not be stored: {error}");
            return false;
        }
    }

    *config = migrated;
    true
}

fn take_legacy_usage(object: &mut Map<String, Value>) -> Map<String, Value> {
    let mut taken = Map::new();
    if let Some(usage) = object
        .get_mut("aiModelUsage")
        .and_then(Value::as_object_mut)
    {
        for task in LLM_TASKS {
            if let Some(value) = usage.remove(task) {
                taken.insert(task.to_string(), value);
            }
        }
    }
    taken
}

fn build_llm_config(
    legacy_models: Option<&Vec<Value>>,
    legacy_usage: &Map<String, Value>,
) -> (Value, Vec<MigratedSecret>) {
    let mut llm = default_llm_config();
    let mut providers: Vec<Value> = Vec::new();
    let mut models: Vec<Value> = Vec::new();
    let mut secrets = Vec::new();

    for legacy in legacy_models.into_iter().flatten() {
        let Some(migrated) = migrate_model(legacy, &mut providers, &models, &mut secrets) else {
            continue;
        };
        models.push(migrated);
    }

    if models.is_empty() {
        return (llm, secrets);
    }

    let model_ids: Vec<String> = models
        .iter()
        .filter_map(|model| model["id"].as_str().map(str::to_string))
        .collect();
    let first_id = model_ids[0].clone();

    // The built-in providers and their presets stay; the default local
    // provider and model give way to what the user had configured.
    let defaults = llm
        .as_object_mut()
        .expect("default llm config is an object");
    let mut all_providers: Vec<Value> = defaults["providers"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|provider| provider["id"] != DEFAULT_LOCAL_PROVIDER_ID)
        .cloned()
        .collect();
    all_providers.extend(providers);
    let mut all_models = models;
    all_models.extend(
        defaults["models"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|model| model["provider"] != DEFAULT_LOCAL_PROVIDER_ID)
            .cloned(),
    );

    let mut tasks = Map::new();
    for task in LLM_TASKS {
        let chosen = legacy_usage
            .get(task)
            .and_then(Value::as_str)
            .filter(|id| model_ids.iter().any(|known| known == id))
            .unwrap_or(&first_id);
        tasks.insert(task.to_string(), json!([chosen]));
    }

    defaults.insert(String::from("providers"), Value::Array(all_providers));
    defaults.insert(String::from("models"), Value::Array(all_models));
    defaults.insert(String::from("tasks"), Value::Object(tasks));
    (llm, secrets)
}

/// One legacy `openai-compatible` model. Its endpoint becomes a provider,
/// shared with other models on the same endpoint.
fn migrate_model(
    legacy: &Value,
    providers: &mut Vec<Value>,
    models: &[Value],
    secrets: &mut Vec<MigratedSecret>,
) -> Option<Value> {
    let provider_type = legacy["provider"].as_str().unwrap_or("openai-compatible");
    let model_name = legacy["model"].as_str().map(str::trim).unwrap_or_default();
    let base_url = legacy["baseUrl"]
        .as_str()
        .map(|url| url.trim().trim_end_matches('/'))
        .unwrap_or_default();
    if provider_type != "openai-compatible" || model_name.is_empty() {
        return None;
    }
    let origin = normalize_origin(base_url).ok()?;

    let provider_id = match providers
        .iter()
        .find(|provider| provider["baseUrl"] == base_url)
    {
        Some(provider) => provider["id"].as_str().unwrap_or_default().to_string(),
        None => {
            let id = if providers.is_empty() {
                DEFAULT_LOCAL_PROVIDER_ID.to_string()
            } else {
                format!("{DEFAULT_LOCAL_PROVIDER_ID}-{}", providers.len() + 1)
            };
            let host = url::Url::parse(base_url)
                .ok()
                .and_then(|url| url.host_str().map(str::to_string))
                .unwrap_or_else(|| id.clone());
            providers.push(json!({
                "id": id,
                "type": "openai-compatible",
                "name": host,
                "baseUrl": base_url,
            }));
            let api_key = legacy["apiKey"].as_str().map(str::trim).unwrap_or_default();
            if !api_key.is_empty() {
                secrets.push(MigratedSecret {
                    id: id.clone(),
                    value: api_key.to_string(),
                    origin,
                });
            }
            id
        }
    };

    let taken = |id: &str| models.iter().any(|model| model["id"] == id);
    let legacy_id = legacy["id"].as_str().map(str::trim).unwrap_or_default();
    let id = if !legacy_id.is_empty() && !taken(legacy_id) {
        legacy_id.to_string()
    } else {
        (1..)
            .map(|index| format!("model-{index}"))
            .find(|candidate| !taken(candidate))
            .expect("an unused id")
    };

    let mut model = json!({ "id": id, "provider": provider_id, "model": model_name });
    let fields = model.as_object_mut().expect("model is an object");
    if let Some(name) = legacy["name"]
        .as_str()
        .map(str::trim)
        .filter(|name| !name.is_empty())
    {
        fields.insert(String::from("name"), json!(name));
    }
    if let Some(temperature) = legacy["temperature"].as_f64() {
        fields.insert(String::from("temperature"), json!(temperature));
    }
    if let Some(max_tokens) = legacy["maxTokens"].as_u64().filter(|value| *value > 0) {
        fields.insert(String::from("maxOutputTokens"), json!(max_tokens));
    }
    Some(model)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn legacy_config() -> Value {
        json!({
          "theme": "auto",
          "llmModels": [
            {
              "id": "openai-compatible-default",
              "name": "Ollama",
              "model": "qwen2.5:7b",
              "provider": "openai-compatible",
              "baseUrl": "http://localhost:11434/v1/",
              "apiKey": "",
              "temperature": 0.2,
              "maxTokens": 512
            },
            {
              "id": "router",
              "name": "",
              "model": "openai/gpt-4.1-mini",
              "provider": "openai-compatible",
              "baseUrl": "https://openrouter.ai/api/v1",
              "apiKey": "sk-or-1"
            },
            {
              "id": "router",
              "model": "anthropic/claude-sonnet-4.5",
              "provider": "openai-compatible",
              "baseUrl": "https://openrouter.ai/api/v1",
              "apiKey": "sk-or-1"
            }
          ],
          "aiModelUsage": {
            "stt": "openai-compatible-stt",
            "tts": "",
            "translate": "router",
            "voiceCorrection": "gone",
            "correction": "openai-compatible-default",
            "aiTasks": "openai-compatible-default",
            "chat": "router"
          }
        })
    }

    #[test]
    fn moves_legacy_models_into_the_llm_section() {
        let mut config = legacy_config();
        let secrets = migrate_llm_config(&mut config).unwrap();

        assert!(config.get("llmModels").is_none());
        assert_eq!(
            config["aiModelUsage"],
            json!({ "stt": "openai-compatible-stt", "tts": "" })
        );

        let llm = &config["llm"];
        let providers = llm["providers"].as_array().unwrap();
        let ids: Vec<&str> = providers
            .iter()
            .map(|p| p["id"].as_str().unwrap())
            .collect();
        assert_eq!(
            ids,
            vec!["google", "openrouter", "deepseek", "local", "local-2"]
        );
        assert_eq!(providers[3]["baseUrl"], "http://localhost:11434/v1");
        assert_eq!(providers[4]["name"], "openrouter.ai");

        let models = llm["models"].as_array().unwrap();
        assert_eq!(
            models[0],
            json!({
              "id": "openai-compatible-default",
              "provider": "local",
              "model": "qwen2.5:7b",
              "name": "Ollama",
              "temperature": 0.2,
              "maxOutputTokens": 512
            })
        );
        assert_eq!(models[1]["id"], "router");
        assert_eq!(models[1]["provider"], "local-2");
        assert!(models[1].get("name").is_none());
        assert_eq!(models[2]["id"], "model-1", "a duplicate id is replaced");
        assert!(
            models.iter().all(|model| model["id"] != DEFAULT_MODEL_ID),
            "the default local model gives way to the user's"
        );
        assert!(models.iter().any(|model| model["id"] == "gemini-flash"));

        assert_eq!(llm["tasks"]["translate"], json!(["router"]));
        assert_eq!(llm["tasks"]["chat"], json!(["router"]));
        assert_eq!(
            llm["tasks"]["voiceCorrection"],
            json!(["openai-compatible-default"]),
            "an unknown model falls back to the first one"
        );

        assert_eq!(
            secrets,
            vec![MigratedSecret {
                id: "local-2".into(),
                value: "sk-or-1".into(),
                origin: "https://openrouter.ai".into(),
            }]
        );
        assert!(!config.to_string().contains("sk-or-1"));
    }

    #[test]
    fn a_config_without_llm_models_gets_the_defaults() {
        let mut config = json!({ "aiModelUsage": { "stt": "x", "chat": "y" } });
        let secrets = migrate_llm_config(&mut config).unwrap();

        assert!(secrets.is_empty());
        assert_eq!(config["llm"], default_llm_config());
        assert_eq!(config["aiModelUsage"], json!({ "stt": "x" }));
    }

    #[test]
    fn a_migrated_config_is_left_alone() {
        let mut config = json!({ "llm": default_llm_config(), "aiModelUsage": { "stt": "x" } });
        let before = config.clone();

        assert_eq!(migrate_llm_config(&mut config), None);
        assert_eq!(config, before);
    }

    #[test]
    fn leftover_legacy_keys_are_dropped_next_to_an_llm_section() {
        let mut config = json!({
          "llm": default_llm_config(),
          "llmModels": [],
          "aiModelUsage": { "stt": "x", "chat": "y" }
        });

        assert_eq!(migrate_llm_config(&mut config), Some(Vec::new()));
        assert!(config.get("llmModels").is_none());
        assert_eq!(config["aiModelUsage"], json!({ "stt": "x" }));
        assert_eq!(config["llm"], default_llm_config());
    }

    #[test]
    fn skips_models_without_a_usable_endpoint() {
        let mut config = json!({
          "llmModels": [
            { "id": "a", "model": "m", "provider": "openai-compatible", "baseUrl": "" },
            { "id": "b", "model": "", "provider": "openai-compatible", "baseUrl": "http://x" }
          ]
        });
        migrate_llm_config(&mut config).unwrap();

        assert_eq!(config["llm"], default_llm_config());
    }
}
