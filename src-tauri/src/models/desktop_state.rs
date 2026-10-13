use super::LocalState;
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
    pub window_id: Option<String>,
    pub selected_text: Option<String>,
    pub mode: Option<ActivationMode>,
    pub launcher_page: usize,
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
    pub local_state: LocalState,
    pub app_config: Value,
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshot_matches_the_shared_domain_wire_fixture() {
        let mut params =
            crate::models::default_desktop_state(serde_json::json!({}), LocalState::default());
        params.revision = 7;
        params.activation.activation_id = 2;
        params.activation.window_id = Some("target".into());
        params.activation.selected_text = Some("Captured text".into());
        params.window.is_window_shown = true;
        params.settings.app_config = serde_json::json!({});
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../packages/shared/fixtures/desktop-events.json"
        ))
        .unwrap();
        assert_eq!(
            serde_json::to_value(params).unwrap(),
            fixture["desktopState"]
        );
    }
}
