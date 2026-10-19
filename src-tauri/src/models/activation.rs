//! What an activation opens, as the webview receives it.
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::errors::AppError;

#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ActivationMode {
    Editor,
    Write,
    Chat,
    VoiceChat,
    VoiceCommands,
    Voice,
    Select,
    AiTasks,
    CommandLauncher,
    Correction,
    Translate,
    History,
    Config,
    /// Asks the user whether an external call may use the selection; Tyco
    /// opens it itself, so no caller can name it.
    ExternalAccess,
}

impl ActivationMode {
    /// The modes a caller may name: every one but `ExternalAccess`.
    pub const PUBLIC_MODES: [Self; 13] = [
        Self::Editor,
        Self::Write,
        Self::Chat,
        Self::VoiceChat,
        Self::VoiceCommands,
        Self::Voice,
        Self::Select,
        Self::AiTasks,
        Self::CommandLauncher,
        Self::Correction,
        Self::Translate,
        Self::History,
        Self::Config,
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
            Self::Write => "write",
            Self::Chat => "chat",
            Self::VoiceCommands => "voiceCommands",
            Self::VoiceChat => "voiceChat",
            Self::Voice => "voice",
            Self::Select => "select",
            Self::AiTasks => "aiTasks",
            Self::CommandLauncher => "commandLauncher",
            Self::Correction => "correction",
            Self::Translate => "translate",
            Self::History => "history",
            Self::Config => "config",
            Self::ExternalAccess => "externalAccess",
        }
    }
    pub fn profile(self) -> WindowProfile {
        match self {
            // the dictation bar leaves the screen above it in view
            Self::Write | Self::Voice => WindowProfile::Panel,
            _ => WindowProfile::Sheet,
        }
    }
}

/// Where the window is placed. Its size never depends on it: every activation
/// uses `WINDOW_SIZE`, so the window is never resized while it is shown.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WindowProfile {
    /// Anchored to the bottom of the screen.
    Panel,
    /// Centered on the screen.
    Sheet,
}

/// What the prompt shows, see `DesktopSnapshot::access_request`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessRequest {
    pub job_id: String,
    pub command_name: String,
    /// The output is to replace the selection, not only to be returned.
    #[serde(rename = "replace")]
    pub should_replace: bool,
}

/// A command the overlay opens with, see `Activation::launcher_request`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherRequest {
    pub command_id: String,
    /// The text of the call; without it the selection or the field gives it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub job_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input: Option<serde_json::Map<String, Value>>,
}
