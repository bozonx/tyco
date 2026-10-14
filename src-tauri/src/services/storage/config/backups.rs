use super::super::{write_json, AppError, Path, Value, CONFIG_FILE_NAME};

/// A recoverable snapshot before repairing a current-version file.
pub(super) fn back_up_config_before_repair(path: &Path, original: &Value) -> Result<(), AppError> {
    let stem = CONFIG_FILE_NAME
        .rsplit_once('.')
        .map_or(CONFIG_FILE_NAME, |(stem, _)| stem);
    let backup = path.with_file_name(format!("{stem}.repaired.bak"));
    write_json(&backup, &without_api_keys(original))
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
    use super::super::super::fs;
    use super::*;
    use crate::services::storage::test_support::TestDir;
    use serde_json::json;

    #[test]
    fn config_backups_hold_no_api_keys() {
        let dir = TestDir::new("backup-scrub");
        let path = dir.join(CONFIG_FILE_NAME);
        let config = json!({"llm":{"providers":[{"baseUrl":"https://x.example","apiKey":"sk-secret" }]},"appearance":{"theme":"dark"}});

        back_up_config_before_repair(&path, &config).unwrap();
        let raw = fs::read_to_string(dir.join("userConfig.repaired.bak")).unwrap();
        assert!(!raw.contains("sk-secret"));
        assert!(raw.contains("x.example"));
    }
}
