use serde::{Deserialize, Serialize};

/// Why a text got into the editor history.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "kebab-case")]
pub enum EditorHistoryKind {
    /// Inserted into a window or copied to the clipboard.
    Output,
    /// Unfinished or cancelled user input, periodically checkpointed.
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

/// The operation of a stored entry; one this version does not know, such as
/// the `quickAiRequest` of the entries quick requests left before they were
/// kept with the chats, reads as none: the entry stays a source with its result.
fn lenient_operation<'de, D>(deserializer: D) -> Result<Option<EditorHistoryOperation>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    Ok(value.and_then(|value| serde_json::from_value(value).ok()))
}

/// Where the text came from: where the user typed or dictated it, or the
/// quick request whose answer was inserted or copied.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum EditorHistoryOrigin {
    QuickInput,
    Voice,
    QuickAiRequest,
}

/// The input modality of an AI prompt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum EditorHistoryInputKind {
    Typed,
    Voice,
}

/// The prompt or instruction for an AI transformation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct EditorHistoryInstruction {
    pub text: String,
    pub input_kind: EditorHistoryInputKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct EditorHistoryItem {
    pub id: String,
    pub text: String,
    pub kind: EditorHistoryKind,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "lenient_operation"
    )]
    #[ts(optional)]
    pub operation: Option<EditorHistoryOperation>,
    /// Missing in entries written before the origin was recorded.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub origin: Option<EditorHistoryOrigin>,
    /// The prompt or instruction of a transformation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub instruction: Option<EditorHistoryInstruction>,
    /// Profile this operation ran under, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub profile_id: Option<String>,
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
    /// Stable identity of a live input; only unfinished entries may be replaced.
    #[serde(default)]
    pub id: Option<String>,
    pub text: String,
    pub kind: EditorHistoryKind,
    #[serde(default)]
    pub operation: Option<EditorHistoryOperation>,
    #[serde(default)]
    pub origin: Option<EditorHistoryOrigin>,
    #[serde(default)]
    pub instruction: Option<EditorHistoryInstruction>,
    #[serde(default)]
    pub profile_id: Option<String>,
}

#[cfg(test)]
mod tests {
    #[test]
    fn persisted_records_preserve_timestamp_and_applied_result_wire_names() {
        let value = serde_json::json!({"id":"record", "text":"source", "kind":"source", "createdAt":123, "result":"output", "isResultApplied":true, "instruction":{"text":"make it shorter","inputKind":"typed"}});
        let record: super::EditorHistoryItem = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(record.created_at_ms, 123);
        assert!(record.is_result_applied);
        assert_eq!(
            record.instruction,
            Some(super::EditorHistoryInstruction {
                text: "make it shorter".to_string(),
                input_kind: super::EditorHistoryInputKind::Typed,
            })
        );
        assert_eq!(serde_json::to_value(record).unwrap(), value);
    }

    #[test]
    fn a_legacy_quick_request_entry_reads_as_a_source_with_its_result() {
        let value = serde_json::json!({"id":"old", "text":"question", "kind":"source", "operation":"quickAiRequest", "createdAt":5, "result":"answer", "turns":[{"prompt":"question","result":"answer","inputKind":"typed"}]});
        let record: super::EditorHistoryItem = serde_json::from_value(value).unwrap();
        assert_eq!(record.operation, None);
        assert_eq!(record.result.as_deref(), Some("answer"));
        assert_eq!(
            serde_json::to_value(record).unwrap(),
            serde_json::json!({"id":"old", "text":"question", "kind":"source", "createdAt":5, "result":"answer"})
        );
    }

    #[test]
    fn a_known_operation_still_reads() {
        let value = serde_json::json!({"id":"a", "text":"t", "kind":"source", "operation":"translation", "createdAt":1});
        let record: super::EditorHistoryItem = serde_json::from_value(value).unwrap();
        assert_eq!(
            record.operation,
            Some(super::EditorHistoryOperation::Translation)
        );
    }
}
