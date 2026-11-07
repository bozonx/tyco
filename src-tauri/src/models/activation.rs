//! What an activation opens, as the webview receives it.
use serde::{Deserialize, Serialize};

use crate::errors::AppError;

#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum ActivationMode {
    Editor,
    QuickInput,
    Chat,
    VoiceChat,
    VoiceCommands,
    Voice,
    SelectionActions,
    Correction,
    Translation,
    Styling,
    Transformation,
    QuickAiRequest,
    VoiceQuickAiRequest,
    ScreenshotQuickAiRequest,
    VoiceScreenshotQuickAiRequest,
    ChatPrompts,
    Favorites,
    History,
    Config,
    CustomAction,
    /// Asks the user whether an external call may use the selection; Tyco
    /// opens it itself, so no caller can name it.
    ExternalAccess,
}

impl ActivationMode {
    /// The modes a caller may name: every one but `ExternalAccess`.
    pub const PUBLIC_MODES: [Self; 20] = [
        Self::Editor,
        Self::QuickInput,
        Self::Chat,
        Self::VoiceChat,
        Self::VoiceCommands,
        Self::Voice,
        Self::SelectionActions,
        Self::Correction,
        Self::Translation,
        Self::Styling,
        Self::Transformation,
        Self::QuickAiRequest,
        Self::VoiceQuickAiRequest,
        Self::ScreenshotQuickAiRequest,
        Self::VoiceScreenshotQuickAiRequest,
        Self::ChatPrompts,
        Self::Favorites,
        Self::History,
        Self::Config,
        Self::CustomAction,
    ];

    /// A public mode in any spelling `tyco_activation_protocol` accepts.
    pub fn parse(value: &str) -> Result<Self, AppError> {
        let canonical = tyco_activation_protocol::canonical_mode(value);
        Self::PUBLIC_MODES
            .into_iter()
            .find(|mode| mode.as_str() == canonical)
            .ok_or_else(|| AppError::InvalidInput(format!("Unknown activation mode: {value}")))
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Editor => "editor",
            Self::QuickInput => "quickInput",
            Self::Chat => "chat",
            Self::VoiceCommands => "voiceCommands",
            Self::VoiceChat => "voiceChat",
            Self::Voice => "voice",
            Self::SelectionActions => "selectionActions",
            Self::Correction => "correction",
            Self::Translation => "translation",
            Self::Styling => "styling",
            Self::Transformation => "transformation",
            Self::QuickAiRequest => "quickAiRequest",
            Self::VoiceQuickAiRequest => "voiceQuickAiRequest",
            Self::ScreenshotQuickAiRequest => "screenshotQuickAiRequest",
            Self::VoiceScreenshotQuickAiRequest => "voiceScreenshotQuickAiRequest",
            Self::ChatPrompts => "chatPrompts",
            Self::Favorites => "favorites",
            Self::History => "history",
            Self::Config => "config",
            Self::CustomAction => "customAction",
            Self::ExternalAccess => "externalAccess",
        }
    }
    pub fn is_screenshot(self) -> bool {
        matches!(
            self,
            Self::ScreenshotQuickAiRequest | Self::VoiceScreenshotQuickAiRequest
        )
    }

    pub fn profile(self) -> WindowProfile {
        match self {
            // the dictation bar leaves the screen above it in view
            Self::QuickInput | Self::Voice => WindowProfile::Panel,
            _ => WindowProfile::Sheet,
        }
    }
}

/// Where the window is placed. Its size never depends on it: every activation
/// uses `WINDOW_SIZE`, so the window is never resized while it is shown.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
pub enum WindowProfile {
    /// Anchored to the bottom of the screen.
    Panel,
    /// Centered on the screen.
    Sheet,
}

/// What the prompt shows, see `DesktopSnapshot::access_request`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct AccessRequest {
    pub job_id: String,
    pub command_name: String,
    /// The output is to replace the selection, not only to be returned.
    #[serde(rename = "replace")]
    pub should_replace: bool,
}
