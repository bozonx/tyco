#[cfg(test)]
mod test_support;

mod chat_history;
mod config;
mod editor_history;
mod history_store;
mod json_files;
mod paths;

pub use config::*;
pub use history_store::*;
pub use paths::{app_data_dir, app_data_sub_dir, app_log_dir, get_storage_info, storage_dir};

// the history and config modules reach these through `super::*`
use json_files::*;
use paths::*;

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
#[cfg(test)]
use serde_json::json;
use serde_json::Value;
use tauri::AppHandle;

use crate::errors::AppError;
use crate::models::{
    Chat, ChatSummary, CreateEditorHistoryRequest, EditorHistoryRecord, CONFIG_FILE_NAME,
};
use crate::services::atomic_file::read_or_quarantine;
use crate::services::clock::now_ms;
use crate::services::settings::defaults::default_user_config;
use crate::services::settings::version;

/// How many entries to keep; 0 turns the history off. Missing or invalid
/// numbers use the domain default; serialized numeric strings are not accepted.
fn history_limit(config: &Value, key: &str, default: usize) -> usize {
    config
        .get(key)
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .unwrap_or(default)
}

fn new_history_id(now_ms: u64) -> String {
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    format!("{now_ms:x}-{:x}", COUNTER.fetch_add(1, Ordering::Relaxed))
}

const DAY_MS: u64 = 24 * 60 * 60 * 1000;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{EditorHistoryKind, EditorHistoryOperation};
    use crate::services::storage::test_support::history_item;

    #[test]
    fn history_limit_falls_back_to_the_default() {
        let config = json!({ "maxItems": "many", "negative": -3 });

        assert_eq!(history_limit(&config, "maxItems", 20), 20);
        assert_eq!(history_limit(&config, "negative", 20), 20);
        assert_eq!(history_limit(&config, "missing", 10), 10);
    }

    #[test]
    fn history_limit_accepts_numbers_and_rejects_numeric_strings() {
        assert_eq!(history_limit(&json!({ "maxItems": 5 }), "maxItems", 50), 5);
        assert_eq!(
            history_limit(&json!({ "maxItems": " 7 " }), "maxItems", 50),
            50
        );
    }

    #[test]
    fn history_limit_zero_turns_the_history_off() {
        assert_eq!(history_limit(&json!({ "maxItems": 0 }), "maxItems", 50), 0);
        assert_eq!(
            history_limit(&json!({ "maxItems": "0" }), "maxItems", 50),
            50
        );
    }

    #[test]
    fn editor_history_item_uses_the_ui_field_names() {
        let mut item = history_item("x", "text", EditorHistoryKind::Source);
        item.operation = Some(EditorHistoryOperation::VoiceCorrection);
        item.result = Some(String::from("Text."));

        assert_eq!(
            serde_json::to_value(&item).unwrap(),
            json!({
                "id": "x",
                "text": "text",
                "kind": "source",
                "operation": "voiceCorrection",
                "createdAt": 1,
                "result": "Text.",
            })
        );

        item.is_result_applied = true;

        assert_eq!(
            serde_json::to_value(&item).unwrap()["isResultApplied"],
            json!(true)
        );
    }

    #[test]
    fn editor_history_entry_reads_the_replace_id() {
        let entry: CreateEditorHistoryRequest = serde_json::from_value(json!({
            "text": "text",
            "kind": "draft",
            "replaceId": "abc",
        }))
        .unwrap();

        assert_eq!(entry.replace_id.as_deref(), Some("abc"));
    }

    #[test]
    fn new_history_id_is_unique_within_a_millisecond() {
        assert_ne!(new_history_id(5), new_history_id(5));
    }
}
