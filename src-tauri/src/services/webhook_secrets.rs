//! Custom webhook headers are persisted only as origin-bound secret references.
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use crate::errors::AppError;
use crate::services::secrets::{normalize_origin, SecretStore, SECRET_REF_PREFIX};

fn header_secret_id(command_id: &str, header: &str, value: &str, origin: &str) -> String {
    let digest = Sha256::digest(
        format!(
            "{command_id}\0{}\0{value}\0{origin}",
            header.to_ascii_lowercase()
        )
        .as_bytes(),
    );
    format!("webhook-header-{:x}", digest)[..63].to_owned()
}

fn protect_headers(
    config: &mut Value,
    mut store: impl FnMut(&str, &str, &str) -> Result<(), AppError>,
) -> Result<bool, AppError> {
    let Some(commands) = config.get_mut("commands").and_then(Value::as_array_mut) else {
        return Ok(false);
    };
    let mut changed = false;
    for command in commands {
        if command["toolId"] != "webhook" {
            continue;
        }
        let command_id = command["id"].as_str().unwrap_or_default().to_owned();
        let Some(tool) = command.get_mut("toolConfig") else {
            continue;
        };
        let url = tool["url"].as_str().unwrap_or_default().to_owned();
        let Some(headers) = tool.get_mut("headers").and_then(Value::as_object_mut) else {
            continue;
        };
        for (name, value) in headers {
            let Some(raw) = value.as_str() else {
                continue;
            };
            if raw.trim().is_empty() || raw.contains(SECRET_REF_PREFIX) {
                continue;
            }
            let origin = normalize_origin(&url)?;
            let id = header_secret_id(&command_id, name, raw, &origin);
            store(&id, raw, &origin)?;
            *value = Value::String(format!("{SECRET_REF_PREFIX}{id}"));
            changed = true;
        }
    }
    Ok(changed)
}

pub fn protect_for_save(app: &AppHandle, config: &mut Value) -> Result<(), AppError> {
    let mut protected = config.clone();
    protect_headers(&mut protected, |id, value, origin| {
        app.state::<SecretStore>()
            .set(id, value, Some(vec![origin.to_owned()]))
    })?;
    *config = protected;
    Ok(())
}

/// Legacy values may be staged before a system keychain is available.
pub fn migrate(app: &AppHandle, config: &mut Value) -> Result<bool, AppError> {
    let mut protected = config.clone();
    let changed = protect_headers(&mut protected, |id, value, origin| {
        SecretStore::load_for_app(app)?.stage(id, value, Some(vec![origin.to_owned()]))
    })?;
    *config = protected;
    Ok(changed)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn replaces_headers_with_stable_origin_bound_references() {
        let mut config = serde_json::json!({"commands":[{"id":"one", "toolId":"webhook", "toolConfig":{"url":"https://hooks.example/path", "headers":{"x-api-key":"private-key", "Authorization":"Bearer token"}}}]});
        let mut stored = Vec::new();
        assert!(protect_headers(&mut config, |id, value, origin| {
            stored.push((id.to_owned(), value.to_owned(), origin.to_owned()));
            Ok(())
        })
        .unwrap());
        assert_eq!(stored.len(), 2);
        assert!(stored
            .iter()
            .all(|(id, _, origin)| id.len() == 63 && origin == "https://hooks.example"));
        assert!(!config.to_string().contains("private-key"));
        assert!(!protect_headers(&mut config, |_, _, _| panic!(
            "References must not be rebound"
        ))
        .unwrap());
        assert_ne!(
            header_secret_id("one", "x-api-key", "value", "https://hooks.example"),
            header_secret_id("two", "x-api-key", "value", "https://hooks.example")
        );
        assert_ne!(
            header_secret_id("one", "x-api-key", "value", "https://hooks.example"),
            header_secret_id("one", "x-api-key", "value", "https://other.example")
        );
        assert_eq!(
            header_secret_id("one", "X-Api-Key", "value", "https://hooks.example"),
            header_secret_id("one", "x-api-key", "value", "https://hooks.example")
        );
    }
    #[test]
    fn refuses_to_drop_credentials_when_storage_fails() {
        let mut config = serde_json::json!({"commands":[{"id":"one", "toolId":"webhook", "toolConfig":{"url":"https://hooks.example", "headers":{"x-key":"private"}}}]});
        let original = config.clone();
        assert!(
            protect_headers(&mut config, |_, _, _| Err(AppError::ServiceUnavailable(
                "Keychain locked".into()
            )))
            .is_err()
        );
        assert_eq!(config, original);
    }
}
