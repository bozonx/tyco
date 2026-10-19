//! Storage modes, retention limits, and secret sanitization.
use super::DEFAULT_EDITOR_HISTORY_LIMIT;
use crate::models::EditorHistoryRecord;
use crate::services::secrets::detector::redact_secrets;
use crate::services::storage::{history_limit, DAY_MS};
use serde_json::Value;

/// Where the editor history lives.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EditorHistoryStorageMode {
    /// Nothing is kept.
    Off,
    /// The memory of the process only: nothing outlives the app.
    Session,
    Disk,
}

impl EditorHistoryStorageMode {
    /// The saved storage; `disk`, the default, when it is missing.
    pub fn from_config(user_config: &Value) -> Self {
        match user_config
            .get("editorHistory")
            .and_then(|value| value.get("storage"))
            .and_then(Value::as_str)
        {
            Some("off") => Self::Off,
            Some("session") => Self::Session,
            _ => Self::Disk,
        }
    }
}

/// What the settings say about the editor history.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EditorHistoryPolicy {
    /// How many entries to keep; 0 keeps none.
    pub max_entries: usize,
    /// The entries live in the memory of the process only and never reach the
    /// disk, so nothing of them outlives the app, whichever way it ends.
    pub is_memory_only: bool,
    /// Entries older than this many days are dropped; 0 keeps them forever.
    /// Applies on the disk only, as does `should_redact_secrets`.
    pub retention_days: u64,
    /// What looks like a password or a key is masked before it is stored.
    pub should_redact_secrets: bool,
}

impl EditorHistoryPolicy {
    pub fn from_config(user_config: &Value) -> Self {
        let flag = |key: &str| {
            user_config["editorHistory"]
                .get(key)
                .and_then(Value::as_bool)
                .unwrap_or(false)
        };

        let storage = EditorHistoryStorageMode::from_config(user_config);
        let on_disk = storage == EditorHistoryStorageMode::Disk;

        Self {
            max_entries: if storage == EditorHistoryStorageMode::Off {
                0
            } else {
                history_limit(
                    &user_config["editorHistory"],
                    "maxItems",
                    DEFAULT_EDITOR_HISTORY_LIMIT,
                )
            },
            is_memory_only: storage == EditorHistoryStorageMode::Session,
            retention_days: if on_disk {
                user_config
                    .get("editorHistory")
                    .and_then(|value| value.get("retentionDays"))
                    .and_then(Value::as_u64)
                    .unwrap_or(0)
            } else {
                0
            },
            should_redact_secrets: on_disk && flag("isSecretSanitizingEnabled"),
        }
    }

    pub(super) fn redact(&self, text: String) -> String {
        if self.should_redact_secrets {
            redact_secrets(&text)
        } else {
            text
        }
    }

    /// Brings stored entries in line with the settings: drops those past the
    /// retention period or over the limit and masks secrets when asked, also
    /// in entries stored before the setting was turned on.
    pub(super) fn enforce(&self, history: &mut Vec<EditorHistoryRecord>, now_ms: u64) {
        if self.retention_days > 0 {
            let cutoff = now_ms.saturating_sub(self.retention_days.saturating_mul(DAY_MS));
            history.retain(|item| item.created_at_ms >= cutoff);
        }
        history.truncate(self.max_entries);
        if self.should_redact_secrets {
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

    fn history_item(id: &str, text: &str, kind: EditorHistoryKind) -> EditorHistoryRecord {
        EditorHistoryRecord {
            id: id.to_string(),
            text: text.to_string(),
            kind,
            operation: None,
            created_at_ms: 1,
            result: None,
            is_result_applied: false,
        }
    }

    fn history_texts(history: &[EditorHistoryRecord]) -> Vec<&str> {
        history.iter().map(|item| item.text.as_str()).collect()
    }

    fn policy() -> EditorHistoryPolicy {
        EditorHistoryPolicy {
            max_entries: 100,
            is_memory_only: false,
            retention_days: 0,
            should_redact_secrets: false,
        }
    }

    #[test]
    fn policy_reads_the_settings() {
        let config = json!({"editorHistory":{"storage":"disk","maxItems":20,"retentionDays":7,"isSecretSanitizingEnabled":true}});

        assert_eq!(
            EditorHistoryPolicy::from_config(&config),
            EditorHistoryPolicy {
                max_entries: 20,
                is_memory_only: false,
                retention_days: 7,
                should_redact_secrets: true,
            }
        );
        assert_eq!(
            EditorHistoryPolicy::from_config(
                &json!({"editorHistory":{"storage":"session","maxItems":20,"retentionDays":7,"isSecretSanitizingEnabled":true}})
            ),
            EditorHistoryPolicy {
                max_entries: 20,
                is_memory_only: true,
                ..policy()
            }
        );
        assert_eq!(
            EditorHistoryPolicy::from_config(
                &json!({"editorHistory":{"storage":"off","maxItems":20}})
            ),
            EditorHistoryPolicy {
                max_entries: 0,
                ..policy()
            }
        );
        assert_eq!(
            EditorHistoryPolicy::from_config(&json!({})),
            EditorHistoryPolicy {
                max_entries: DEFAULT_EDITOR_HISTORY_LIMIT,
                ..policy()
            }
        );
    }

    #[test]
    fn enforce_drops_expired_entries_and_those_over_the_limit() {
        let now = 100 * DAY_MS;
        let mut fresh = history_item("fresh", "fresh", EditorHistoryKind::Draft);
        fresh.created_at_ms = now - DAY_MS;
        let mut second = history_item("second", "second", EditorHistoryKind::Draft);
        second.created_at_ms = now - 2 * DAY_MS;
        let mut old = history_item("old", "old", EditorHistoryKind::Draft);
        old.created_at_ms = now - 3 * DAY_MS;
        let mut history = vec![fresh, second, old];

        EditorHistoryPolicy {
            retention_days: 2,
            ..policy()
        }
        .enforce(&mut history, now);
        assert_eq!(history_texts(&history), ["fresh", "second"]);

        EditorHistoryPolicy {
            max_entries: 1,
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
            should_redact_secrets: true,
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
