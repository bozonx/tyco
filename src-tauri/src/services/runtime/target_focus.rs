use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

use super::{emit_state, RuntimeWindows, MAIN_WINDOW_LABEL};
use crate::errors::AppError;
use crate::state::AppState;

/// How often the wait checks whether the target lost the focus.
const FOCUS_POLL_INTERVAL: Duration = Duration::from_millis(10);

/// Waits until no Tyco window has keyboard focus. Once the compositor takes
/// it away, it has handed it to another window, so input can follow. Gives up
/// silently after `timeout`: the caller still waits for its target window.
pub fn wait_until_unfocused(app: &AppHandle, timeout: Duration) {
    wait_until_unfocused_with(
        timeout,
        || has_focused_window(app),
        Instant::now,
        thread::sleep,
    );
}

fn wait_until_unfocused_with(
    timeout: Duration,
    focused: impl Fn() -> bool,
    now: impl Fn() -> Instant,
    pause: impl Fn(Duration),
) {
    let deadline = now() + timeout;
    while focused() && now() < deadline {
        pause(FOCUS_POLL_INTERVAL);
    }
}

pub(super) fn has_focused_window(app: &AppHandle) -> bool {
    let tracker = crate::services::platform::window_tracker::tracker();
    if tracker.is_running() {
        return tracker.is_own_window_active();
    }
    app.webview_windows()
        .values()
        .any(|window| window.is_focused().unwrap_or(false))
}

/// The target window was closed: nothing can be inserted into it any more.
pub fn forget_target_window(app: &AppHandle, window_id: &str) -> Result<(), AppError> {
    let state = app.state::<AppState>();
    if state.snapshot().activation.target_window_id.as_deref() != Some(window_id) {
        return Ok(());
    }
    state.update_snapshot(|snapshot| {
        if snapshot.activation.target_window_id.as_deref() == Some(window_id) {
            snapshot.activation.target_window_id = None;
        }
    });
    emit_state(app, &state)
}

/// While the main window is shown, text goes to the application window the
/// user worked in last rather than the one Tyco was opened from: the main
/// window stays open while the user switches between applications. Only a
/// known window replaces the target; focusing the desktop or a panel keeps it.
pub fn follow_target_window(app: &AppHandle) -> Result<(), AppError> {
    let Some(target) = crate::services::platform::window_tracker::tracker().target() else {
        return Ok(());
    };
    let active_label = app.state::<RuntimeWindows>().active_label();
    let state = app.state::<AppState>();
    let mut changed = false;
    state.update_snapshot(|snapshot| {
        if is_main_window_shown(active_label, snapshot.window.is_window_shown)
            && snapshot.activation.target_window_id.as_ref() != Some(&target)
        {
            snapshot.activation.target_window_id = Some(target);
            changed = true;
        }
    });
    if changed {
        emit_state(app, &state)?;
    }
    Ok(())
}

fn is_main_window_shown(active_label: &str, is_window_shown: bool) -> bool {
    active_label == MAIN_WINDOW_LABEL && is_window_shown
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use super::*;
    use crate::services::runtime::QUICK_WINDOW_LABEL;

    #[test]
    fn focus_wait_stops_when_focus_is_released_or_the_deadline_is_reached() {
        for release_after in [Some(2), None] {
            let elapsed = Cell::new(Duration::ZERO);
            let polls = Cell::new(0);
            let start = Instant::now();
            wait_until_unfocused_with(
                Duration::from_millis(30),
                || release_after.is_none_or(|limit| polls.get() < limit),
                || start + elapsed.get(),
                |duration| {
                    elapsed.set(elapsed.get() + duration);
                    polls.set(polls.get() + 1);
                },
            );
            assert_eq!(polls.get(), release_after.unwrap_or(3));
        }
        wait_until_unfocused_with(
            Duration::from_secs(1),
            || false,
            Instant::now,
            |_| panic!("unfocused window must not wait"),
        );
        wait_until_unfocused_with(
            Duration::ZERO,
            || true,
            Instant::now,
            |_| panic!("expired deadline must not wait"),
        );
    }

    #[test]
    fn follows_the_target_only_while_the_main_window_is_shown() {
        assert!(is_main_window_shown(MAIN_WINDOW_LABEL, true));
        assert!(!is_main_window_shown(MAIN_WINDOW_LABEL, false));
        assert!(!is_main_window_shown(QUICK_WINDOW_LABEL, true));
    }
}
