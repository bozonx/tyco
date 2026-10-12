use crate::services::activation::StartMode;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LocalState {
    pub last_chat_id: Option<String>,
    pub last_mode: Option<StartMode>,
    /// The model the chat was last used with.
    #[serde(default)]
    pub last_chat_model_id: Option<String>,
    /// Own AI requests typed in the AI task menu, the newest first.
    #[serde(default)]
    pub recent_ai_prompts: Vec<String>,
    /// Languages picked from the full list in the translate menu, newest first.
    #[serde(default)]
    pub recent_translate_languages: Vec<String>,
    /// Preferred diff view mode: unified | split | result.
    #[serde(default)]
    pub diff_mode: Option<DiffViewMode>,
    /// Preferred translation preview view mode: split | result.
    #[serde(default)]
    pub translation_view_mode: Option<TranslationViewMode>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiffViewMode {
    Unified,
    Split,
    Result,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TranslationViewMode {
    Split,
    Result,
}
