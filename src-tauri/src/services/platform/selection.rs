//! System clipboard and focused-window adapters for selection replacement.
#[cfg(any(target_os = "linux", target_os = "windows"))]
use std::thread;
#[cfg(any(target_os = "linux", target_os = "windows"))]
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::errors::AppError;
#[cfg(any(target_os = "linux", target_os = "windows", test))]
use crate::services::selection_replace::SelectionTarget;
use crate::services::selection_replace::{
    SelectionFinishStatus, SelectionRun, SelectionRunError, SelectionRunErrorCode,
};

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
pub(crate) fn is_terminal_class(class: &str) -> bool {
    let class = class.to_ascii_lowercase();
    let name = class.rsplit('.').next().unwrap_or_default();
    TERMINALS.contains(&name) || class.contains("terminal")
}

/// The window that has the keyboard focus now. The tracker knows its class,
/// which tells a terminal; without it X11 can still tell the window.
#[cfg(target_os = "linux")]
fn active_target() -> Option<SelectionTarget> {
    use super::{session, window_tracker::tracker};

    if tracker().is_running() {
        return tracker().active_window().map(|window| SelectionTarget {
            terminal: is_terminal_class(&window.class),
            id: window.id,
        });
    }
    if !session::current().is_x11() {
        return None;
    }
    let output = super::linux::command::output_with_timeout(
        "xdotool",
        &["getactivewindow"],
        Duration::from_secs(2),
    )?;
    let id = String::from_utf8(output).ok()?.trim().to_owned();
    (!id.is_empty()).then_some(SelectionTarget {
        id,
        terminal: false,
    })
}

#[cfg(target_os = "linux")]
pub(crate) fn capture(user_config: &Value) -> Result<(String, SelectionRun), SelectionRunError> {
    use super::linux::clipboard_restore;
    use super::linux::text_injector::SystemTextInjector;

    let target = active_target().ok_or_else(|| {
        let message = if super::session::current().is_kde_wayland()
            && !super::window_tracker::tracker().is_running()
        {
            "The KWin window tracker is not running; KDE Plasma 6 is required"
        } else {
            "No application window has the focus"
        };
        SelectionRunError::new(SelectionRunErrorCode::NoTarget, message)
    })?;
    let injector = SystemTextInjector::detect();
    // the copy keys overwrite the clipboard, which gets its content back
    // once the result is pasted
    let snapshot = clipboard_restore::snapshot();
    let mut run = SelectionRun {
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
            Err(SelectionRunError::new(
                SelectionRunErrorCode::NoSelection,
                "Nothing is selected in the focused window",
            ))
        }
        Err(error) => {
            restore_clipboard(run);
            Err(SelectionRunError::new(
                SelectionRunErrorCode::Capture,
                error.to_string(),
            ))
        }
    }
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
pub(crate) fn capture(_user_config: &Value) -> Result<(String, SelectionRun), SelectionRunError> {
    Err(SelectionRunError::new(
        SelectionRunErrorCode::Unsupported,
        "Replacing the selection is only available on Linux and Windows",
    ))
}

#[cfg(target_os = "windows")]
pub(crate) fn capture(_user_config: &Value) -> Result<(String, SelectionRun), SelectionRunError> {
    use super::{windows, windows_clipboard};
    let id = windows::focused_source().ok_or_else(|| {
        SelectionRunError::new(SelectionRunErrorCode::NoTarget, "No foreground window")
    })?;
    // without a snapshot the selection is still replaced; the clipboard
    // keeps the result instead of getting its old content back
    let snapshot = windows_clipboard::snapshot()
        .inspect_err(|error| log::warn!("The clipboard will not be restored: {error}"))
        .ok();
    let run = SelectionRun {
        id: 0,
        external: false,
        captured_text: None,
        target: SelectionTarget {
            id,
            terminal: windows::foreground_is_terminal(),
        },
        started: Instant::now(),
        snapshot,
    };
    let probe = format!("tyco-selection-probe-{}", std::process::id());
    let result = (|| {
        windows_clipboard::write_text(&probe).map_err(|error| {
            SelectionRunError::new(SelectionRunErrorCode::Capture, error.to_string())
        })?;
        if windows::focused_source().as_deref() != Some(run.target.id.as_str()) {
            return Err(SelectionRunError::new(
                SelectionRunErrorCode::NoTarget,
                "Focus changed before capture",
            ));
        }
        windows::press_copy_or_paste(true, run.target.terminal).map_err(|error| {
            SelectionRunError::new(SelectionRunErrorCode::Capture, error.to_string())
        })?;
        let deadline = Instant::now() + Duration::from_millis(700);
        loop {
            if let Some(text) = windows_clipboard::read_text() {
                if text != probe && !text.trim().is_empty() {
                    return Ok(text);
                }
            }
            if Instant::now() >= deadline {
                return Err(SelectionRunError::new(
                    SelectionRunErrorCode::NoSelection,
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
pub(crate) fn restore_clipboard(run: SelectionRun) {
    if run
        .captured_text
        .as_ref()
        .is_some_and(|text| super::windows_clipboard::read_text().as_ref() != Some(text))
    {
        return;
    }
    match run.snapshot {
        Some(snapshot) => {
            if let Err(error) = super::windows_clipboard::restore(&snapshot) {
                log::warn!("Could not restore the clipboard: {error}");
            }
        }
        // only the probe is taken away: a copied selection is what the user
        // had selected anyway
        None => {
            if super::windows_clipboard::read_text()
                .is_some_and(|text| text.starts_with("tyco-selection-probe-"))
            {
                if let Err(error) = super::windows_clipboard::clear() {
                    log::warn!("Could not clear the clipboard: {error}");
                }
            }
        }
    }
}

/// Presses the copy keys and waits for the clipboard to change. A probe
/// text put there first tells a copied selection from an unchanged clipboard,
/// so `None` means nothing was selected.
#[cfg(target_os = "linux")]
fn copy_selection(
    injector: &super::linux::text_injector::SystemTextInjector,
    user_config: &Value,
    target: &SelectionTarget,
) -> Result<Option<String>, AppError> {
    use super::linux::text_injector::FocusedKeys;

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
        let read = super::linux::clipboard_restore::read_text();
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
pub(crate) fn restore_clipboard(run: SelectionRun) {
    use super::linux::clipboard_restore;
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
pub(crate) fn restore_clipboard(_run: SelectionRun) {}

#[cfg(any(target_os = "linux", target_os = "windows", test))]
trait PasteDestination {
    fn write_text(&self, text: &str) -> Result<(), AppError>;
    fn active_target_id(&self) -> Option<String>;
    fn paste_keys(&self, config: &Value, target: &SelectionTarget) -> Result<(), AppError>;
    fn restore_later(&self, run: SelectionRun, text: String);
}

#[cfg(any(target_os = "linux", target_os = "windows", test))]
fn paste_with(
    destination: &impl PasteDestination,
    config: &Value,
    run: SelectionRun,
    text: String,
) -> Result<SelectionFinishStatus, AppError> {
    destination.write_text(&text)?;
    if destination.active_target_id().as_deref() != Some(run.target.id.as_str()) {
        return Ok(SelectionFinishStatus::Clipboard);
    }
    destination.paste_keys(config, &run.target)?;
    destination.restore_later(run, text);
    Ok(SelectionFinishStatus::Pasted)
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
struct SystemPasteDestination;

#[cfg(target_os = "linux")]
impl PasteDestination for SystemPasteDestination {
    fn write_text(&self, text: &str) -> Result<(), AppError> {
        crate::services::clipboard::copy_to_clipboard(text)
    }
    fn active_target_id(&self) -> Option<String> {
        active_target().map(|target| target.id)
    }
    fn paste_keys(&self, config: &Value, target: &SelectionTarget) -> Result<(), AppError> {
        use super::linux::text_injector::{FocusedKeys, SystemTextInjector};
        SystemTextInjector::detect()
            .press_in_focused(config, FocusedKeys::Paste, target.terminal)
            .map_err(|error| AppError::Message(format!("{error}. The result is in the clipboard")))
    }
    fn restore_later(&self, run: SelectionRun, text: String) {
        if let Some(snapshot) = run.snapshot {
            super::linux::clipboard_restore::restore_later(snapshot, text);
        }
    }
}

#[cfg(target_os = "windows")]
impl PasteDestination for SystemPasteDestination {
    fn write_text(&self, text: &str) -> Result<(), AppError> {
        super::windows_clipboard::write_text(text)
    }
    fn active_target_id(&self) -> Option<String> {
        super::windows::focused_source()
    }
    fn paste_keys(&self, _config: &Value, target: &SelectionTarget) -> Result<(), AppError> {
        super::windows::press_copy_or_paste(false, target.terminal)
    }
    fn restore_later(&self, run: SelectionRun, _text: String) {
        if let Some(snapshot) = run.snapshot {
            super::windows_clipboard::restore_later(snapshot);
        }
    }
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
pub(crate) fn paste_result(
    config: &Value,
    run: SelectionRun,
    text: String,
) -> Result<SelectionFinishStatus, AppError> {
    paste_with(&SystemPasteDestination, config, run, text)
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
pub(crate) fn paste_result(
    _config: &Value,
    _run: SelectionRun,
    _text: String,
) -> Result<SelectionFinishStatus, AppError> {
    Err(AppError::Message(
        "Replacing the selection is only available on Linux and Windows".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct Destination {
        target: Option<String>,
        write_fails: bool,
        paste_fails: bool,
        calls: RefCell<Vec<&'static str>>,
    }

    impl PasteDestination for Destination {
        fn write_text(&self, text: &str) -> Result<(), AppError> {
            assert_eq!(text, "result");
            self.calls.borrow_mut().push("write");
            if self.write_fails {
                Err(AppError::Message("write failed".into()))
            } else {
                Ok(())
            }
        }
        fn active_target_id(&self) -> Option<String> {
            self.calls.borrow_mut().push("focus");
            self.target.clone()
        }
        fn paste_keys(&self, _config: &Value, target: &SelectionTarget) -> Result<(), AppError> {
            assert!(target.terminal);
            self.calls.borrow_mut().push("paste");
            if self.paste_fails {
                Err(AppError::Message("paste failed".into()))
            } else {
                Ok(())
            }
        }
        fn restore_later(&self, _run: SelectionRun, _text: String) {
            self.calls.borrow_mut().push("restore");
        }
    }

    fn run() -> SelectionRun {
        SelectionRun {
            id: 1,
            external: false,
            captured_text: Some("selected".into()),
            target: SelectionTarget {
                id: "target".into(),
                terminal: true,
            },
            started: std::time::Instant::now(),
            #[cfg(any(target_os = "linux", target_os = "windows"))]
            snapshot: None,
        }
    }

    fn destination(target: Option<&str>) -> Destination {
        Destination {
            target: target.map(str::to_owned),
            write_fails: false,
            paste_fails: false,
            calls: RefCell::new(Vec::new()),
        }
    }

    #[test]
    fn changed_or_missing_focus_keeps_the_result_in_clipboard_without_pasting() {
        for target in [None, Some("other")] {
            let destination = destination(target);
            assert_eq!(
                paste_with(&destination, &Value::Null, run(), "result".into()).unwrap(),
                SelectionFinishStatus::Clipboard
            );
            assert_eq!(*destination.calls.borrow(), ["write", "focus"]);
        }
    }

    #[test]
    fn successful_paste_schedules_restoration_after_pressing_the_keys() {
        let destination = destination(Some("target"));
        assert_eq!(
            paste_with(&destination, &Value::Null, run(), "result".into()).unwrap(),
            SelectionFinishStatus::Pasted
        );
        assert_eq!(
            *destination.calls.borrow(),
            ["write", "focus", "paste", "restore"]
        );
    }

    #[test]
    fn clipboard_and_key_errors_do_not_schedule_restoration() {
        for write_fails in [false, true] {
            let destination = Destination {
                write_fails,
                paste_fails: true,
                ..destination(Some("target"))
            };
            assert!(paste_with(&destination, &Value::Null, run(), "result".into()).is_err());
            let expected = if write_fails {
                vec!["write"]
            } else {
                vec!["write", "focus", "paste"]
            };
            assert_eq!(*destination.calls.borrow(), expected);
        }
    }
}
