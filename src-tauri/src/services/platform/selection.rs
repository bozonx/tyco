//! System clipboard and focused-window adapters for selection replacement.
#[cfg(any(target_os = "linux", target_os = "windows", test))]
use std::thread;
#[cfg(any(target_os = "linux", target_os = "windows", test))]
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

    let probe = format!(
        "{SELECTION_PROBE_PREFIX}{}",
        crate::services::clock::now_ns()
    );
    let io = LinuxCopyProbe {
        injector: &injector,
        user_config,
        is_terminal: run.target.is_terminal,
    };
    match copy_with_probe(&io, &run.target.id, &probe) {
        Ok(CopyOutcome::Copied(text)) => {
            run.started_at = Instant::now();
            Ok((text, run))
        }
        Ok(CopyOutcome::Nothing) => {
            restore_clipboard(run);
            Err(SelectionRunError::new(
                SelectionRunErrorCode::NoSelection,
                "Nothing is selected in the focused window",
            ))
        }
        Ok(CopyOutcome::FocusChanged) => {
            restore_clipboard(run);
            Err(SelectionRunError::new(
                SelectionRunErrorCode::NoTarget,
                "Focus changed before capture",
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
    let result = copy_with_probe(
        &WindowsCopyProbe {
            is_terminal: run.target.is_terminal,
        },
        &run.target.id,
        &probe,
    )
    .map_err(|error| SelectionRunError::new(SelectionRunErrorCode::Capture, error.to_string()))
    .and_then(|outcome| match outcome {
        CopyOutcome::Copied(text) => Ok(text),
        CopyOutcome::FocusChanged => Err(SelectionRunError::new(
            SelectionRunErrorCode::NoTarget,
            "Focus changed before capture",
        )),
        CopyOutcome::Nothing => Err(SelectionRunError::new(
            SelectionRunErrorCode::NoSelection,
            "Nothing is selected in the foreground window",
        )),
    });
    match result {
        Ok(text) => Ok((text, run)),
        Err(error) => {
            restore_clipboard(run);
            Err(error)
        }
    }
}

/// How long the copy keys have to change the clipboard.
#[cfg(any(target_os = "linux", target_os = "windows", test))]
const COPY_TIMEOUT: Duration = Duration::from_millis(700);
#[cfg(any(target_os = "linux", target_os = "windows", test))]
const COPY_POLL_INTERVAL: Duration = Duration::from_millis(25);

/// The system effects of copying a selection out of the focused window.
#[cfg(any(target_os = "linux", target_os = "windows", test))]
trait CopyProbe {
    fn write_probe(&self, probe: &str) -> Result<(), AppError>;
    fn focused_target_id(&self) -> Option<String>;
    fn press_copy(&self) -> Result<(), AppError>;
    fn read_text(&self) -> Option<String>;
    fn now(&self) -> Instant {
        Instant::now()
    }
    fn pause(&self, duration: Duration) {
        thread::sleep(duration);
    }
}

#[cfg(any(target_os = "linux", target_os = "windows", test))]
#[derive(Debug, PartialEq, Eq)]
enum CopyOutcome {
    Copied(String),
    /// Nothing, or only whitespace, is selected.
    Nothing,
    /// Another window took the focus: its copy keys must not be pressed,
    /// e.g. Ctrl+C in a terminal stops the running program.
    FocusChanged,
}

/// Presses the copy keys in `target_id` and waits for the clipboard to
/// change. A probe text put there first tells a copied selection from an
/// unchanged clipboard.
#[cfg(any(target_os = "linux", target_os = "windows", test))]
fn copy_with_probe(
    io: &impl CopyProbe,
    target_id: &str,
    probe: &str,
) -> Result<CopyOutcome, AppError> {
    io.write_probe(probe)?;
    if io.focused_target_id().as_deref() != Some(target_id) {
        return Ok(CopyOutcome::FocusChanged);
    }
    io.press_copy()?;
    let deadline = io.now() + COPY_TIMEOUT;
    loop {
        let read = io.read_text();
        match read {
            Some(ref text) if text == probe => {}
            Some(ref text) if text.trim().is_empty() => return Ok(CopyOutcome::Nothing),
            Some(text) => return Ok(CopyOutcome::Copied(text)),
            // not text, e.g. an image, or not answered yet
            None => {}
        }
        if io.now() >= deadline {
            log::debug!(
                "The copy keys changed nothing in the clipboard: {}",
                match read {
                    Some(_) => "the probe text is still there",
                    None => "it holds no text",
                }
            );
            return Ok(CopyOutcome::Nothing);
        }
        io.pause(COPY_POLL_INTERVAL);
    }
}

#[cfg(target_os = "linux")]
struct LinuxCopyProbe<'a> {
    injector: &'a super::linux::text_injector::SystemTextInjector,
    user_config: &'a Value,
    is_terminal: bool,
}

#[cfg(target_os = "linux")]
impl CopyProbe for LinuxCopyProbe<'_> {
    fn write_probe(&self, probe: &str) -> Result<(), AppError> {
        super::clipboard::copy_to_clipboard(probe)
    }
    fn focused_target_id(&self) -> Option<String> {
        active_target().map(|target| target.id)
    }
    fn press_copy(&self) -> Result<(), AppError> {
        use super::linux::text_injector::FocusedKeyAction;
        self.injector
            .press_in_focused(self.user_config, FocusedKeyAction::Copy, self.is_terminal)
    }
    fn read_text(&self) -> Option<String> {
        super::clipboard::read_text()
    }
}

#[cfg(target_os = "windows")]
struct WindowsCopyProbe {
    is_terminal: bool,
}

#[cfg(target_os = "windows")]
impl CopyProbe for WindowsCopyProbe {
    fn write_probe(&self, probe: &str) -> Result<(), AppError> {
        super::windows::clipboard::write_text(probe)
    }
    fn focused_target_id(&self) -> Option<String> {
        super::windows::focused_foreground_target()
    }
    fn press_copy(&self) -> Result<(), AppError> {
        super::windows::press_copy_or_paste(true, self.is_terminal)
    }
    fn read_text(&self) -> Option<String> {
        super::clipboard::read_text()
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

    struct Probe {
        calls: RefCell<Vec<String>>,
        focused: Option<&'static str>,
        /// What the clipboard reads, one value per poll; the last one repeats
        reads: RefCell<Vec<Option<&'static str>>>,
        elapsed: std::cell::Cell<Duration>,
        start: Instant,
    }

    fn probe(focused: Option<&'static str>, reads: Vec<Option<&'static str>>) -> Probe {
        Probe {
            calls: RefCell::new(Vec::new()),
            focused,
            reads: RefCell::new(reads),
            elapsed: std::cell::Cell::new(Duration::ZERO),
            start: Instant::now(),
        }
    }

    impl CopyProbe for Probe {
        fn write_probe(&self, probe: &str) -> Result<(), AppError> {
            self.calls.borrow_mut().push(format!("probe:{probe}"));
            Ok(())
        }
        fn focused_target_id(&self) -> Option<String> {
            self.focused.map(str::to_owned)
        }
        fn press_copy(&self) -> Result<(), AppError> {
            self.calls.borrow_mut().push("copy".into());
            Ok(())
        }
        fn read_text(&self) -> Option<String> {
            let mut reads = self.reads.borrow_mut();
            let read = if reads.len() > 1 {
                reads.remove(0)
            } else {
                reads[0]
            };
            read.map(|text| text.replace("PROBE", "p"))
        }
        fn now(&self) -> Instant {
            self.start + self.elapsed.get()
        }
        fn pause(&self, duration: Duration) {
            self.elapsed.set(self.elapsed.get() + duration);
        }
    }

    #[test]
    fn copy_keys_are_never_pressed_once_the_focus_moved() {
        for focused in [None, Some("terminal")] {
            let io = probe(focused, vec![Some("selected")]);
            assert_eq!(
                copy_with_probe(&io, "target", "p").unwrap(),
                CopyOutcome::FocusChanged
            );
            assert_eq!(*io.calls.borrow(), ["probe:p"]);
        }
    }

    #[test]
    fn the_copied_text_replaces_the_probe() {
        let io = probe(Some("target"), vec![Some("PROBE"), None, Some("selected")]);
        assert_eq!(
            copy_with_probe(&io, "target", "p").unwrap(),
            CopyOutcome::Copied("selected".into())
        );
        assert_eq!(*io.calls.borrow(), ["probe:p", "copy"]);
        assert_eq!(io.elapsed.get(), COPY_POLL_INTERVAL * 2);
    }

    #[test]
    fn whitespace_or_an_unchanged_clipboard_is_no_selection() {
        let io = probe(Some("target"), vec![Some(" \n")]);
        assert_eq!(
            copy_with_probe(&io, "target", "p").unwrap(),
            CopyOutcome::Nothing
        );
        assert_eq!(io.elapsed.get(), Duration::ZERO);
        for read in [Some("PROBE"), None] {
            let io = probe(Some("target"), vec![read]);
            assert_eq!(
                copy_with_probe(&io, "target", "p").unwrap(),
                CopyOutcome::Nothing
            );
            assert!(io.elapsed.get() >= COPY_TIMEOUT);
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
