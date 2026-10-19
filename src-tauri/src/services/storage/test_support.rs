pub(super) use crate::services::test_support::TestDir;

use crate::models::{EditorHistoryItem, EditorHistoryKind};

pub(super) fn history_item(id: &str, text: &str, kind: EditorHistoryKind) -> EditorHistoryItem {
    EditorHistoryItem {
        id: id.to_owned(),
        text: text.to_owned(),
        kind,
        operation: None,
        created_at_ms: 1,
        result: None,
        is_result_applied: false,
    }
}

pub(super) fn history_texts(history: &[EditorHistoryItem]) -> Vec<&str> {
    history.iter().map(|item| item.text.as_str()).collect()
}
