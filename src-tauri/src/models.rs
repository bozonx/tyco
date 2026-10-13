mod chat;
mod defaults;
mod desktop_state;
mod editor_history;
mod settings;
mod storage;

pub use chat::*;
pub use defaults::*;
pub use desktop_state::*;
pub use editor_history::*;
pub use settings::*;
pub use storage::*;

pub const CONFIG_FILE_NAME: &str = "userConfig.yaml";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_message_reads_plain_string_attachments_of_older_files() {
        let message: ChatMessage = serde_json::from_value(serde_json::json!({
            "role": "user",
            "content": "q",
            "attachments": ["old", { "text": "new", "source": "editor-text" }],
        }))
        .unwrap();

        assert_eq!(
            message.attachments,
            vec![
                ChatAttachment {
                    text: String::from("old"),
                    source: None,
                    name: None,
                    media_type: None,
                },
                ChatAttachment {
                    text: String::from("new"),
                    source: Some(ChatAttachmentSource::EditorText),
                    name: None,
                    media_type: None,
                },
            ]
        );
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
