//! What an activation opens, as the webview receives it.
use serde::{Deserialize, Serialize};

use crate::errors::AppError;

#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum ActivationMode {
    Editor,
    QuickInput,
    Chat,
    VoiceCommands,
    Voice,
    /// Transcribes the sound the computer plays, see `services::voice`.
    Listen,
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
    Dialog,
    Config,
    CustomAction,
    /// Shows the run of a library command, see `services::external`; Tyco
    /// opens it itself for every run, so no caller can name it.
    CommandRun,
}

impl ActivationMode {
    /// The modes a caller may name: every one but `CommandRun`.
    pub const PUBLIC_MODES: [Self; 21] = [
        Self::Editor,
        Self::QuickInput,
        Self::Chat,
        Self::VoiceCommands,
        Self::Voice,
        Self::Listen,
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
        Self::Dialog,
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
            Self::Voice => "voice",
            Self::Listen => "listen",
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
            Self::Dialog => "dialog",
            Self::Config => "config",
            Self::CustomAction => "customAction",
            Self::CommandRun => "commandRun",
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
            Self::QuickInput | Self::Voice | Self::Listen => WindowProfile::Panel,
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

/// The run the command overlay shows, see `ActivationSnapshot::command_run`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct CommandRunRequest {
    pub job_id: String,
    pub command_id: String,
    pub command_name: String,
    /// An external call asks for the selection while that is not allowed:
    /// the overlay asks the user first.
    #[serde(rename = "needsAccess")]
    pub should_ask_access: bool,
    /// The output is to replace the selection, not only to be returned.
    #[serde(rename = "replace")]
    pub should_replace: bool,
    /// Started by a caller outside Tyco, not by a hotkey or a menu.
    pub is_external: bool,
}
