//! Custom webhook headers are persisted only as origin-bound secret references.
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashSet;

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

/// Rolls back freshly created header secrets if the config transaction fails.
pub struct PendingHeaderSecrets<'a> {
    store: &'a SecretStore,
    created: Vec<String>,
    committed: bool,
}

impl PendingHeaderSecrets<'_> {
    /// Preserve keys when a failed rollback leaves the disk state uncertain.
    pub fn retain(mut self) {
        self.committed = true;
    }
    pub fn commit(mut self, previous: &Value, next: &Value) {
        self.committed = true;
        let mut retained = referenced_secrets(next);
        // A removed command can still be restored by the settings undo action.
        let next_ids: HashSet<&str> = next["commands"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|command| command["id"].as_str())
            .collect();
        for command in previous["commands"].as_array().into_iter().flatten() {
            if !next_ids.contains(command["id"].as_str().unwrap_or_default()) {
                retained.extend(referenced_secrets(command));
            }
        }
        let candidates = referenced_secrets(previous);
        cleanup(self.store, &retained, false, Some(&candidates));
    }
}

impl Drop for PendingHeaderSecrets<'_> {
    fn drop(&mut self) {
        if !self.committed {
            for id in &self.created {
                if let Err(error) = self.store.remove(id) {
                    log::warn!("Could not roll back webhook header secret: {error}");
                }
            }
        }
    }
}

pub fn protect_for_save<'a>(
    store: &'a SecretStore,
    config: &mut Value,
) -> Result<PendingHeaderSecrets<'a>, AppError> {
    let known: HashSet<String> = store.ids().into_iter().collect();
    let mut pending = PendingHeaderSecrets {
        store,
        created: Vec::new(),
        committed: false,
    };
    let mut protected = config.clone();
    protect_headers(&mut protected, |id, value, origin| {
        store.set(id, value, Some(vec![origin.to_owned()]))?;
        if !known.contains(id) {
            pending.created.push(id.to_owned());
        }
        Ok(())
    })?;
    *config = protected;
    Ok(pending)
}

/// References can be shared by copied commands and opaque plugin settings.
pub fn referenced_secrets(config: &Value) -> HashSet<String> {
    let mut result = HashSet::new();
    collect_references(config, &mut result);
    result
}

/// Refuses removal if the secret is still referenced anywhere in the user config.
pub fn ensure_secret_not_referenced(config: &Value, secret_id: &str) -> Result<(), AppError> {
    if referenced_secrets(config).contains(secret_id) {
        Err(AppError::InvalidInput(
            "The secret is still referenced by the saved configuration".into(),
        ))
    } else {
        Ok(())
    }
}

fn collect_references(value: &Value, result: &mut HashSet<String>) {
    match value {
        Value::String(text) => {
            if let Some(id) = text.strip_prefix(SECRET_REF_PREFIX) {
                result.insert(id.to_owned());
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_references(item, result);
            }
        }
        Value::Object(fields) => {
            if fields
                .get("isAuthEnabled")
                .is_some_and(|value| value == true)
            {
                if let Some(id) = fields.get("authSecretId").and_then(Value::as_str) {
                    result.insert(id.to_owned());
                }
            }
            for item in fields.values() {
                collect_references(item, result);
            }
        }
        _ => {}
    }
}

fn cleanup(
    store: &SecretStore,
    retained: &HashSet<String>,
    include_authorization: bool,
    candidates: Option<&HashSet<String>>,
) {
    for id in store.ids() {
        let managed = id.starts_with("webhook-header-")
            || (include_authorization && id.starts_with("webhook-auth-"));
        if managed && !retained.contains(&id) && candidates.is_none_or(|ids| ids.contains(&id)) {
            if let Err(error) = store.remove(&id) {
                log::warn!("Could not remove unused webhook secret: {error}");
            }
        }
    }
}

/// Startup has no outstanding drafts or undo actions.
pub fn cleanup_after_startup(store: &SecretStore, config: &Value) {
    cleanup(store, &referenced_secrets(config), true, None);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::test_support::TestDir;
    #[test]
    fn cleanup_preserves_references_shared_by_commands_and_undo_candidates() {
        let directory = TestDir::new("tyco-webhook-cleanup-");
        crate::services::atomic_file::create_private_dir(&directory).unwrap();
        let path = directory.join("secrets.json");
        let origins = serde_json::json!({ "origins": ["https://example.com"] });
        let secrets: serde_json::Map<String, Value> = [
            "webhook-header-shared",
            "webhook-header-obsolete",
            "webhook-header-undo",
            "webhook-auth-unused",
        ]
        .into_iter()
        .map(|id| (id.to_owned(), origins.clone()))
        .collect();
        std::fs::write(&path, serde_json::json!({ "secrets": secrets }).to_string()).unwrap();
        let store = SecretStore::load(path, None).unwrap();
        let config = serde_json::json!({"commands":[{"toolConfig":{"headers":{"a":"tyco-secret:webhook-header-shared"}}}]});
        let candidates = HashSet::from([
            "webhook-header-shared".into(),
            "webhook-header-obsolete".into(),
        ]);
        cleanup(
            &store,
            &referenced_secrets(&config),
            false,
            Some(&candidates),
        );
        assert!(store.ids().contains(&"webhook-header-shared".into()));
        assert!(store.ids().contains(&"webhook-header-undo".into()));
        assert!(!store.ids().contains(&"webhook-header-obsolete".into()));
        cleanup(&store, &referenced_secrets(&config), true, None);
        assert_eq!(store.ids(), vec![String::from("webhook-header-shared")]);
    }

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

    #[test]
    fn ensure_secret_not_referenced_rejects_used_keys_and_allows_free_keys() {
        let config = serde_json::json!({
            "commands": [{
                "toolConfig": {
                    "headers": {
                        "Authorization": "tyco-secret:active-secret"
                    }
                }
            }],
            "nested": ["tyco-secret:nested-secret"]
        });
        assert!(ensure_secret_not_referenced(&config, "active-secret").is_err());
        assert!(ensure_secret_not_referenced(&config, "nested-secret").is_err());
        assert!(ensure_secret_not_referenced(&config, "unused-secret").is_ok());
    }
}
