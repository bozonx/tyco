use std::path::Path;

use serde_json::Value;

use super::write_json;
use crate::errors::AppError;
use crate::services::atomic_file::{prune_copies, KEPT_COPY_COUNT};
use crate::services::clock::now_ms;

/// What the name of a snapshot adds to the name of the config file.
const REPAIRED_COPY_MARKER: &str = ".repaired-";

/// A recoverable snapshot before repairing a current-version file:
/// `config.json.repaired-<unix ms>`; the newest few are kept.
pub(super) fn back_up_config_before_repair(path: &Path, original: &Value) -> Result<(), AppError> {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(format!("{REPAIRED_COPY_MARKER}{}", now_ms()));
    write_json(&path.with_file_name(name), &without_api_keys(original))?;
    prune_copies(path, REPAIRED_COPY_MARKER, KEPT_COPY_COUNT)
}

/// Removes credential fields from untrusted input at any depth.
fn without_api_keys(value: &Value) -> Value {
    match value {
        Value::Object(fields) => Value::Object(
            fields
                .iter()
                .filter(|(key, _)| {
                    !key.to_ascii_lowercase().ends_with("apikey") && key.as_str() != "headers"
                })
                .map(|(key, field)| (key.clone(), without_api_keys(field)))
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.iter().map(without_api_keys).collect()),
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;
    use crate::models::CONFIG_FILE_NAME;
    use crate::services::test_support::TestDir;
    use serde_json::json;

    #[test]
    fn config_backups_hold_no_api_keys() {
        let dir = TestDir::new("backup-scrub");
        let path = dir.join(CONFIG_FILE_NAME);
        let config = json!({"llm":{"providers":[{"baseUrl":"https://x.example","apiKey":"sk-secret" }]},"appearance":{"theme":"dark"}});

        back_up_config_before_repair(&path, &config).unwrap();
        let backup = fs::read_dir(&*dir)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .find(|backup| {
                backup
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("config.json.repaired-")
            })
            .unwrap();
        let raw = fs::read_to_string(backup).unwrap();
        assert!(!raw.contains("sk-secret"));
        assert!(raw.contains("x.example"));
    }

    #[test]
    fn without_api_keys_removes_credentials_at_any_depth() {
        let original = json!({
            "service": {
                "apiKey": "secret1",
                "CUSTOM_APIKEY": "secret2",
                "headers": { "Authorization": "Bearer token" },
                "safeField": "value",
                "nestedList": [
                    { "deepApiKey": "secret3", "keep": 42 },
                    { "headers": "should_be_removed", "name": "item" }
                ]
            },
            "rootKey": "rootVal"
        });

        let scrubbed = without_api_keys(&original);
        assert_eq!(
            scrubbed,
            json!({
                "service": {
                    "safeField": "value",
                    "nestedList": [
                        { "keep": 42 },
                        { "name": "item" }
                    ]
                },
                "rootKey": "rootVal"
            })
        );
    }
}
