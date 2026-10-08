//! Replaces the selection in the focused window with what an action makes of
//! it: a correction, a translation or an AI task. No Tyco window is shown, so
//! the focus and the selection stay where they are. The text is copied out
//! with the copy keys, transformed by the webview of the quick window, and
//! pasted back over the selection, which the paste replaces.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Condvar, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tyco_activation_protocol::is_selection_action;

use crate::errors::AppError;
use crate::state::AppState;

pub const SELECTION_RUN_EVENT: &str = "app://selection-run";
pub const SELECTION_CANCEL_EVENT: &str = "app://selection-cancel";

/// The portal reports the press of a hotkey; its keys are still down then.
const HOTKEY_RELEASE_TIMEOUT: Duration = Duration::from_millis(600);
/// A tray menu has to close and give the focus back first.
pub const TRAY_MENU_DELAY: Duration = Duration::from_millis(300);
/// A run the webview never finished, e.g. because it was reloaded, must not
/// turn every later hotkey press into a cancellation.
const ABANDONED_RUN_AGE: Duration = Duration::from_secs(180);

/// When a trigger may start capturing the selection.
pub enum TriggerWait {
    Now,
    Delay(Duration),
    /// Once the keys of this hotkey press are released.
    HotkeyRelease(HotkeyPress),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RunErrorCode {
    /// No application window has the focus.
    NoTarget,
    /// Nothing is selected, or the selection is not text.
    NoSelection,
    /// The keys could not be pressed or the clipboard could not be used.
    Capture,
    #[cfg_attr(any(target_os = "linux", target_os = "windows"), allow(dead_code))]
    Unsupported,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunError {
    code: RunErrorCode,
    message: String,
}

impl RunError {
    fn new(code: RunErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

/// Sent to the webview: the text to transform, or why there is none.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunEvent {
    run_id: u64,
    action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<RunError>,
    /// The quick window does not receive config changes made elsewhere.
    user_config: Value,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FinishStatus {
    /// The result replaced the selection.
    Pasted,
    /// The focus moved to another window meanwhile; the result waits in the
    /// clipboard instead of going into the wrong place.
    Clipboard,
    /// No result to insert; the clipboard got its old content back.
    Restored,
    /// The run was cancelled or replaced meanwhile.
    Stale,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Target {
    id: String,
    terminal: bool,
}

struct Run {
    id: u64,
    external: bool,
    captured_text: Option<String>,
    target: Target,
    started: Instant,
    #[cfg(target_os = "linux")]
    snapshot: Option<super::platform::linux::clipboard_restore::ClipboardSnapshot>,
    #[cfg(target_os = "windows")]
    snapshot: Option<super::platform::windows_clipboard::Snapshot>,
}

#[derive(Default)]
pub struct SelectionRuns {
    next_id: AtomicU64,
    capturing: AtomicBool,
    current: Mutex<Option<Run>>,
}

impl SelectionRuns {
    fn lock(&self) -> std::sync::MutexGuard<'_, Option<Run>> {
        self.current.lock().expect("selection run lock poisoned")
    }

    /// Takes the run in progress, unless it was abandoned.
    fn take_active(&self) -> Option<Run> {
        let run = self.lock().take()?;
        if run.started.elapsed() < ABANDONED_RUN_AGE {
            Some(run)
        } else {
            log::warn!(
                "Dropping selection run {} the webview never finished",
                run.id
            );
            None
        }
    }

    fn take_if(&self, id: u64) -> Option<Run> {
        let mut current = self.lock();
        if current.as_ref().is_some_and(|run| run.id == id) {
            current.take()
        } else {
            None
        }
    }
}

/// Starts `action` on the selection of the focused window. A second trigger
/// while a run is in progress cancels it instead.
pub fn trigger(app: &AppHandle, action: &str, wait: TriggerWait) -> Result<(), AppError> {
    if !is_selection_action(action) {
        return Err(AppError::Message(format!(
            "Unknown selection action: {action}"
        )));
    }
    let runs = app.state::<SelectionRuns>();
    // Reserve capture before inspecting active runs so a concurrent external
    // capture cannot be mistaken for a hotkey run to cancel.
    if runs.capturing.swap(true, Ordering::SeqCst) {
        log::debug!("Ignoring the {action} trigger: a selection is being captured");
        return Ok(());
    }
    let capturing = CapturingGuard(app.clone());
    if runs.lock().as_ref().is_some_and(|run| run.external) {
        return Err(AppError::Message(
            "An external selection job is running".into(),
        ));
    }
    if let Some(run) = runs.take_active() {
        cancel(app, run);
        return Ok(());
    }

    let app = app.clone();
    let action = action.to_owned();
    thread::spawn(move || {
        // released however the capture ends, a panic included, so that a
        // failed capture never disables the selection hotkeys for good
        match wait {
            TriggerWait::Now => {}
            TriggerWait::Delay(delay) => thread::sleep(delay),
            TriggerWait::HotkeyRelease(press) => press.wait(HOTKEY_RELEASE_TIMEOUT),
        }
        let runs = app.state::<SelectionRuns>();
        let run_id = runs.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        let user_config = app.state::<AppState>().params().user_config;
        let event = match capture(&user_config) {
            Ok((text, run)) => {
                runs.lock().replace(Run {
                    id: run_id,
                    captured_text: Some(text.clone()),
                    ..run
                });
                RunEvent {
                    run_id,
                    action,
                    text: Some(text),
                    error: None,
                    user_config,
                }
            }
            Err(error) => {
                log::warn!("Could not capture the selection: {}", error.message);
                RunEvent {
                    run_id,
                    action,
                    text: None,
                    error: Some(error),
                    user_config,
                }
            }
        };
        drop(capturing);
        if let Err(error) = emit_to_webview(&app, SELECTION_RUN_EVENT, event) {
            log::error!("Could not hand the selection over to the webview: {error}");
            if let Some(run) = runs.take_if(run_id) {
                restore_clipboard(run);
            }
        }
    });
    Ok(())
}

/// Captures an explicit external selection without toggling an existing run.
pub fn prepare_external(app: &AppHandle) -> Result<(u64, String), AppError> {
    let runs = app.state::<SelectionRuns>();
    if runs.capturing.swap(true, Ordering::SeqCst) {
        return Err(AppError::Message("A selection is being captured".into()));
    }
    let _guard = CapturingGuard(app.clone());
    if runs.lock().is_some() {
        return Err(AppError::Message(
            "A selection run is already active".into(),
        ));
    }
    let (text, mut run) = capture(&app.state::<AppState>().params().user_config)
        .map_err(|error| AppError::Message(error.message))?;
    let id = runs.next_id.fetch_add(1, Ordering::SeqCst) + 1;
    run.id = id;
    run.external = true;
    run.captured_text = Some(text.clone());
    runs.lock().replace(run);
    Ok((id, text))
}

struct CapturingGuard(AppHandle);

impl Drop for CapturingGuard {
    fn drop(&mut self) {
        self.0
            .state::<SelectionRuns>()
            .capturing
            .store(false, Ordering::SeqCst);
    }
}

/// Takes the result of run `run_id`: `None` when there is nothing to insert.
pub fn finish(
    app: &AppHandle,
    run_id: u64,
    text: Option<String>,
) -> Result<FinishStatus, AppError> {
    let Some(run) = app.state::<SelectionRuns>().take_if(run_id) else {
        return Ok(FinishStatus::Stale);
    };
    let Some(text) = text else {
        restore_clipboard(run);
        return Ok(FinishStatus::Restored);
    };
    let user_config = app.state::<AppState>().params().user_config;
    paste_result(&user_config, run, text)
}

fn cancel(app: &AppHandle, run: Run) {
    let run_id = run.id;
    restore_clipboard(run);
    if let Err(error) = emit_to_webview(
        app,
        SELECTION_CANCEL_EVENT,
        serde_json::json!({ "runId": run_id }),
    ) {
        log::warn!("Could not report the cancelled selection run: {error}");
    }
}

fn emit_to_webview(
    app: &AppHandle,
    event: &str,
    payload: impl Serialize + Clone,
) -> Result<(), AppError> {
    let window = app
        .get_webview_window(super::runtime::QUICK_WINDOW_LABEL)
        .ok_or_else(|| AppError::Message(String::from("Quick window not found")))?;
    window
        .emit(event, payload)
        .map_err(|error| AppError::Message(error.to_string()))
}

/// Application ids of terminals, where Ctrl+C interrupts the running
/// program, so copying and pasting take Ctrl+Shift+C and Ctrl+Shift+V.
#[cfg(any(target_os = "linux", test))]
const TERMINALS: [&str; 22] = [
    "konsole",
    "yakuake",
    "alacritty",
    "kitty",
    "foot",
    "footclient",
    "wezterm",
    "wezterm-gui",
    "xterm",
    "urxvt",
    "terminator",
    "tilix",
    "ghostty",
    "ptyxis",
    "kgx",
    "contour",
    "rio",
    "st",
    "terminology",
    "cool-retro-term",
    "qterminal",
    "blackbox",
];

#[cfg(any(target_os = "linux", test))]
fn is_terminal_class(class: &str) -> bool {
    let class = class.to_ascii_lowercase();
    let name = class.rsplit('.').next().unwrap_or_default();
    TERMINALS.contains(&name) || class.contains("terminal")
}

/// The window that has the keyboard focus now. The tracker knows its class,
/// which tells a terminal; without it X11 can still tell the window.
#[cfg(target_os = "linux")]
fn active_target() -> Option<Target> {
    use super::platform::{session, window_tracker::tracker};

    if tracker().is_running() {
        return tracker().active_window().map(|window| Target {
            terminal: is_terminal_class(&window.class),
            id: window.id,
        });
    }
    if !session::current().is_x11() {
        return None;
    }
    let output = std::process::Command::new("xdotool")
        .arg("getactivewindow")
        .output()
        .ok()?;
    let id = String::from_utf8(output.stdout).ok()?.trim().to_owned();
    (output.status.success() && !id.is_empty()).then_some(Target {
        id,
        terminal: false,
    })
}

#[cfg(target_os = "linux")]
fn capture(user_config: &Value) -> Result<(String, Run), RunError> {
    use super::platform::linux::clipboard_restore;
    use super::platform::linux::text_injector::SystemTextInjector;

    let target = active_target().ok_or_else(|| {
        let message = if super::platform::session::current().is_kde_wayland()
            && !super::platform::window_tracker::tracker().is_running()
        {
            "The KWin window tracker is not running; KDE Plasma 6 is required"
        } else {
            "No application window has the focus"
        };
        RunError::new(RunErrorCode::NoTarget, message)
    })?;
    let injector = SystemTextInjector::detect();
    // the copy keys overwrite the clipboard, which gets its content back
    // once the result is pasted
    let snapshot = clipboard_restore::snapshot();
    let mut run = Run {
        id: 0,
        external: false,
        captured_text: None,
        target,
        started: Instant::now(),
        snapshot,
    };

    match copy_selection(&injector, user_config, &run.target) {
        Ok(Some(text)) => {
            run.started = Instant::now();
            Ok((text, run))
        }
        Ok(None) => {
            restore_clipboard(run);
            Err(RunError::new(
                RunErrorCode::NoSelection,
                "Nothing is selected in the focused window",
            ))
        }
        Err(error) => {
            restore_clipboard(run);
            Err(RunError::new(RunErrorCode::Capture, error.to_string()))
        }
    }
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
fn capture(_user_config: &Value) -> Result<(String, Run), RunError> {
    Err(RunError::new(
        RunErrorCode::Unsupported,
        "Replacing the selection is only available on Linux and Windows",
    ))
}

#[cfg(target_os = "windows")]
fn capture(_user_config: &Value) -> Result<(String, Run), RunError> {
    use super::platform::{windows, windows_clipboard};
    let id = windows::capture_source()
        .ok_or_else(|| RunError::new(RunErrorCode::NoTarget, "No foreground window"))?;
    let snapshot = windows_clipboard::snapshot()
        .map_err(|error| RunError::new(RunErrorCode::Capture, error.to_string()))?;
    let run = Run {
        id: 0,
        external: false,
        captured_text: None,
        target: Target {
            id,
            terminal: windows::foreground_is_terminal(),
        },
        started: Instant::now(),
        snapshot: Some(snapshot),
    };
    let probe = format!("tyco-selection-probe-{}", std::process::id());
    let result = (|| {
        windows_clipboard::write_text(&probe)
            .map_err(|error| RunError::new(RunErrorCode::Capture, error.to_string()))?;
        if windows::capture_source().as_deref() != Some(run.target.id.as_str()) {
            return Err(RunError::new(
                RunErrorCode::NoTarget,
                "Focus changed before capture",
            ));
        }
        windows::press_copy_or_paste(true, run.target.terminal)
            .map_err(|error| RunError::new(RunErrorCode::Capture, error.to_string()))?;
        let deadline = Instant::now() + Duration::from_millis(700);
        loop {
            if let Some(text) = windows_clipboard::read_text() {
                if text != probe && !text.trim().is_empty() {
                    return Ok(text);
                }
            }
            if Instant::now() >= deadline {
                return Err(RunError::new(
                    RunErrorCode::NoSelection,
                    "Nothing is selected in the foreground window",
                ));
            }
            thread::sleep(Duration::from_millis(25));
        }
    })();
    match result {
        Ok(text) => Ok((text, run)),
        Err(error) => {
            restore_clipboard(run);
            Err(error)
        }
    }
}

#[cfg(target_os = "windows")]
fn restore_clipboard(run: Run) {
    if run
        .captured_text
        .as_ref()
        .is_some_and(|text| super::platform::windows_clipboard::read_text().as_ref() != Some(text))
    {
        return;
    }
    if let Some(snapshot) = run.snapshot {
        let _ = super::platform::windows_clipboard::restore(&snapshot);
    }
}

#[cfg(target_os = "windows")]
fn paste_result(_user_config: &Value, run: Run, text: String) -> Result<FinishStatus, AppError> {
    use super::platform::{windows, windows_clipboard};
    windows_clipboard::write_text(&text)?;
    if windows::capture_source().as_deref() != Some(run.target.id.as_str()) {
        return Ok(FinishStatus::Clipboard);
    }
    windows::press_copy_or_paste(false, run.target.terminal)?;
    if let Some(snapshot) = run.snapshot {
        windows_clipboard::restore_later(snapshot);
    }
    Ok(FinishStatus::Pasted)
}

/// Presses the copy keys and waits for the clipboard to change. A probe
/// text put there first tells a copied selection from an unchanged clipboard,
/// so `None` means nothing was selected.
#[cfg(target_os = "linux")]
fn copy_selection(
    injector: &super::platform::linux::text_injector::SystemTextInjector,
    user_config: &Value,
    target: &Target,
) -> Result<Option<String>, AppError> {
    use super::platform::linux::text_injector::FocusedKeys;

    const COPY_TIMEOUT: Duration = Duration::from_millis(700);
    const POLL_INTERVAL: Duration = Duration::from_millis(25);

    let probe = format!(
        "tyco-selection-probe-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|time| time.as_nanos())
            .unwrap_or_default()
    );
    crate::services::clipboard::copy_to_clipboard(&probe)?;
    injector.press_in_focused(user_config, FocusedKeys::Copy, target.terminal)?;

    let deadline = Instant::now() + COPY_TIMEOUT;
    loop {
        let read = super::platform::linux::clipboard_restore::read_text();
        match read {
            Some(ref text) if *text == probe => {}
            Some(ref text) if text.trim().is_empty() => return Ok(None),
            Some(text) => return Ok(Some(text)),
            // not text, e.g. an image, or not answered yet
            None => {}
        }
        if Instant::now() >= deadline {
            log::debug!(
                "The copy keys changed nothing in the clipboard: {}",
                match read {
                    Some(_) => "the probe text is still there",
                    None => "it holds no text",
                }
            );
            return Ok(None);
        }
        thread::sleep(POLL_INTERVAL);
    }
}

/// Gives the clipboard its content from before the run back. Without a
/// snapshot only the probe text is removed: a copied selection is what the
/// user had selected anyway.
#[cfg(target_os = "linux")]
fn restore_clipboard(run: Run) {
    use super::platform::linux::clipboard_restore;
    if run
        .captured_text
        .as_ref()
        .is_some_and(|text| clipboard_restore::read_text().as_ref() != Some(text))
    {
        return;
    }

    match run.snapshot {
        Some(snapshot) => clipboard_restore::restore_now(&snapshot),
        None => {
            if clipboard_restore::read_text()
                .is_some_and(|text| text.starts_with("tyco-selection-probe-"))
            {
                clipboard_restore::clear();
            }
        }
    }
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
fn restore_clipboard(_run: Run) {}

#[cfg(target_os = "linux")]
fn paste_result(user_config: &Value, run: Run, text: String) -> Result<FinishStatus, AppError> {
    use super::platform::linux::text_injector::{FocusedKeys, SystemTextInjector};

    crate::services::clipboard::copy_to_clipboard(&text)?;
    if active_target().map(|target| target.id) != Some(run.target.id.clone()) {
        return Ok(FinishStatus::Clipboard);
    }
    SystemTextInjector::detect()
        .press_in_focused(user_config, FocusedKeys::Paste, run.target.terminal)
        .map_err(|error| AppError::Message(format!("{error}. The result is in the clipboard")))?;
    if let Some(snapshot) = run.snapshot {
        super::platform::linux::clipboard_restore::restore_later(snapshot, text);
    }
    Ok(FinishStatus::Pasted)
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
fn paste_result(_user_config: &Value, _run: Run, _text: String) -> Result<FinishStatus, AppError> {
    Err(AppError::Message(String::from(
        "Replacing the selection is only available on Linux and Windows",
    )))
}

#[derive(Default)]
struct HotkeyReleases {
    counts: Mutex<HashMap<String, u64>>,
    changed: Condvar,
}

fn hotkey_releases() -> &'static HotkeyReleases {
    static RELEASES: OnceLock<HotkeyReleases> = OnceLock::new();
    RELEASES.get_or_init(HotkeyReleases::default)
}

/// A press of the hotkey `id`, waiting for its release.
pub struct HotkeyPress {
    id: String,
    seen: u64,
}

impl HotkeyPress {
    pub fn new(id: &str) -> Self {
        let seen = hotkey_releases()
            .counts
            .lock()
            .expect("hotkey release lock poisoned")
            .get(id)
            .copied()
            .unwrap_or_default();
        Self {
            id: id.to_owned(),
            seen,
        }
    }

    /// Returns once the hotkey was released, or after `timeout` for providers
    /// that do not report releases.
    fn wait(&self, timeout: Duration) {
        let releases = hotkey_releases();
        let deadline = Instant::now() + timeout;
        let mut counts = releases
            .counts
            .lock()
            .expect("hotkey release lock poisoned");
        let started = Instant::now();
        while counts.get(&self.id).copied().unwrap_or_default() == self.seen {
            let now = Instant::now();
            if now >= deadline {
                log::debug!("Hotkey {} was not reported released in time", self.id);
                return;
            }
            counts = releases
                .changed
                .wait_timeout(counts, deadline - now)
                .expect("hotkey release lock poisoned")
                .0;
        }
        log::debug!(
            "Hotkey {} was released after {:?}",
            self.id,
            started.elapsed()
        );
    }
}

/// Reported by the hotkey providers when the keys of a hotkey go up.
pub fn hotkey_released(id: &str) {
    let releases = hotkey_releases();
    *releases
        .counts
        .lock()
        .expect("hotkey release lock poisoned")
        .entry(id.to_owned())
        .or_default() += 1;
    releases.changed.notify_all();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(id: u64, age: Duration) -> Run {
        Run {
            id,
            external: false,
            captured_text: None,
            target: Target {
                id: String::from("window"),
                terminal: false,
            },
            started: Instant::now() - age,
            #[cfg(any(target_os = "linux", target_os = "windows"))]
            snapshot: None,
        }
    }

    #[test]
    fn recognizes_terminals_by_application_id() {
        for class in [
            "org.kde.konsole",
            "Alacritty",
            "kitty",
            "org.gnome.Ptyxis",
            "xfce4-terminal",
        ] {
            assert!(is_terminal_class(class), "{class}");
        }
        for class in ["firefox", "org.kde.kate", "telegramdesktop", ""] {
            assert!(!is_terminal_class(class), "{class}");
        }
    }

    #[test]
    fn finishes_only_the_current_run() {
        let runs = SelectionRuns::default();
        runs.lock().replace(run(2, Duration::ZERO));
        assert!(runs.take_if(1).is_none());
        assert_eq!(runs.take_if(2).map(|run| run.id), Some(2));
        assert!(runs.take_if(2).is_none());
    }

    #[test]
    fn an_abandoned_run_is_not_cancelled_but_dropped() {
        let runs = SelectionRuns::default();
        runs.lock().replace(run(1, Duration::ZERO));
        assert_eq!(runs.take_active().map(|run| run.id), Some(1));
        runs.lock()
            .replace(run(2, ABANDONED_RUN_AGE + Duration::from_secs(1)));
        assert!(runs.take_active().is_none());
        assert!(runs.lock().is_none());
    }

    #[test]
    fn waits_for_the_release_of_the_pressed_hotkey() {
        let press = HotkeyPress::new("test.release");
        let handle = thread::spawn(|| {
            thread::sleep(Duration::from_millis(20));
            hotkey_released("test.other");
            hotkey_released("test.release");
        });
        let started = Instant::now();
        press.wait(Duration::from_secs(2));
        assert!(started.elapsed() < Duration::from_secs(2));
        handle.join().unwrap();

        // an earlier release does not count for a new press
        let press = HotkeyPress::new("test.release");
        let started = Instant::now();
        press.wait(Duration::from_millis(30));
        assert!(started.elapsed() >= Duration::from_millis(30));
    }
}
