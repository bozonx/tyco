#[cfg(test)]
mod test_support;

pub mod app_paths;
mod chat_history;
mod editor_history;
mod history_store;
mod json_files;
mod paths;

pub use history_store::*;
pub use paths::{
    app_config_dir, app_data_dir, app_data_sub_dir, app_log_dir, get_storage_info, storage_dir,
};

#[cfg(test)]
use serde_json::json;

fn new_history_id(now_ms: u64) -> String {
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    format!("{now_ms:x}-{:x}", COUNTER.fetch_add(1, Ordering::Relaxed))
}

const DAY_MS: u64 = 24 * 60 * 60 * 1000;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{EditorHistoryEntry, EditorHistoryKind, EditorHistoryOperation};
    use crate::services::storage::test_support::history_item;

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
        let entry: EditorHistoryEntry = serde_json::from_value(json!({
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
