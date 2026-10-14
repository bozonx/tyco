use serde::{Deserialize, Serialize};

/// Why a text got into the editor history.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EditorHistoryOperation {
    AiTask,
    Translate,
    Correction,
    VoiceCorrection,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorHistoryRecord {
    pub id: String,
    pub text: String,
    pub kind: EditorHistoryKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation: Option<EditorHistoryOperation>,
    /// Unix time in milliseconds.
    pub created_at: u64,
    /// What the AI turned a `Source` entry into.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    /// The `result` of a `Source` entry was inserted into a window or copied.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub sent: bool,
}

/// What the UI sends to add a text; id and time are assigned by the backend.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateEditorHistoryRequest {
    pub text: String,
    pub kind: EditorHistoryKind,
    #[serde(default)]
    pub operation: Option<EditorHistoryOperation>,
    /// A draft entry this one supersedes: the same editing session saved again.
    #[serde(default)]
    pub replace_id: Option<String>,
}
