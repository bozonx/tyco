//! Storage modes, retention limits, and secret sanitization.
use super::DEFAULT_EDITOR_HISTORY_LIMIT;
use crate::models::EditorHistoryItem;
use crate::services::secret_detector::redact_secrets;
use crate::services::storage::{history_limit, DAY_MS};
use serde_json::Value;

/// Where the editor history lives.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EditorHistoryStorage {
    /// Nothing is kept.
    Off,
    /// The memory of the process only: nothing outlives the app.
    Session,
    Disk,
}

impl EditorHistoryStorage {
    /// Configs older than the setting said it with a zero limit (off) and the
    /// `clearEditorHistoryOnExit` flag (session).
    pub fn from_config(user_config: &Value) -> Self {
        match user_config
            .get("editorHistoryStorage")
            .and_then(Value::as_str)
        {
            Some("off") => return Self::Off,
            Some("session") => return Self::Session,
            Some("disk") => return Self::Disk,
            _ => {}
        }

        if history_limit(
            user_config,
            "editorHistoryMaxItems",
            DEFAULT_EDITOR_HISTORY_LIMIT,
        ) == 0
        {
            Self::Off
        } else if user_config
            .get("clearEditorHistoryOnExit")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            Self::Session
        } else {
            Self::Disk
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Session => "session",
            Self::Disk => "disk",
        }
    }
}

/// What the settings say about the editor history.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EditorHistoryPolicy {
    /// How many entries to keep; 0 keeps none.
    pub limit: usize,
    /// The entries live in the memory of the process only and never reach the
    /// disk, so nothing of them outlives the app, whichever way it ends.
    pub memory_only: bool,
    /// Entries older than this many days are dropped; 0 keeps them forever.
    /// Applies on the disk only, as does `sanitize`.
    pub retention_days: u64,
    /// What looks like a password or a key is masked before it is stored.
    pub sanitize: bool,
}

impl EditorHistoryPolicy {
    pub fn from_config(user_config: &Value) -> Self {
        let flag = |key: &str| {
            user_config
                .get(key)
                .and_then(Value::as_bool)
                .unwrap_or(false)
        };

        let storage = EditorHistoryStorage::from_config(user_config);
        let on_disk = storage == EditorHistoryStorage::Disk;

        Self {
            limit: if storage == EditorHistoryStorage::Off {
                0
            } else {
                history_limit(
                    user_config,
                    "editorHistoryMaxItems",
                    DEFAULT_EDITOR_HISTORY_LIMIT,
                )
            },
            memory_only: storage == EditorHistoryStorage::Session,
            retention_days: if on_disk {
                user_config
                    .get("editorHistoryRetentionDays")
                    .and_then(Value::as_u64)
                    .unwrap_or(0)
            } else {
                0
            },
            sanitize: on_disk && flag("sanitizeSecretsInEditorHistory"),
        }
    }

    pub(super) fn redact(&self, text: String) -> String {
        if self.sanitize {
            redact_secrets(&text)
        } else {
            text
        }
    }

    /// Brings stored entries in line with the settings: drops those past the
    /// retention period or over the limit and masks secrets when asked, also
    /// in entries stored before the setting was turned on.
    pub(super) fn enforce(&self, history: &mut Vec<EditorHistoryItem>, now_ms: u64) {
        if self.retention_days > 0 {
            let cutoff = now_ms.saturating_sub(self.retention_days.saturating_mul(DAY_MS));
            history.retain(|item| item.created_at >= cutoff);
        }
        history.truncate(self.limit);
        if self.sanitize {
            for item in history.iter_mut() {
                item.text = redact_secrets(&item.text);
                item.result = item.result.take().map(|result| redact_secrets(&result));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::EditorHistoryKind;
    use crate::services::storage::now_ms;
    use serde_json::json;

    fn history_item(id: &str, text: &str, kind: EditorHistoryKind) -> EditorHistoryItem {
        EditorHistoryItem {
            id: id.to_string(),
            text: text.to_string(),
            kind,
            operation: None,
            created_at: 1,
            result: None,
            sent: false,
        }
    }

    fn history_texts(history: &[EditorHistoryItem]) -> Vec<&str> {
        history.iter().map(|item| item.text.as_str()).collect()
    }

    fn policy() -> EditorHistoryPolicy {
        EditorHistoryPolicy {
            limit: 100,
            memory_only: false,
            retention_days: 0,
            sanitize: false,
        }
    }

    #[test]
    fn policy_reads_the_settings() {
        let config = json!({
            "editorHistoryStorage": "disk",
            "editorHistoryMaxItems": "20",
            "editorHistoryRetentionDays": 7,
            "sanitizeSecretsInEditorHistory": true,
        });

        assert_eq!(
            EditorHistoryPolicy::from_config(&config),
            EditorHistoryPolicy {
                limit: 20,
                memory_only: false,
                retention_days: 7,
                sanitize: true,
            }
        );
        assert_eq!(
            EditorHistoryPolicy::from_config(&json!({
                "editorHistoryStorage": "session",
                "editorHistoryMaxItems": 20,
                "editorHistoryRetentionDays": 7,
                "sanitizeSecretsInEditorHistory": true,
            })),
            EditorHistoryPolicy {
                limit: 20,
                memory_only: true,
                ..policy()
            }
        );
        assert_eq!(
            EditorHistoryPolicy::from_config(&json!({
                "editorHistoryStorage": "off",
                "editorHistoryMaxItems": 20,
            })),
            EditorHistoryPolicy {
                limit: 0,
                ..policy()
            }
        );
        // a config not migrated yet
        assert_eq!(
            EditorHistoryPolicy::from_config(&json!({
                "editorHistoryMaxItems": 20,
                "clearEditorHistoryOnExit": true,
            })),
            EditorHistoryPolicy {
                limit: 20,
                memory_only: true,
                ..policy()
            }
        );
        assert_eq!(
            EditorHistoryPolicy::from_config(&json!({})),
            EditorHistoryPolicy {
                limit: DEFAULT_EDITOR_HISTORY_LIMIT,
                ..policy()
            }
        );
    }

    #[test]
    fn enforce_drops_expired_entries_and_those_over_the_limit() {
        let now = 100 * DAY_MS;
        let mut fresh = history_item("fresh", "fresh", EditorHistoryKind::Draft);
        fresh.created_at = now - DAY_MS;
        let mut second = history_item("second", "second", EditorHistoryKind::Draft);
        second.created_at = now - 2 * DAY_MS;
        let mut old = history_item("old", "old", EditorHistoryKind::Draft);
        old.created_at = now - 3 * DAY_MS;
        let mut history = vec![fresh, second, old];

        EditorHistoryPolicy {
            retention_days: 2,
            ..policy()
        }
        .enforce(&mut history, now);
        assert_eq!(history_texts(&history), ["fresh", "second"]);

        EditorHistoryPolicy {
            limit: 1,
            ..policy()
        }
        .enforce(&mut history, now);
        assert_eq!(history_texts(&history), ["fresh"]);
    }

    #[test]
    fn enforce_masks_secrets_in_entries_stored_before() {
        let mut item = history_item("a", "password=hunter22", EditorHistoryKind::Source);
        item.result = Some(String::from("token: abcdef123456"));
        let mut history = vec![item];

        EditorHistoryPolicy {
            sanitize: true,
            ..policy()
        }
        .enforce(&mut history, now_ms());

        assert_eq!(history[0].text, "password=[REDACTED SECRET]");
        assert_eq!(
            history[0].result.as_deref(),
            Some("token: [REDACTED SECRET]")
        );
    }
}
