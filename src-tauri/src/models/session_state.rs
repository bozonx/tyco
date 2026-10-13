use crate::services::activation::ActivationMode;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionState {
    pub last_chat_id: Option<String>,
    pub last_mode: Option<ActivationMode>,
    /// The model the chat was last used with.
    #[serde(default)]
    pub last_chat_model_id: Option<String>,
    /// Own AI requests typed in the AI task menu, the newest first.
    #[serde(default)]
    pub recent_ai_prompts: Vec<String>,
    /// Languages picked from the full list in the translate menu, newest first.
    #[serde(default)]
    pub recent_translate_languages: Vec<String>,
}
