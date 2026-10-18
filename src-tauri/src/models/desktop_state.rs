use super::SessionState;
use crate::services::{
    activation::{ActivationMode, WindowProfile},
    external_access::AccessRequest,
    external_commands::LauncherRequest,
};
use serde::Serialize;
use serde_json::Value;
/// Wire state is grouped by domain; all domains share a coherent revision.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSnapshot {
    pub revision: u64,
    pub activation: ActivationSnapshot,
    pub window: WindowSnapshot,
    pub settings: SettingsSnapshot,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivationSnapshot {
    pub activation_id: u64,
    #[serde(rename = "windowId")]
    pub target_window_id: Option<String>,
    pub selected_text: Option<String>,
    pub mode: Option<ActivationMode>,
    /// The page of `launcherPages` the command overlay opens on; `None` for
    /// the first one.
    pub launcher_page_id: Option<String>,
    pub launcher_request: Option<LauncherRequest>,
    pub access_request: Option<AccessRequest>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowSnapshot {
    pub is_window_shown: bool,
    pub window_profile: WindowProfile,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSnapshot {
    pub user_config: Value,
    pub session_state: SessionState,
    pub app_config: Value,
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshot_matches_the_shared_domain_wire_fixture() {
        let mut snapshot =
            crate::models::default_desktop_snapshot(serde_json::json!({}), SessionState::default());
        snapshot.revision = 7;
        snapshot.activation.activation_id = 2;
        snapshot.activation.target_window_id = Some("target".into());
        snapshot.activation.selected_text = Some("Captured text".into());
        snapshot.window.is_window_shown = true;
        snapshot.settings.app_config = serde_json::json!({});
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
