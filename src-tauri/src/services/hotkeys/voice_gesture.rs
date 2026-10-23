//! Distinguishes a tap from a hold without treating keyboard repeat as a press.
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::errors::AppError;
use crate::locks::MutexExt;
use crate::services::activation::ActivationMode;
use crate::state::AppState;
use tauri::{AppHandle, Manager};

use super::HotkeyTarget;

const HOLD_DURATION: Duration = Duration::from_millis(400);

struct Press {
    started: Instant,
    activation_id: Option<u64>,
    is_ready: bool,
    released_at: Option<Instant>,
}

#[derive(Default)]
pub(crate) struct VoiceGesture(Mutex<HashMap<String, Press>>);

impl VoiceGesture {
    fn press(&self, id: &str, now: Instant) -> bool {
        let mut presses = self.0.locked();
        if presses.contains_key(id) {
            return false;
        }
        presses.insert(
            id.to_owned(),
            Press {
                started: now,
                activation_id: None,
                is_ready: false,
                released_at: None,
            },
        );
        true
    }

    fn complete(&self, id: &str, activation_id: Option<u64>) -> Option<u64> {
        let mut presses = self.0.locked();
        let press = presses.get_mut(id)?;
        press.activation_id = activation_id;
        press.is_ready = true;
        let released_at = press.released_at;
        let now = released_at?;
        let press = presses.remove(id)?;
        (now.duration_since(press.started) >= HOLD_DURATION)
            .then_some(press.activation_id)
            .flatten()
    }

    fn release(&self, id: &str, now: Instant) -> Option<u64> {
        let mut presses = self.0.locked();
        let press = presses.get_mut(id)?;
        if !press.is_ready {
            press.released_at = Some(now);
            return None;
        }
        let press = presses.remove(id)?;
        (now.duration_since(press.started) >= HOLD_DURATION)
            .then_some(press.activation_id)
            .flatten()
    }
}

pub(crate) fn pressed(app: &AppHandle, target: &HotkeyTarget, id: &str) -> Result<(), AppError> {
    let HotkeyTarget::Mode(
        mode @ (ActivationMode::Voice | ActivationMode::VoiceChat | ActivationMode::VoiceCommands),
    ) = target
    else {
        return target.trigger(app, id);
    };
    let gesture = app.state::<VoiceGesture>();
    if !gesture.press(id, Instant::now()) {
        return Ok(());
    }
    let before = app.state::<AppState>().snapshot();
    let result = target.trigger(app, id);
    let after = app.state::<AppState>().snapshot();
    let activation_id = (result.is_ok()
        && !(before.window.is_window_shown && before.activation.mode == Some(*mode))
        && after.activation.mode == Some(*mode))
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
        if let Err(error) = crate::events::emit_to::<crate::events::VoiceFinish, _>(
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
    fn taps_keep_recording_and_holds_finish_once() {
        let gesture = VoiceGesture::default();
        let now = Instant::now();
        assert!(gesture.press("voice", now));
        gesture.complete("voice", Some(7));
        assert!(!gesture.press("voice", now + HOLD_DURATION));
        assert_eq!(
            gesture.release("voice", now + Duration::from_millis(399)),
            None
        );
        assert!(gesture.press("voice", now));
        gesture.complete("voice", Some(8));
        assert_eq!(gesture.release("other", now + HOLD_DURATION), None);
        assert_eq!(gesture.release("voice", now + HOLD_DURATION), Some(8));
        assert_eq!(gesture.release("voice", now + HOLD_DURATION), None);
    }

    #[test]
    fn release_during_activation_is_completed_after_activation() {
        let gesture = VoiceGesture::default();
        let now = Instant::now();
        assert!(gesture.press("voice", now));
        assert_eq!(gesture.release("voice", now + HOLD_DURATION), None);
        assert_eq!(gesture.complete("voice", Some(9)), Some(9));
        assert_eq!(gesture.release("voice", now + HOLD_DURATION), None);
    }

    #[test]
    fn a_tap_during_activation_does_not_finish() {
        let gesture = VoiceGesture::default();
        let now = Instant::now();
        assert!(gesture.press("voice", now));
        assert_eq!(
            gesture.release("voice", now + Duration::from_millis(50)),
            None
        );
        assert_eq!(gesture.complete("voice", Some(9)), None);
        assert!(gesture.press("voice", now + HOLD_DURATION));
    }

    #[test]
    fn a_press_that_only_confirms_never_finishes_again_on_release() {
        let gesture = VoiceGesture::default();
        let now = Instant::now();
        assert!(gesture.press("voice", now));
        gesture.complete("voice", None);
        assert_eq!(gesture.release("voice", now + HOLD_DURATION), None);
        assert!(gesture.press("voice", now + HOLD_DURATION));
    }
}
