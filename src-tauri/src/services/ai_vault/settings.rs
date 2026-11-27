//! The settings of a vault, `tyco-vault-settings.json` next to its marker:
//! synced with the vault, so every device applies them. Kept apart from the
//! marker, which names the vault and hardly ever changes, so that an edit of
//! the settings never conflicts with it in a sync.
//!
//! Each setting is optional: a missing one follows the app-wide default
//! (the chat history keeps chats forever). Fields this build does not
//! know are kept when the file is written.
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs;
use std::path::Path;

use crate::errors::AppError;
use crate::services::atomic_file::write_private;

pub const VAULT_SETTINGS_FILE: &str = "tyco-vault-settings.json";
/// The layout of the settings file this build writes.
pub const VAULT_SETTINGS_FORMAT_VERSION: u64 = 1;

/// Whether the chats of a vault's profiles are saved.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum VaultHistoryStorage {
    Off,
    Disk,
}

/// The chat history of a vault's profiles, kept by the vault alone: a
/// missing field takes its default, saving chats forever with their quick
/// requests.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct VaultChatHistory {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub storage: Option<VaultHistoryStorage>,
    /// 0 keeps the chats forever.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub retention_days: Option<u64>,
    /// Quick requests to the profiles are saved with the chats.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub is_quick_request_saving_enabled: Option<bool>,
}

impl VaultChatHistory {
    /// Reads leniently: a field of the wrong type is as if missing.
    fn from_value(value: Option<&Value>) -> Self {
        let Some(Value::Object(object)) = value else {
            return Self::default();
        };
        Self {
            storage: object
                .get("storage")
                .and_then(|value| serde_json::from_value(value.clone()).ok()),
            retention_days: object.get("retentionDays").and_then(Value::as_u64),
            is_quick_request_saving_enabled: object
                .get("isQuickRequestSavingEnabled")
                .and_then(Value::as_bool),
        }
    }
}

fn read_object(root: &Path) -> Result<Map<String, Value>, AppError> {
    match fs::read_to_string(root.join(VAULT_SETTINGS_FILE)) {
        Ok(raw) => match serde_json::from_str(&raw) {
            Ok(Value::Object(object)) => Ok(object),
            Ok(_) | Err(_) => Err(AppError::InvalidInput(format!(
                "The settings of the workspace {} are unreadable",
                root.display()
            ))),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Map::new()),
        Err(error) => Err(error.into()),
    }
}

/// The chat history settings of the vault at `root`. A missing, unreadable or
/// newer file gives the defaults: a broken file must not stop the chats.
pub fn read_chat_history(root: &Path) -> VaultChatHistory {
    match read_object(root) {
        Ok(object) => VaultChatHistory::from_value(object.get("chatHistory")),
        Err(error) => {
            log::warn!("{error}");
            VaultChatHistory::default()
        }
    }
}

/// Stores the chat history settings of the vault at `root`, keeping the
/// fields this build does not know. A file of a newer layout or one that
/// cannot be read is refused rather than replaced.
pub fn write_chat_history(root: &Path, chat_history: VaultChatHistory) -> Result<(), AppError> {
    let mut object = read_object(root)?;
    let version = object
        .get("formatVersion")
        .and_then(Value::as_u64)
        .unwrap_or(VAULT_SETTINGS_FORMAT_VERSION);
    if version > VAULT_SETTINGS_FORMAT_VERSION {
        return Err(AppError::InvalidInput(format!(
            "The settings of the workspace {} were written by a newer version of TyCo",
            root.display()
        )));
    }
    object.insert(
        "formatVersion".into(),
        Value::from(VAULT_SETTINGS_FORMAT_VERSION),
    );
    let mut history = match object.remove("chatHistory") {
        Some(Value::Object(history)) => history,
        _ => Map::new(),
    };
    match chat_history.storage {
        Some(storage) => history.insert("storage".into(), serde_json::to_value(storage)?),
        None => history.remove("storage"),
    };
    match chat_history.is_quick_request_saving_enabled {
        Some(is_enabled) => history.insert(
            "isQuickRequestSavingEnabled".into(),
            Value::from(is_enabled),
        ),
        None => history.remove("isQuickRequestSavingEnabled"),
    };
    match chat_history.retention_days {
        Some(days) => history.insert("retentionDays".into(), Value::from(days)),
        None => history.remove("retentionDays"),
    };
    if !history.is_empty() {
        object.insert("chatHistory".into(), Value::Object(history));
    }
    write_private(
        &root.join(VAULT_SETTINGS_FILE),
        &serde_json::to_string_pretty(&Value::Object(object))?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::test_support::TestDir;

    #[test]
    fn a_vault_without_settings_follows_the_defaults() {
        let dir = TestDir::new("vault-settings-none");
        assert_eq!(read_chat_history(&dir), VaultChatHistory::default());
    }

    #[test]
    fn chat_history_settings_round_trip_and_keep_unknown_fields() {
        let dir = TestDir::new("vault-settings-round-trip");
        fs::write(
            dir.join(VAULT_SETTINGS_FILE),
            r#"{"formatVersion":1,"future":{"a":1},"chatHistory":{"other":true}}"#,
        )
        .unwrap();
        let history = VaultChatHistory {
            storage: Some(VaultHistoryStorage::Off),
            retention_days: Some(30),
            is_quick_request_saving_enabled: Some(false),
        };
        write_chat_history(&dir, history).unwrap();
        assert_eq!(read_chat_history(&dir), history);
        let raw: Value =
            serde_json::from_str(&fs::read_to_string(dir.join(VAULT_SETTINGS_FILE)).unwrap())
                .unwrap();
        assert_eq!(raw["future"]["a"], 1);
        assert_eq!(raw["chatHistory"]["other"], true);
    }

    #[test]
    fn clearing_a_setting_brings_back_the_default() {
        let dir = TestDir::new("vault-settings-clear");
        write_chat_history(
            &dir,
            VaultChatHistory {
                storage: None,
                retention_days: Some(7),
                is_quick_request_saving_enabled: None,
            },
        )
        .unwrap();
        write_chat_history(&dir, VaultChatHistory::default()).unwrap();
        assert_eq!(read_chat_history(&dir), VaultChatHistory::default());
        let raw: Value =
            serde_json::from_str(&fs::read_to_string(dir.join(VAULT_SETTINGS_FILE)).unwrap())
                .unwrap();
        assert!(raw.get("chatHistory").is_none());
    }

    #[test]
    fn a_wrong_field_is_read_as_missing() {
        let dir = TestDir::new("vault-settings-lenient");
        fs::write(
            dir.join(VAULT_SETTINGS_FILE),
            r#"{"chatHistory":{"storage":"bogus","retentionDays":"x"}}"#,
        )
        .unwrap();
        assert_eq!(read_chat_history(&dir), VaultChatHistory::default());
    }

    #[test]
    fn a_newer_or_broken_file_is_not_replaced() {
        let dir = TestDir::new("vault-settings-newer");
        fs::write(dir.join(VAULT_SETTINGS_FILE), r#"{"formatVersion":9}"#).unwrap();
        assert!(write_chat_history(&dir, VaultChatHistory::default()).is_err());
        fs::write(dir.join(VAULT_SETTINGS_FILE), "{").unwrap();
        assert!(write_chat_history(&dir, VaultChatHistory::default()).is_err());
        assert_eq!(read_chat_history(&dir), VaultChatHistory::default());
    }
}
