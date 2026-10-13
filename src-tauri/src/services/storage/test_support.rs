pub(super) use crate::services::test_support::TestDir;

use crate::models::{EditorHistoryKind, EditorHistoryRecord};

pub(super) fn history_item(id: &str, text: &str, kind: EditorHistoryKind) -> EditorHistoryRecord {
    EditorHistoryRecord {
        id: id.to_owned(),
        text: text.to_owned(),
        kind,
        operation: None,
        created_at: 1,
        result: None,
        sent: false,
    }
}

pub(super) fn history_texts(history: &[EditorHistoryRecord]) -> Vec<&str> {
    history.iter().map(|item| item.text.as_str()).collect()
}
