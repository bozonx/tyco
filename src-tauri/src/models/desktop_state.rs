use super::{AccessRequest, ActivationMode, SessionState, WindowProfile};
use serde::Serialize;
use serde_json::Value;
/// Wire state is grouped by domain; all domains share a coherent revision.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSnapshot {
    pub revision: u64,
    pub activation: ActivationSnapshot,
    pub window: WindowSnapshot,
    pub settings: SettingsSnapshot,
}
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "DesktopActivationState")]
pub struct ActivationSnapshot {
    pub activation_id: u64,
    #[serde(rename = "windowId")]
    pub target_window_id: Option<String>,
    pub selected_text: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub screenshots: Vec<super::ChatImage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub screenshot: Option<super::ChatImage>,
    pub mode: Option<ActivationMode>,
    /// The page of `actionPages` the menu opens on, for `selectionActions`;
    /// `None` or 0 for the first one.
    pub action_page_index: Option<usize>,
    /// The slot index for `customAction`; `None` or 0 for the first one.
    pub custom_action_index: Option<usize>,
    /// The source the history opens filtered by, e.g. from the quick input.
    pub history_origin: Option<super::EditorHistoryOrigin>,
    /// The tab the settings open on, e.g. from a menu that has nothing to show.
    pub settings_tab: Option<String>,
    pub access_request: Option<AccessRequest>,
}
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "DesktopWindowState")]
pub struct WindowSnapshot {
    pub is_window_shown: bool,
    pub window_profile: WindowProfile,
    /// The quick window can be dragged: not on a layer-shell surface, whose
    /// place only its anchor and margins set.
    pub can_move_overlay: bool,
    /// The sound the computer plays can be recorded, see `platform::audio`.
    pub can_listen: bool,
    /// A single application can be recorded.
    pub can_listen_to_apps: bool,
}
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "DesktopSettingsState")]
pub struct SettingsSnapshot {
    #[ts(type = "UserConfig")]
    pub user_config: std::sync::Arc<Value>,
    pub session_state: SessionState,
    /// Where the user data folder is and whether it can be used.
    pub user_data: super::UserDataState,
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshot_matches_the_shared_domain_wire_fixture() {
        let mut snapshot = crate::services::settings::defaults::default_desktop_snapshot(
            serde_json::json!({}),
            SessionState::default(),
        );
        snapshot.revision = 7;
        snapshot.activation.activation_id = 2;
        snapshot.activation.target_window_id = Some("target".into());
        snapshot.activation.selected_text = Some("Captured text".into());
        snapshot.window.is_window_shown = true;
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../packages/shared/fixtures/desktop-events.json"
        ))
        .unwrap();
        assert_eq!(
            serde_json::to_value(snapshot).unwrap(),
            fixture["desktopState"]
        );
    }
}
