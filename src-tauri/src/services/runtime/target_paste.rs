//! Inserting text from a quick window into the window it was opened from.
use std::time::Duration;

use tauri::{AppHandle, Manager};

use super::{hide_window, wait_until_unfocused};
use crate::errors::AppError;
use crate::services::platform::{self, ForegroundTarget, SystemTextInjector, TextInjector};
use crate::state::AppState;

const FOCUS_RELEASE_TIMEOUT: Duration = Duration::from_millis(300);

/// Hides `window_label`, puts `text` into the clipboard and pastes it into
/// the target window of `activation_id`; the clipboard gets its content
/// back afterwards where the platform can preserve it. Waits for the clipboard
/// tools and for the focus, so it must run on the blocking pool.
pub fn paste_into_target(
    app: &AppHandle,
    window_label: String,
    activation_id: u64,
    text: String,
) -> Result<(), AppError> {
    let snapshot = app.state::<AppState>().snapshot();
    if snapshot.activation.activation_id != activation_id {
        return Err(AppError::Stale(
            "The insertion activation is no longer current".into(),
        ));
    }
    let previous_clipboard = platform::clipboard::snapshot();
    hide_window(app, window_label, activation_id)?;
    platform::clipboard::copy_to_clipboard(&text)?;
    if activation_changed(app, activation_id) {
        return Err(AppError::Stale("The insertion activation changed".into()));
    }
    let target = snapshot
        .activation
        .target_window_id
        .map(ForegroundTarget::from_platform_id);
    platform::paste_after_focus(
        &ActivationTextInjector { app, activation_id },
        &snapshot.settings.user_config,
        target.as_ref(),
        || wait_until_unfocused(app, FOCUS_RELEASE_TIMEOUT),
        || {
            if let Some(previous) = previous_clipboard {
                platform::clipboard::restore_later(previous, text);
            }
        },
    )
}

fn activation_changed(app: &AppHandle, activation_id: u64) -> bool {
    app.state::<AppState>().snapshot().activation.activation_id != activation_id
}

/// Injects only while the activation is current: the user may have opened
/// another one while Tyco waited for the focus.
struct ActivationTextInjector<'a> {
    app: &'a AppHandle,
    activation_id: u64,
}

impl TextInjector for ActivationTextInjector<'_> {
    fn inject(
        &self,
        config: &serde_json::Value,
        target: Option<&ForegroundTarget>,
    ) -> Result<(), AppError> {
        if activation_changed(self.app, self.activation_id) {
            return Err(AppError::Stale(
                "The insertion activation changed while waiting for focus".into(),
            ));
        }
        SystemTextInjector.inject(config, target)
    }
}
