use serde::{Deserialize, Serialize};

/// Why a text got into the editor history.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "kebab-case")]
pub enum EditorHistoryKind {
    /// Inserted into a window or copied to the clipboard.
    Output,
    /// Unsent text: discarded from the editor or kept there while the window
    /// was hidden.
    Draft,
    /// Snapshot taken right before an AI transformation.
    Source,
}

/// The AI transformation a `Source` entry was taken before.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum EditorHistoryOperation {
    AiTask,
    Translation,
    Correction,
    VoiceCorrection,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct EditorHistoryItem {
    pub id: String,
    pub text: String,
    pub kind: EditorHistoryKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub operation: Option<EditorHistoryOperation>,
    /// Unix time in milliseconds.
    #[serde(rename = "createdAt")]
    pub created_at_ms: u64,
    /// What the AI turned a `Source` entry into.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub result: Option<String>,
    /// The `result` of a `Source` entry was inserted into a window or copied.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_result_applied: bool,
}

/// What the UI sends to add a text; id and time are assigned by the backend.
#[derive(Debug, Clone, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(optional_fields = nullable)]
pub struct EditorHistoryEntry {
    pub text: String,
    pub kind: EditorHistoryKind,
    #[serde(default)]
    pub operation: Option<EditorHistoryOperation>,
    /// A draft entry this one supersedes: the same editing session saved again.
    #[serde(default)]
    pub replace_id: Option<String>,
}

#[cfg(test)]
mod tests {
    #[test]
    fn persisted_records_preserve_timestamp_and_applied_result_wire_names() {
        let value = serde_json::json!({"id":"record", "text":"source", "kind":"source", "createdAt":123, "result":"output", "isResultApplied":true});
        let record: super::EditorHistoryItem = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(record.created_at_ms, 123);
        assert!(record.is_result_applied);
        assert_eq!(serde_json::to_value(record).unwrap(), value);
    }
}
