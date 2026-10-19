//! Prime the quick window without changing activation state.
use super::{
    is_quick_window_shown, on_main_thread, panel_layer, RuntimeWindows, WindowProfile,
    MAIN_WINDOW_LABEL, QUICK_WINDOW_LABEL, WINDOW_SIZE,
};
use crate::errors::AppError;
use crate::state::AppState;
use std::time::Duration;
use tauri::{AppHandle, Manager};

const WARMUP_ENV: &str = "TYCO_QUICK_WARMUP";
const DEFAULT_WARMUP_CYCLES: u32 = 3;
const WARMUP_DELAY: Duration = Duration::from_millis(400);
const WARMUP_STEP: Duration = Duration::from_millis(250);
/// Number of warmup cycles; `TYCO_QUICK_WARMUP=0` turns the warmup off.
fn warmup_cycles(value: Option<&str>) -> u32 {
    value
        .and_then(|value| value.trim().parse().ok())
        .unwrap_or(DEFAULT_WARMUP_CYCLES)
}

/// The first one or two shows of a window after process start take the slow
/// path: the focus comes late or not at all, and the keys typed meanwhile go to
/// the window below (see dev_docs/quick-input-report.md). The warmup goes
/// through them before the user presses a hotkey. It leaves `AppState` and the
/// webview alone and gives way to a real activation at any step.
pub(super) fn spawn_quick_warmup(app: AppHandle) -> Result<(), AppError> {
    let cycles = warmup_cycles(std::env::var(WARMUP_ENV).ok().as_deref());
    if cycles == 0 {
        return Ok(());
    }
    let services = app.state::<crate::services::background::BackgroundServices>();
    let handle = app.clone();
    services.spawn_thread("quick-window-warmup", move |stop| {
        let app = handle;
        if stop.wait(WARMUP_DELAY) {
            return;
        }
        for _ in 0..cycles {
            let shown = on_main_thread(&app, warmup_show);
            if stop.wait(WARMUP_STEP) {
                return;
            }
            let hidden = on_main_thread(&app, warmup_hide);
            if let Err(error) = shown.and(hidden) {
                log::warn!("Quick window warmup stopped: {error}");
                return;
            }
            if stop.wait(WARMUP_STEP) {
                return;
            }
        }
        log::debug!("Quick window warmup finished after {cycles} cycles");
    })
}

fn quick_window_in_use(app: &AppHandle) -> bool {
    is_quick_window_shown(
        app.state::<RuntimeWindows>().active_label(),
        app.state::<AppState>().snapshot().window.is_window_shown,
    )
}

/// Shows the quick window the way an activation of the write mode does, but
/// transparent and without touching the state.
fn warmup_show(app: &AppHandle) -> Result<(), AppError> {
    if quick_window_in_use(app) {
        return Ok(());
    }
    let window = app
        .get_webview_window(QUICK_WINDOW_LABEL)
        .ok_or_else(|| AppError::Message("Quick window not found".into()))?;
    crate::services::platform::set_window_opacity(&window, 0.0)?;
    let layer = panel_layer(app);
    if layer.is_none() {
        let (width, height) = WINDOW_SIZE;
        window.set_size(tauri::LogicalSize::new(width, height))?;
    }
    crate::services::platform::apply_panel_surface(&window, WindowProfile::Panel, layer)?;
    window.set_focusable(true)?;
    window.show()?;
    if let Err(error) = window.set_focus() {
        log::warn!("Could not focus window during warmup: {error}");
    }
    Ok(())
}

fn warmup_hide(app: &AppHandle) -> Result<(), AppError> {
    // the user called the window in between: it is theirs now
    if quick_window_in_use(app) {
        return Ok(());
    }
    let window = app
        .get_webview_window(QUICK_WINDOW_LABEL)
        .ok_or_else(|| AppError::Message("Quick window not found".into()))?;
    if panel_layer(app).is_some() {
        crate::services::platform::disable_panel_keyboard(&window)?;
    }
    window.hide()?;
    // the main window shown at startup gets back the focus the warmup took
    if app.state::<AppState>().snapshot().window.is_window_shown {
        if let Some(main) = app.get_webview_window(MAIN_WINDOW_LABEL) {
            if let Err(error) = main.set_focus() {
                log::warn!("Could not return focus after warmup: {error}");
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn warmup_runs_three_cycles_unless_configured() {
        assert_eq!(warmup_cycles(None), 3);
        assert_eq!(warmup_cycles(Some("0")), 0);
        assert_eq!(warmup_cycles(Some(" 1 ")), 1);
        assert_eq!(warmup_cycles(Some("many")), 3);
    }
}
