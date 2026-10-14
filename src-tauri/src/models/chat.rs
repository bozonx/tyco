use serde::{Deserialize, Serialize};

/// Payload of app://open-main-chat; mirrored by OpenMainChatEvent in shared.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenMainChatEvent {
    pub attachment: Option<ChatAttachment>,
    pub question: Option<String>,
    pub auto_send: bool,
}

/// A text the user attached to a chat message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatAttachment {
    pub text: String,
    /// Where the attached text came from.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<ChatAttachmentSource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, rename = "mediaType", skip_serializing_if = "Option::is_none")]
    pub media_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatImage {
    pub id: String,
    #[serde(rename = "mediaType")]
    pub media_type: ChatImageMediaType,
    #[serde(rename = "width")]
    pub width_px: u32,
    #[serde(rename = "height")]
    pub height_px: u32,
    #[serde(rename = "size")]
    pub size_bytes: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: ChatRole,
    pub content: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<ChatAttachment>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<ChatImage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<ChatMessageStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chat {
    pub id: String,
    pub title: String,
    pub last_message_at: String,
    pub messages: Vec<ChatMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSummary {
    pub id: String,
    pub title: String,
    pub last_message_at: String,
}

impl From<&Chat> for ChatSummary {
    fn from(chat: &Chat) -> Self {
        Self {
            id: chat.id.clone(),
            title: chat.title.clone(),
            last_message_at: chat.last_message_at.clone(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ChatAttachmentSource {
    Selection,
    EditorSelection,
    EditorText,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChatRole {
    User,
    Assistant,
    Developer,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChatMessageStatus {
    Complete,
    Stopped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ChatImageMediaType {
    #[serde(rename = "image/webp")]
    Webp,
}
impl ChatImageMediaType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Webp => "image/webp",
        }
    }
}
impl std::str::FromStr for ChatImageMediaType {
    type Err = crate::errors::AppError;
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "image/webp" => Ok(Self::Webp),
            _ => Err(crate::errors::AppError::InvalidInput(
                "Unsupported chat image media type".into(),
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn image_dimensions_and_size_preserve_the_wire_names() {
        let value = serde_json::json!({"id":"image", "mediaType":"image/webp", "width":320, "height":240, "size":1024});
        let image: super::ChatImage = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(
            (image.width_px, image.height_px, image.size_bytes),
            (320, 240, 1024)
        );
        assert_eq!(serde_json::to_value(image).unwrap(), value);
    }

    use super::*;

    #[test]
    fn chat_summaries_use_the_wire_names() {
        let chat: Chat = serde_json::from_value(serde_json::json!({
            "id": "chat-1", "title": "Chat title", "lastMessageAt": "2026-10-12T10:00:00.000Z", "messages": []
        })).unwrap();
        let summary = serde_json::to_value(ChatSummary::from(&chat)).unwrap();
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../packages/shared/fixtures/desktop-events.json"
        ))
        .unwrap();
        assert_eq!(summary, fixture["chatSummary"]);
        let serialized = serde_json::to_value(chat).unwrap();
        assert_eq!(serialized["lastMessageAt"], "2026-10-12T10:00:00.000Z");
        let round_trip: Chat = serde_json::from_value(serialized.clone()).unwrap();
        assert_eq!(round_trip.last_message_at, "2026-10-12T10:00:00.000Z");
        assert_eq!(serialized["title"], "Chat title");
    }
}

#[cfg(test)]
mod validation_tests {
    use super::*;

    #[test]
    fn wire_enums_reject_values_the_frontend_cannot_handle() {
        assert!(serde_json::from_value::<ChatMessage>(
            serde_json::json!({"role": "system", "content": "text"})
        )
        .is_err());
        assert!(serde_json::from_value::<ChatMessage>(
            serde_json::json!({"role": "user", "content": "text", "status": "pending"})
        )
        .is_err());
        assert!(serde_json::from_value::<ChatAttachment>(
            serde_json::json!({"text": "text", "source": "unknown"})
        )
        .is_err());
        assert!(serde_json::from_value::<ChatImage>(serde_json::json!({"id": "image", "mediaType": "image/svg+xml", "width": 1, "height": 1, "size": 1})).is_err());
    }
}
