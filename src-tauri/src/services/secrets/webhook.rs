//! Webhook header values the user marked secret are kept in the secret store,
//! bound to an origin; the config holds only `tyco-secret:<id>` references.
//! The webview stores a value and makes the reference; the settings save only
//! removes the values no config refers to any more. A plain header value stays
//! in the config as it is: it may hold variables.
use serde_json::Value;
use std::collections::HashSet;

use crate::errors::AppError;
use crate::services::secrets::{SecretStore, SECRET_REF_PREFIX};

/// The secrets the app makes for webhooks; it removes them once unused.
const WEBHOOK_HEADER_PREFIX: &str = "webhook.header.";

/// Removes the header secrets a saved config dropped, once the save is done.
pub struct PendingHeaderSecrets<'a> {
    store: &'a SecretStore,
}

impl PendingHeaderSecrets<'_> {
    /// Keeps every key when the disk state is uncertain.
    pub fn retain(self) {}
    pub fn commit(self, previous: &Value, next: &Value) {
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
        cleanup(self.store, &retained, Some(&candidates));
    }
}

pub fn track_for_save(store: &SecretStore) -> PendingHeaderSecrets<'_> {
    PendingHeaderSecrets { store }
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
            for item in fields.values() {
                collect_references(item, result);
            }
        }
        _ => {}
    }
}

fn cleanup(store: &SecretStore, retained: &HashSet<String>, candidates: Option<&HashSet<String>>) {
    for id in store.ids() {
        if id.starts_with(WEBHOOK_HEADER_PREFIX)
            && !retained.contains(&id)
            && candidates.is_none_or(|ids| ids.contains(&id))
        {
            if let Err(error) = store.remove(&id) {
                log::warn!("Could not remove unused webhook secret: {error}");
            }
        }
    }
}

/// Startup has no outstanding drafts or undo actions.
pub fn cleanup_after_startup(store: &SecretStore, config: &Value) {
    cleanup(store, &referenced_secrets(config), None);
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
            "webhook.header.shared",
            "webhook.header.obsolete",
            "webhook.header.undo",
        ]
        .into_iter()
        .map(|id| (id.to_owned(), origins.clone()))
        .collect();
        std::fs::write(&path, serde_json::json!({ "secrets": secrets }).to_string()).unwrap();
        let store = SecretStore::load(path, None).unwrap();
        let config = serde_json::json!({"commands":[{"operationConfig":{"headers":{"a":"tyco-secret:webhook.header.shared"}}}]});
        let candidates = HashSet::from([
            "webhook.header.shared".into(),
            "webhook.header.obsolete".into(),
        ]);
        cleanup(&store, &referenced_secrets(&config), Some(&candidates));
        assert!(store.ids().contains(&"webhook.header.shared".into()));
        assert!(store.ids().contains(&"webhook.header.undo".into()));
        assert!(!store.ids().contains(&"webhook.header.obsolete".into()));
        cleanup(&store, &referenced_secrets(&config), None);
        assert_eq!(store.ids(), vec![String::from("webhook.header.shared")]);
    }

    #[test]
    fn ensure_secret_not_referenced_rejects_used_keys_and_allows_free_keys() {
        let config = serde_json::json!({
            "commands": [{
                "operationConfig": {
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
