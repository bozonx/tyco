mod chat;
mod defaults;
mod desktop_state;
mod editor_history;
mod session_state;
mod storage;

pub use chat::*;
pub use defaults::*;
pub use desktop_state::*;
pub use editor_history::*;
pub use session_state::*;
pub use storage::*;

pub const CONFIG_FILE_NAME: &str = "userConfig.json";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_message_rejects_plain_string_attachments() {
        assert!(serde_json::from_value::<ChatMessage>(serde_json::json!({
            "role": "user",
            "content": "q",
            "attachments": ["text"],
        }))
        .is_err());
    }

    #[test]
    fn file_attachment_metadata_survives_history_roundtrip() {
        let value = serde_json::json!({ "text": "contents", "name": "report.pdf", "mediaType": "application/pdf" });
        let attachment: ChatAttachment = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(attachment).unwrap(), value);
    }

    #[test]
    fn chat_attachment_is_written_as_an_object() {
        let attachment = ChatAttachment {
            text: String::from("t"),
            source: None,
            name: None,
            media_type: None,
        };

        assert_eq!(
            serde_json::to_value(&attachment).unwrap(),
            serde_json::json!({ "text": "t" })
        );
    }
}

#[cfg(test)]
mod desktop_contract_tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn main_chat_event_matches_the_shared_wire_fixture() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../packages/shared/fixtures/desktop-events.json"
        ))
        .unwrap();
        let payload = OpenMainChatEvent {
            attachment: Some(ChatAttachment {
                text: "Captured text".into(),
                source: Some(ChatAttachmentSource::Selection),
                name: Some("selection.txt".into()),
                media_type: Some("text/plain".into()),
            }),
            question: Some("Explain this text".into()),
            auto_send: true,
        };
        assert_eq!(
            serde_json::to_value(payload).unwrap(),
            fixture["openMainChat"]
        );
        assert!(serde_json::from_value::<OpenMainChatEvent>(
            serde_json::json!({"text":"wrong", "autoSend":true})
        )
        .is_err());
    }
}
