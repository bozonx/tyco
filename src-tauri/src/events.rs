//! The events the backend sends to the webviews. Each names its payload type,
//! so what is emitted cannot drift from the generated bindings the webview
//! listens with.

use serde::Serialize;
use serde_json::{Map, Value};
use tauri::{Emitter, EventTarget, Runtime};
use ts_rs::TS;

use crate::models::{DesktopSnapshot, OpenMainChatEvent};
use crate::services::selection_replace::SelectionRunEvent;
use crate::services::voice::VoiceAudioLevelPayload;

pub trait DesktopEvent {
    const NAME: &'static str;
    type Payload: Serialize + Clone + TS;
}

/// Emits `E` to every webview.
pub fn emit<E: DesktopEvent, R: Runtime>(
    emitter: &impl Emitter<R>,
    payload: E::Payload,
) -> tauri::Result<()> {
    emitter.emit(E::NAME, payload)
}

/// Emits `E` to the webview `target` only, e.g. a window label.
pub fn emit_to<E: DesktopEvent, R: Runtime>(
    emitter: &impl Emitter<R>,
    target: impl Into<EventTarget>,
    payload: E::Payload,
) -> tauri::Result<()> {
    emitter.emit_to(target, E::NAME, payload)
}

macro_rules! desktop_events {
    ($($(#[$doc:meta])* $event:ident = $name:literal => $payload:ty;)*) => {
        $(
            $(#[$doc])*
            pub struct $event;
            impl DesktopEvent for $event {
                const NAME: &'static str = $name;
                type Payload = $payload;
            }
        )*

        /// Every event with the TypeScript type of its payload, for the bindings.
        #[cfg(test)]
        pub fn typescript_payloads(cfg: &ts_rs::Config) -> Vec<(&'static str, String)> {
            vec![$(($name, <$payload as TS>::name(cfg))),*]
        }

        /// The payload types the bindings declare.
        #[cfg(test)]
        pub fn visit_payloads(visitor: &mut impl ts_rs::TypeVisitor) {
            $(visitor.visit::<$payload>();)*
        }
    };
}

desktop_events! {
    /// The app is about to quit; carries the id the settings acknowledge with.
    QuitRequested = "app://quit-requested" => u64;
    QuitCancelled = "app://quit-cancelled" => ();
    PluginsChanged = "app://plugins-changed" => ();
    StateChanged = "app://state-changed" => DesktopSnapshot;
    HotkeysChanged = "app://hotkeys-changed" => ();
    OpenMainChat = "app://open-main-chat" => OpenMainChatEvent;
    OpenMainEditor = "app://open-main-editor" => EditorTransfer;
    /// The user closed the main window rather than hid it.
    MainWindowClosed = "app://main-window-closed" => ();
    #[cfg_attr(not(feature = "activation-bench"), allow(dead_code))]
    ActivationMetricsStart = "app://activation-metrics-start" => ActivationMetricsRequest;
    #[cfg_attr(not(feature = "activation-bench"), allow(dead_code))]
    ActivationMetricsCollect = "app://activation-metrics-collect" => ActivationMetricsRequest;
    /// A repeated activation confirms the open voice input; carries its
    /// activation id.
    VoiceFinish = "app://voice-finish" => u64;
    VoiceAudioLevel = "app://voice-audio-level" => VoiceAudioLevelPayload;
    SelectionRun = "app://selection-run" => SelectionRunEvent;
    SelectionCancel = "app://selection-cancel" => SelectionCancelEvent;
    /// An external call runs a command in the background.
    CommandRun = "app://command-run" => CommandRunEvent;
    /// Carries the id of the external job to stop.
    ExternalJobCancel = "app://external-job-cancel" => String;
}

/// A text handed over to the editor of the main window.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(optional_fields = nullable)]
pub struct EditorTransfer {
    pub text: Option<String>,
    /// The text before an AI transformation, for the editor history.
    pub source_text: Option<String>,
}

/// Asks the quick window to start or collect the activation metrics `id`.
#[derive(Debug, Clone, Serialize, TS)]
#[cfg_attr(not(feature = "activation-bench"), allow(dead_code))]
pub struct ActivationMetricsRequest {
    pub id: u64,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SelectionCancelEvent {
    pub run_id: u64,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CommandRunEvent {
    pub command_id: String,
    pub job_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "Record<string, unknown>")]
    pub input: Option<Map<String, Value>>,
    /// The quick window does not receive config changes made elsewhere.
    #[ts(type = "UserConfig")]
    pub user_config: std::sync::Arc<Value>,
}
