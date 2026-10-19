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
            is_terminal: is_terminal_class(&window.class),
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
        is_terminal: false,
    })
}

/// The text the copy keys overwrite: a clipboard still holding it means
/// nothing was copied.
const SELECTION_PROBE_PREFIX: &str = "tyco-selection-probe-";

#[cfg(target_os = "linux")]
pub(crate) fn capture(user_config: &Value) -> Result<(String, SelectionRun), SelectionRunError> {
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
    let snapshot = super::clipboard::snapshot();
    let mut run = SelectionRun {
        id: 0,
        is_external: false,
        captured_text: None,
        target,
        started_at: Instant::now(),
        clipboard_snapshot: snapshot,
    };

    match copy_selection(&injector, user_config, &run.target) {
        Ok(Some(text)) => {
            run.started_at = Instant::now();
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
    use super::{clipboard, windows};
    let id = windows::focused_foreground_target().ok_or_else(|| {
        SelectionRunError::new(SelectionRunErrorCode::NoTarget, "No foreground window")
    })?;
    // without a snapshot the selection is still replaced; the clipboard
    // keeps the result instead of getting its old content back
    let snapshot = clipboard::snapshot();
    let run = SelectionRun {
        id: 0,
        is_external: false,
        captured_text: None,
        target: SelectionTarget {
            id,
            is_terminal: windows::is_foreground_terminal(),
        },
        started_at: Instant::now(),
        clipboard_snapshot: snapshot,
    };
    let probe = format!("{SELECTION_PROBE_PREFIX}{}", std::process::id());
    let result = (|| {
        windows::clipboard::write_text(&probe).map_err(|error| {
            SelectionRunError::new(SelectionRunErrorCode::Capture, error.to_string())
        })?;
        if windows::focused_foreground_target().as_deref() != Some(run.target.id.as_str()) {
            return Err(SelectionRunError::new(
                SelectionRunErrorCode::NoTarget,
                "Focus changed before capture",
            ));
        }
        windows::press_copy_or_paste(true, run.target.is_terminal).map_err(|error| {
            SelectionRunError::new(SelectionRunErrorCode::Capture, error.to_string())
        })?;
        let deadline = Instant::now() + Duration::from_millis(700);
        loop {
            if let Some(text) = clipboard::read_text() {
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

/// Presses the copy keys and waits for the clipboard to change. A probe
/// text put there first tells a copied selection from an unchanged clipboard,
/// so `None` means nothing was selected.
#[cfg(target_os = "linux")]
fn copy_selection(
    injector: &super::linux::text_injector::SystemTextInjector,
    user_config: &Value,
    target: &SelectionTarget,
) -> Result<Option<String>, AppError> {
    use super::linux::text_injector::FocusedKeyAction;

    const COPY_TIMEOUT: Duration = Duration::from_millis(700);
    const POLL_INTERVAL: Duration = Duration::from_millis(25);

    let probe = format!(
        "{SELECTION_PROBE_PREFIX}{}",
        crate::services::clock::now_ns()
    );
    super::clipboard::copy_to_clipboard(&probe)?;
    injector.press_in_focused(user_config, FocusedKeyAction::Copy, target.is_terminal)?;

    let deadline = Instant::now() + COPY_TIMEOUT;
    loop {
        let read = super::clipboard::read_text();
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
pub(crate) fn restore_clipboard(run: SelectionRun) {
    use super::clipboard;
    if run
        .captured_text
        .as_ref()
        .is_some_and(|text| clipboard::read_text().as_ref() != Some(text))
    {
        return;
    }

    match run.clipboard_snapshot {
        Some(snapshot) => clipboard::restore_now(&snapshot),
        None => {
            if clipboard::read_text().is_some_and(|text| text.starts_with(SELECTION_PROBE_PREFIX)) {
                clipboard::clear();
            }
        }
    }
}

#[cfg(any(target_os = "linux", target_os = "windows", test))]
trait PasteExecutor {
    fn write_text(&self, text: &str) -> Result<(), AppError>;
    fn active_target_id(&self) -> Option<String>;
    fn paste_keys(&self, config: &Value, target: &SelectionTarget) -> Result<(), AppError>;
    fn restore_later(&self, run: SelectionRun, text: String);
}

#[cfg(any(target_os = "linux", target_os = "windows", test))]
fn paste_with(
    executor: &impl PasteExecutor,
    config: &Value,
    run: SelectionRun,
    text: String,
) -> Result<SelectionFinishStatus, AppError> {
    executor.write_text(&text)?;
    if executor.active_target_id().as_deref() != Some(run.target.id.as_str()) {
        return Ok(SelectionFinishStatus::CopiedToClipboard);
    }
    executor.paste_keys(config, &run.target)?;
    executor.restore_later(run, text);
    Ok(SelectionFinishStatus::Pasted)
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
struct SystemPasteExecutor;

#[cfg(target_os = "linux")]
impl PasteExecutor for SystemPasteExecutor {
    fn write_text(&self, text: &str) -> Result<(), AppError> {
        super::clipboard::copy_to_clipboard(text)
    }
    fn active_target_id(&self) -> Option<String> {
        active_target().map(|target| target.id)
    }
    fn paste_keys(&self, config: &Value, target: &SelectionTarget) -> Result<(), AppError> {
        use super::linux::text_injector::{FocusedKeyAction, SystemTextInjector};
        SystemTextInjector::detect()
            .press_in_focused(config, FocusedKeyAction::Paste, target.is_terminal)
            .map_err(|error| AppError::Failed(format!("{error}. The result is in the clipboard")))
    }
    fn restore_later(&self, run: SelectionRun, text: String) {
        if let Some(snapshot) = run.clipboard_snapshot {
            super::clipboard::restore_later(snapshot, text);
        }
    }
}

#[cfg(target_os = "windows")]
impl PasteExecutor for SystemPasteExecutor {
    fn write_text(&self, text: &str) -> Result<(), AppError> {
        super::windows::clipboard::write_text(text)
    }
    fn active_target_id(&self) -> Option<String> {
        super::windows::focused_foreground_target()
    }
    fn paste_keys(&self, _config: &Value, target: &SelectionTarget) -> Result<(), AppError> {
        super::windows::press_copy_or_paste(false, target.is_terminal)
    }
    fn restore_later(&self, run: SelectionRun, text: String) {
        if let Some(snapshot) = run.clipboard_snapshot {
            super::clipboard::restore_later(snapshot, text);
        }
    }
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
pub(crate) fn paste_result(
    config: &Value,
    run: SelectionRun,
    text: String,
) -> Result<SelectionFinishStatus, AppError> {
    paste_with(&SystemPasteExecutor, config, run, text)
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
pub(crate) fn paste_result(
    _config: &Value,
    _run: SelectionRun,
    _text: String,
) -> Result<SelectionFinishStatus, AppError> {
    Err(AppError::ServiceUnavailable(
        "Replacing the selection is only available on Linux and Windows".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct MockPasteExecutor {
        target: Option<String>,
        write_fails: bool,
        paste_fails: bool,
        calls: RefCell<Vec<&'static str>>,
    }

    impl PasteExecutor for MockPasteExecutor {
        fn write_text(&self, text: &str) -> Result<(), AppError> {
            assert_eq!(text, "result");
            self.calls.borrow_mut().push("write");
            if self.write_fails {
                Err(AppError::Failed("write failed".into()))
            } else {
                Ok(())
            }
        }
        fn active_target_id(&self) -> Option<String> {
            self.calls.borrow_mut().push("focus");
            self.target.clone()
        }
        fn paste_keys(&self, _config: &Value, target: &SelectionTarget) -> Result<(), AppError> {
            assert!(target.is_terminal);
            self.calls.borrow_mut().push("paste");
            if self.paste_fails {
                Err(AppError::Failed("paste failed".into()))
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
            is_external: false,
            captured_text: Some("selected".into()),
            target: SelectionTarget {
                id: "target".into(),
                is_terminal: true,
            },
            started_at: std::time::Instant::now(),
            clipboard_snapshot: None,
        }
    }

    fn mock_executor(target: Option<&str>) -> MockPasteExecutor {
        MockPasteExecutor {
            target: target.map(str::to_owned),
            write_fails: false,
            paste_fails: false,
            calls: RefCell::new(Vec::new()),
        }
    }

    #[test]
    fn changed_or_missing_focus_keeps_the_result_in_clipboard_without_pasting() {
        for target in [None, Some("other")] {
            let executor = mock_executor(target);
            assert_eq!(
                paste_with(&executor, &Value::Null, run(), "result".into()).unwrap(),
                SelectionFinishStatus::CopiedToClipboard
            );
            assert_eq!(*executor.calls.borrow(), ["write", "focus"]);
        }
    }

    #[test]
    fn successful_paste_schedules_restoration_after_pressing_the_keys() {
        let executor = mock_executor(Some("target"));
        assert_eq!(
            paste_with(&executor, &Value::Null, run(), "result".into()).unwrap(),
            SelectionFinishStatus::Pasted
        );
        assert_eq!(
            *executor.calls.borrow(),
            ["write", "focus", "paste", "restore"]
        );
    }

    #[test]
    fn clipboard_and_key_errors_do_not_schedule_restoration() {
        for write_fails in [false, true] {
            let executor = MockPasteExecutor {
                write_fails,
                paste_fails: true,
                ..mock_executor(Some("target"))
            };
            assert!(paste_with(&executor, &Value::Null, run(), "result".into()).is_err());
            let expected = if write_fails {
                vec!["write"]
            } else {
                vec!["write", "focus", "paste"]
            };
            assert_eq!(*executor.calls.borrow(), expected);
        }
    }
}
