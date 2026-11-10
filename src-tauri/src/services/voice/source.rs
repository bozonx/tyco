//! What a capture records, and the wire types of the sound sources.
use serde::{Deserialize, Serialize};

/// Where the audio of a capture comes from.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CaptureSource {
    /// The default input device: the user's own speech.
    #[default]
    Microphone,
    /// Everything the computer plays, without Tyco's own sounds where the
    /// platform can leave them out.
    SystemMix,
    /// Every stream one application plays.
    #[serde(rename_all = "camelCase")]
    Application { app_id: AudioAppId },
}

impl CaptureSource {
    /// Whether the source records what the computer plays: such a source is
    /// silent, without callbacks, while nothing plays, see `silence_gap`.
    pub fn is_playback(&self) -> bool {
        !matches!(self, Self::Microphone)
    }
}

/// The identity of an application that stays the same between runs, so that
/// it can be kept in the settings: the binary name, see `dev_docs`.
pub type AudioAppId = String;

/// An application that plays sound right now.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct AudioApp {
    pub id: AudioAppId,
    pub label: String,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_name: Option<String>,
    /// The loudest of its streams, from 0 to 1.
    pub level: f32,
}

/// An input device (microphone) available on this machine.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct AudioInputDevice {
    pub id: String,
    pub label: String,
    pub is_default: bool,
}

/// What a playback source reports about itself while it records.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SourceStatus {
    /// The application of the source plays nothing yet: its streams are
    /// waited for.
    pub is_waiting: bool,
    /// The application of the source has quit: the capture falls back to the
    /// whole system sound.
    pub is_lost: bool,
}

/// How far behind real time a playback source may fall before silence
/// stands in for its samples.
const GAP_TOLERANCE_MS: u64 = 300;
/// What stays unfilled of a gap: samples a stream delivers late still fit.
const GAP_SLACK_MS: u64 = 100;

/// The samples of silence that keep a playback source in step with real time.
///
/// A sink monitor or an application stream delivers nothing while nothing
/// plays. A speech provider closes an idle connection and stamps the words by
/// the audio received, so the gap is filled with silence once it is clearly
/// one and not a late buffer.
pub fn silence_gap(expected_samples: u64, delivered_samples: u64, sample_rate_hz: u32) -> usize {
    let tolerance = u64::from(sample_rate_hz) * GAP_TOLERANCE_MS / 1_000;
    let slack = u64::from(sample_rate_hz) * GAP_SLACK_MS / 1_000;
    let behind = expected_samples.saturating_sub(delivered_samples);
    if behind <= tolerance {
        return 0;
    }
    usize::try_from(behind - slack).unwrap_or(usize::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sources_keep_their_wire_names() {
        assert_eq!(
            serde_json::to_value(CaptureSource::SystemMix).unwrap(),
            serde_json::json!({"kind": "systemMix"})
        );
        assert_eq!(
            serde_json::to_value(CaptureSource::Application {
                app_id: "telegram-desktop".into()
            })
            .unwrap(),
            serde_json::json!({"kind": "application", "appId": "telegram-desktop"})
        );
        let parsed: CaptureSource = serde_json::from_value(serde_json::json!({
            "kind": "microphone"
        }))
        .unwrap();
        assert_eq!(parsed, CaptureSource::Microphone);
    }

    #[test]
    fn only_the_microphone_delivers_callbacks_in_silence() {
        assert!(!CaptureSource::Microphone.is_playback());
        assert!(CaptureSource::SystemMix.is_playback());
    }

    #[test]
    fn a_late_buffer_is_not_a_gap() {
        assert_eq!(silence_gap(16_000, 12_000, 16_000), 0);
        assert_eq!(silence_gap(16_000, 16_000, 16_000), 0);
        assert_eq!(silence_gap(16_000, 20_000, 16_000), 0);
    }

    #[test]
    fn a_gap_is_filled_up_to_the_slack() {
        // a second behind: all but the 100 ms of slack become silence
        assert_eq!(silence_gap(32_000, 16_000, 16_000), 16_000 - 1_600);
    }
}
