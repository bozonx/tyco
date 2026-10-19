/// A moment of an activation the webview reports.
#[derive(Debug, Clone, Copy, serde::Deserialize, ts_rs::TS)]
#[serde(rename_all = "kebab-case")]
pub enum ActivationMetricMark {
    /// The first frame after the activation was rendered.
    Frame,
    DomFocus,
    FirstChar,
}
