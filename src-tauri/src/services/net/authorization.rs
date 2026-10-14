//! Origin authorization uses a typed policy rather than arbitrary configuration paths.
use super::request::{prepare, request_origin, PreparedRequest, Protocol};
use crate::errors::AppError;
use crate::services::secrets::{origin_of, Secrets};
use serde_json::Value;
use std::collections::HashSet;

#[derive(Default)]
pub struct NetworkPolicy {
    allowed_origins: HashSet<String>,
}

impl NetworkPolicy {
    pub fn from_config(config: &Value) -> Self {
        Self {
            allowed_origins: configured_base_urls(config)
                .filter_map(|value| url::Url::parse(value).ok())
                .filter_map(|value| origin_of(&value))
                .collect(),
        }
    }

    pub fn ensure_allowed(
        &self,
        protocol: Protocol,
        url: &str,
        secrets: &Secrets,
    ) -> Result<(), AppError> {
        let origin = request_origin(protocol, url).map_err(AppError::InvalidInput)?;
        if self.allowed_origins.contains(&origin)
            || secrets
                .values()
                .any(|entry| entry.origins.contains(&origin))
        {
            Ok(())
        } else {
            Err(AppError::InvalidInput(format!(
                "Network origin \"{origin}\" is not configured"
            )))
        }
    }

    pub fn prepare(
        &self,
        protocol: Protocol,
        url: &str,
        headers: &[(String, String)],
        secrets: &Secrets,
    ) -> Result<PreparedRequest, AppError> {
        self.ensure_allowed(protocol, url, secrets)?;
        prepare(protocol, url, headers, secrets).map_err(AppError::InvalidInput)
    }
}

/// Endpoints the user configured: language model providers and self-hosted
/// speech servers. Deepgram has none and is reached through the origin its key
/// is bound to.
fn configured_base_urls(config: &serde_json::Value) -> impl Iterator<Item = &str> {
    let llm_providers = config
        .get("llm")
        .and_then(|value| value.get("providers"))
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten();
    let stt_models = config
        .get("stt")
        .and_then(|value| value.get("models"))
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten();

    let webhooks = config
        .get("commands")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter(|command| {
            command.get("toolId").and_then(serde_json::Value::as_str) == Some("webhook")
        })
        .filter_map(|command| {
            command
                .get("toolConfig")
                .and_then(|config| config.get("url"))
        })
        .filter_map(serde_json::Value::as_str);

    llm_providers
        .chain(stt_models)
        .filter_map(|entry| entry.get("baseUrl"))
        .filter_map(serde_json::Value::as_str)
        .chain(webhooks)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::secrets::SecretEntry;

    fn ensure_allowed_origin(
        protocol: Protocol,
        url: &str,
        config: &Value,
        secrets: &Secrets,
    ) -> Result<(), AppError> {
        NetworkPolicy::from_config(config).ensure_allowed(protocol, url, secrets)
    }

    #[test]
    fn allows_configured_webhooks_without_a_secret() {
        let config = serde_json::json!({"commands":[{"id":"hook", "toolId":"webhook", "toolConfig":{"url":"https://hooks.example/run?text={{TEXT}}"}}]});
        let secrets = crate::services::secrets::Secrets::new();
        assert!(ensure_allowed_origin(
            Protocol::Http,
            "https://hooks.example/run?text=value",
            &config,
            &secrets
        )
        .is_ok());
        assert!(ensure_allowed_origin(
            Protocol::Http,
            "https://other.example/run",
            &config,
            &secrets
        )
        .is_err());
    }

    #[test]
    fn allows_only_configured_or_secret_bound_origins() {
        let config = serde_json::json!({"llm":{"providers":[{"baseUrl":"http://localhost:11434/v1" }]
            },"stt":{"models":[{"baseUrl":"wss://speech.example/v1" }]
        }});
        let mut secrets = crate::services::secrets::Secrets::new();
        secrets.insert(
            "google".into(),
            SecretEntry {
                value: "key".into(),
                origins: vec!["https://generativelanguage.googleapis.com".into()],
            },
        );

        assert!(ensure_allowed_origin(
            Protocol::Http,
            "http://localhost:11434/v1/models",
            &config,
            &secrets
        )
        .is_ok());
        assert!(ensure_allowed_origin(
            Protocol::WebSocket,
            "wss://speech.example/v1",
            &config,
            &secrets
        )
        .is_ok());
        assert!(ensure_allowed_origin(
            Protocol::WebSocket,
            "wss://other-speech.example/v1",
            &config,
            &secrets
        )
        .is_err());
        assert!(ensure_allowed_origin(
            Protocol::Http,
            "https://generativelanguage.googleapis.com/v1/models",
            &config,
            &secrets
        )
        .is_ok());
        assert!(ensure_allowed_origin(
            Protocol::Http,
            "http://169.254.169.254/latest/meta-data",
            &config,
            &secrets
        )
        .is_err());
    }
}
