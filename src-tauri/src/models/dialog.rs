use serde::{Deserialize, Serialize};

/// What a dialog session listened to: both sides apart, or the computer sound
/// alone.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum DialogSource {
    MicrophoneAndSystem,
    System,
}

/// Who spoke in a dialog segment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum DialogSide {
    Me,
    Remote,
}

/// Translation state of a recognized dialog segment.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum DialogTranslationState {
    #[default]
    Idle,
    Pending,
    Complete,
    Failed,
}

/// One settled piece of recognized speech in a saved dialog.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct DialogSegment {
    pub id: String,
    pub side: DialogSide,
    #[serde(rename = "startMs")]
    pub start_ms: u64,
    #[serde(rename = "endMs")]
    pub end_ms: u64,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub translation: Option<String>,
    #[serde(default)]
    pub translation_state: DialogTranslationState,
}

/// Whether a session break started or resumed a dialog.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum DialogBreakAction {
    Started,
    Resumed,
}

/// A divider marking the start or resumption of a dialog session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct DialogSessionBreak {
    pub id: String,
    #[serde(rename = "timestampMs")]
    pub timestamp_ms: u64,
    pub is_recording: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub recording_file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub action: Option<DialogBreakAction>,
}

/// A saved dialog session stored in `dialogs/<id>.json`, with its audio files
/// kept in `dialogs/recordings/<id>/`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct Dialog {
    pub id: String,
    /// Optional user-assigned title; empty when untitled.
    #[serde(default)]
    pub title: String,
    /// Unix time in milliseconds when the dialog started.
    #[serde(rename = "startedAt")]
    pub started_at_ms: u64,
    /// Unix time in milliseconds when the dialog was last updated.
    #[serde(rename = "updatedAt")]
    pub updated_at_ms: u64,
    pub source: DialogSource,
    /// Target language of translations in this dialog; empty when untranslated.
    #[serde(default)]
    pub translation_target_language: String,
    #[serde(default)]
    pub segments: Vec<DialogSegment>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub session_breaks: Vec<DialogSessionBreak>,
    /// File names in `dialogs/recordings/<id>/`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub recording_files: Vec<String>,
    /// Recordings that stopped early before their capture ended.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub incomplete_recording_files: Vec<String>,
}

/// Summary of a saved dialog returned by `list_dialogs`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct DialogSummary {
    pub id: String,
    pub title: String,
    /// Short excerpt of the recognized speech for list display.
    pub preview: String,
    #[serde(rename = "startedAt")]
    pub started_at_ms: u64,
    #[serde(rename = "updatedAt")]
    pub updated_at_ms: u64,
    #[serde(rename = "durationMs")]
    pub duration_ms: u64,
    pub segment_count: usize,
    pub source: DialogSource,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub translation_target_language: String,
    pub recording_count: usize,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub has_incomplete_recording: bool,
}

/// The dialog history changed in storage: windows reload their list, and a
/// window viewing a deleted dialog clears it if idle.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct DialogsChangedEvent {
    pub removed_dialog_ids: Vec<String>,
    pub is_cleared: bool,
}

const PREVIEW_MAX_CHARS: usize = 140;

fn dialog_preview(segments: &[DialogSegment]) -> String {
    let mut out = String::new();
    for segment in segments {
        let piece = segment
            .translation
            .as_deref()
            .filter(|_| segment.translation_state == DialogTranslationState::Complete)
            .unwrap_or(&segment.text)
            .trim();
        if piece.is_empty() {
            continue;
        }
        if !out.is_empty() {
            out.push(' ');
        }
        for ch in piece.chars() {
            if ch.is_whitespace() {
                if !out.ends_with(' ') {
                    out.push(' ');
                }
            } else {
                out.push(ch);
            }
            if out.chars().count() >= PREVIEW_MAX_CHARS {
                let trimmed: String = out.chars().take(PREVIEW_MAX_CHARS - 1).collect();
                return format!("{}…", trimmed.trim_end());
            }
        }
    }
    out
}

fn dialog_duration_ms(dialog: &Dialog) -> u64 {
    let latest_end = dialog
        .segments
        .iter()
        .map(|segment| segment.end_ms)
        .chain(dialog.session_breaks.iter().map(|item| item.timestamp_ms))
        .max()
        .unwrap_or(dialog.started_at_ms);
    latest_end.saturating_sub(dialog.started_at_ms)
}

impl From<&Dialog> for DialogSummary {
    fn from(dialog: &Dialog) -> Self {
        Self {
            id: dialog.id.clone(),
            title: dialog.title.clone(),
            preview: dialog_preview(&dialog.segments),
            started_at_ms: dialog.started_at_ms,
            updated_at_ms: dialog.updated_at_ms,
            duration_ms: dialog_duration_ms(dialog),
            segment_count: dialog.segments.len(),
            source: dialog.source,
            translation_target_language: dialog.translation_target_language.clone(),
            recording_count: dialog.recording_files.len(),
            has_incomplete_recording: !dialog.incomplete_recording_files.is_empty(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dialog_roundtrips_and_builds_summary() {
        let dialog = Dialog {
            id: "2026-11-25_14-03-05_a1b2c3".into(),
            title: "Design sync".into(),
            started_at_ms: 1_000,
            updated_at_ms: 61_000,
            source: DialogSource::MicrophoneAndSystem,
            translation_target_language: "ru-RU".into(),
            segments: vec![
                DialogSegment {
                    id: "seg-1".into(),
                    side: DialogSide::Remote,
                    start_ms: 2_000,
                    end_ms: 5_000,
                    text: "Hello everyone".into(),
                    translation: Some("Всем привет".into()),
                    translation_state: DialogTranslationState::Complete,
                },
                DialogSegment {
                    id: "seg-2".into(),
                    side: DialogSide::Me,
                    start_ms: 6_000,
                    end_ms: 9_000,
                    text: "Привет!".into(),
                    translation: None,
                    translation_state: DialogTranslationState::Idle,
                },
            ],
            session_breaks: vec![DialogSessionBreak {
                id: "break-1".into(),
                timestamp_ms: 1_000,
                is_recording: true,
                recording_file: Some("2026-11-25 14-03-05 a1b2c3.opus".into()),
                action: Some(DialogBreakAction::Started),
            }],
            recording_files: vec!["2026-11-25 14-03-05 a1b2c3.opus".into()],
            incomplete_recording_files: Vec::new(),
        };

        let json = serde_json::to_value(&dialog).unwrap();
        let parsed: Dialog = serde_json::from_value(json).unwrap();
        assert_eq!(parsed, dialog);

        let summary = DialogSummary::from(&dialog);
        assert_eq!(summary.preview, "Всем привет Привет!");
        assert_eq!(summary.duration_ms, 8_000);
        assert_eq!(summary.segment_count, 2);
        assert_eq!(summary.recording_count, 1);
        assert!(!summary.has_incomplete_recording);
    }
}
