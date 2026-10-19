//! A small status bubble near the bottom of the screen for work that runs
//! without a Tyco window, such as replacing the selection. It never takes the
//! keyboard and lets clicks through, so the focused window keeps working.
//! It is a plain GTK window rather than a webview: it has to appear at once
//! and costs nothing while hidden.

use serde::Deserialize;
use tauri::AppHandle;

use crate::errors::AppError;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OverlayKind {
    Pending,
    Success,
    Info,
    Error,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayRequest {
    pub(crate) kind: OverlayKind,
    pub(crate) text: String,
    /// Shows a hidden bubble only after this delay, so quick work finishes
    /// without anything flashing on the screen.
    #[serde(default)]
    pub(crate) delay_ms: u64,
    #[serde(default)]
    pub(crate) hide_after_ms: Option<u64>,
    /// Updates a visible bubble, but neither shows a hidden one nor lets a
    /// pending delay run out.
    #[serde(default)]
    pub(crate) only_if_visible: bool,
}

/// Shows the bubble as `request` says, or hides it for `None`. A request
/// replaces the previous one together with its timers.
pub fn update(app: &AppHandle, request: Option<OverlayRequest>) -> Result<(), AppError> {
    app.run_on_main_thread(move || crate::services::platform::update_status_overlay(request))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_overlay_requests_with_defaults() {
        let json = serde_json::json!({
            "kind": "success",
            "text": "Done"
        });
        let req: OverlayRequest = serde_json::from_value(json).unwrap();
        assert_eq!(req.kind, OverlayKind::Success);
        assert_eq!(req.text, "Done");
        assert_eq!(req.delay_ms, 0);
        assert_eq!(req.hide_after_ms, None);
        assert!(!req.only_if_visible);
    }

    #[test]
    fn deserializes_overlay_kinds() {
        for (name, expected) in [
            ("pending", OverlayKind::Pending),
            ("success", OverlayKind::Success),
            ("info", OverlayKind::Info),
            ("error", OverlayKind::Error),
        ] {
            let parsed: OverlayKind = serde_json::from_value(serde_json::json!(name)).unwrap();
            assert_eq!(parsed, expected);
        }
    }
}
