//! Tracks voice hotkey gestures without treating keyboard repeat as a press.
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::errors::AppError;
use crate::locks::MutexExt;
use crate::services::activation::ActivationMode;
use crate::state::AppState;
use tauri::{AppHandle, Manager};

use super::HotkeyTarget;

/// Keyboard repeat presses again well within this (the longest repeat delay
/// Windows offers is 1 s); a press after a longer silence is a new one, and
/// the release of the old one was lost.
const STALE_PRESS_GAP: Duration = Duration::from_millis(1_500);
/// An activation that has not completed by then never will (it failed before
/// reporting back): the hotkey must not stay dead until a restart.
const ACTIVATION_TIMEOUT: Duration = Duration::from_secs(30);

struct Press {
    started: Instant,
    /// The last press event of this hold, keyboard repeat included
    last_pressed: Instant,
    activation_id: Option<u64>,
    is_ready: bool,
    released_at: Option<Instant>,
    /// Whether the release of this press ends the recording (Push-to-Talk),
    /// fixed at the press so a settings change mid-hold does not split it
    is_hold_enabled: bool,
}

#[derive(Default)]
pub(crate) struct VoiceGesture(Mutex<HashMap<String, Press>>);

impl VoiceGesture {
    fn press(&self, id: &str, now: Instant, is_hold_enabled: bool) -> bool {
        let mut presses = self.0.locked();
        if let Some(press) = presses.get_mut(id) {
            // an activation still in progress is not replaced, unless it is lost
            let is_stale = if press.is_ready {
                now.saturating_duration_since(press.last_pressed) >= STALE_PRESS_GAP
            } else {
                now.saturating_duration_since(press.started) >= ACTIVATION_TIMEOUT
            };
            if !is_stale {
                press.last_pressed = now;
                return false;
            }
            log::debug!("Voice hotkey {id} was released without a release event");
        }
        presses.insert(
            id.to_owned(),
            Press {
                started: now,
                last_pressed: now,
                activation_id: None,
                is_ready: false,
                released_at: None,
                is_hold_enabled,
            },
        );
        true
    }

    fn complete(&self, id: &str, activation_id: Option<u64>) -> Option<u64> {
        let mut presses = self.0.locked();
        let press = presses.get_mut(id)?;
        press.activation_id = activation_id;
        press.is_ready = true;
        if press.released_at.is_some() {
            let press = presses.remove(id)?;
            if press.is_hold_enabled {
                press.activation_id
            } else {
                None
            }
        } else {
            None
        }
    }

    fn release(&self, id: &str, now: Instant) -> Option<u64> {
        let mut presses = self.0.locked();
        let press = presses.get_mut(id)?;
        if !press.is_ready {
            press.released_at = Some(now);
            return None;
        }
        let press = presses.remove(id)?;
        if press.is_hold_enabled {
            press.activation_id
        } else {
            None
        }
    }
}

/// Whether the release of the hotkey of `mode` ends its recording: voice
/// questions to the AI have no Push-to-Talk.
fn is_hold_enabled(app: &AppHandle, mode: ActivationMode) -> bool {
    let config = app.state::<AppState>().user_config();
    match mode {
        ActivationMode::Voice => crate::models::user_config::is_voice_input_hold_enabled(&config),
        ActivationMode::VoiceCommands => {
            crate::models::user_config::is_voice_commands_hold_enabled(&config)
        }
        _ => false,
    }
}

pub(crate) fn pressed(app: &AppHandle, target: &HotkeyTarget, id: &str) -> Result<(), AppError> {
    let HotkeyTarget::Mode(
        mode @ (ActivationMode::Voice
        | ActivationMode::VoiceCommands
        | ActivationMode::VoiceQuickAiRequest
        | ActivationMode::VoiceScreenshotQuickAiRequest),
    ) = target
    else {
        return target.trigger(app, id);
    };
    let gesture = app.state::<VoiceGesture>();
    if !gesture.press(id, Instant::now(), is_hold_enabled(app, *mode)) {
        return Ok(());
    }
    let result = target.trigger(app, id);
    let after = app.state::<AppState>().snapshot();
    // a press on an open voice input confirms it, or starts a new recording
    // from its result step: the release ends only a recording, so the window
    // decides which of the two this hold was
    let activation_id =
        (result.is_ok() && after.window.is_window_shown && after.activation.mode == Some(*mode))
            .then_some(after.activation.activation_id);
    if let Some(activation_id) = gesture.complete(id, activation_id) {
        finish(app, activation_id);
    }
    result
}

pub(crate) fn released(app: &AppHandle, id: &str) {
    crate::services::selection_replace::hotkey_released(id);
    let Some(activation_id) = app.state::<VoiceGesture>().release(id, Instant::now()) else {
        return;
    };
    finish(app, activation_id);
}

fn finish(app: &AppHandle, activation_id: u64) {
    let snapshot = app.state::<AppState>().snapshot();
    if snapshot.activation.activation_id == activation_id && snapshot.window.is_window_shown {
        if let Err(error) = crate::events::emit_to::<crate::events::VoiceRelease, _>(
            app,
            crate::services::runtime::QUICK_WINDOW_LABEL,
            activation_id,
        ) {
            log::error!("Could not finish held voice hotkey: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toggle_mode_ignores_release_and_leaves_recording_open() {
        let gesture = VoiceGesture::default();
        let now = Instant::now();
        assert!(gesture.press("voice", now, false));
        assert_eq!(gesture.complete("voice", Some(7)), None);
        assert_eq!(
            gesture.release("voice", now + Duration::from_millis(600)),
            None
        );
        // Once released, a subsequent press starts afresh to toggle finish or reopen
        assert!(gesture.press("voice", now + Duration::from_secs(2), false));
    }

    #[test]
    fn hold_mode_finishes_on_release() {
        let gesture = VoiceGesture::default();
        let now = Instant::now();
        assert!(gesture.press("voice", now, true));
        assert_eq!(gesture.complete("voice", Some(8)), None);
        assert_eq!(gesture.release("other", now), None);
        assert_eq!(
            gesture.release("voice", now + Duration::from_millis(200)),
            Some(8)
        );
        assert_eq!(
            gesture.release("voice", now + Duration::from_millis(200)),
            None
        );
    }

    #[test]
    fn release_during_activation_in_hold_mode_finishes_when_completed() {
        let gesture = VoiceGesture::default();
        let now = Instant::now();
        assert!(gesture.press("voice", now, true));
        assert_eq!(
            gesture.release("voice", now + Duration::from_millis(100)),
            None
        );
        assert_eq!(gesture.complete("voice", Some(9)), Some(9));
        assert_eq!(
            gesture.release("voice", now + Duration::from_millis(200)),
            None
        );
    }

    #[test]
    fn release_during_activation_in_toggle_mode_does_not_finish() {
        let gesture = VoiceGesture::default();
        let now = Instant::now();
        assert!(gesture.press("voice", now, false));
        assert_eq!(
            gesture.release("voice", now + Duration::from_millis(50)),
            None
        );
        assert_eq!(gesture.complete("voice", Some(9)), None);
        assert!(gesture.press("voice", now + Duration::from_secs(1), false));
    }

    #[test]
    fn keyboard_repeat_during_a_long_hold_is_not_a_new_press() {
        let gesture = VoiceGesture::default();
        let now = Instant::now();
        assert!(gesture.press("voice", now, true));
        assert_eq!(gesture.complete("voice", Some(7)), None);
        // repeats keep the hold alive far past the stale gap
        for step in 1..=10 {
            assert!(!gesture.press("voice", now + STALE_PRESS_GAP / 2 * step, true));
        }
        assert_eq!(gesture.release("voice", now + STALE_PRESS_GAP * 5), Some(7));
    }

    #[test]
    fn a_lost_release_does_not_disable_the_hotkey() {
        let gesture = VoiceGesture::default();
        let now = Instant::now();
        assert!(gesture.press("voice", now, true));
        assert_eq!(gesture.complete("voice", Some(7)), None);
        // no release arrives; the next press after a pause starts afresh
        assert!(gesture.press("voice", now + STALE_PRESS_GAP, true));
        assert_eq!(gesture.complete("voice", Some(8)), None);
        assert_eq!(
            gesture.release("voice", now + STALE_PRESS_GAP + Duration::from_millis(100)),
            Some(8)
        );
    }

    #[test]
    fn a_slow_activation_is_never_replaced() {
        let gesture = VoiceGesture::default();
        let now = Instant::now();
        assert!(gesture.press("voice", now, true));
        assert!(!gesture.press("voice", now + STALE_PRESS_GAP * 2, true));
    }

    #[test]
    fn a_lost_activation_does_not_disable_the_hotkey() {
        let gesture = VoiceGesture::default();
        let now = Instant::now();
        assert!(gesture.press("voice", now, true));
        // `complete` never comes
        assert!(gesture.press("voice", now + ACTIVATION_TIMEOUT, true));
    }

    #[test]
    fn a_press_that_only_confirms_never_finishes_again_on_release() {
        let gesture = VoiceGesture::default();
        let now = Instant::now();
        assert!(gesture.press("voice", now, true));
        assert_eq!(gesture.complete("voice", None), None);
        assert_eq!(
            gesture.release("voice", now + Duration::from_millis(100)),
            None
        );
        assert!(gesture.press("voice", now + Duration::from_secs(1), true));
    }
}
