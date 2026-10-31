//! Copying the selection out of the focused window and pasting a result over
//! it, for selection replacement.
//!
//! The copy keys put the selection into the clipboard, which gets its content
//! back right after: the user's clipboard must not hold the selection while
//! an action runs, nor lose what the user copies meanwhile. The paste takes a
//! fresh snapshot for the same reason.
//!
//! A terminal gets no copy keys: Ctrl+C interrupts the running program, and
//! the keys that copy differ between terminals. On Linux its selection is
//! read from the primary selection; nothing is ever pasted over it, since a
//! terminal selection cannot be replaced and a paste at the prompt could run
//! a command.
#[cfg(any(target_os = "linux", target_os = "windows", test))]
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::errors::AppError;
#[cfg(any(target_os = "linux", target_os = "windows", test))]
use crate::services::clock::{MonotonicClock, SystemClock};
#[cfg(any(target_os = "linux", target_os = "windows", test))]
use crate::services::selection_replace::SelectionTarget;
use crate::services::selection_replace::{
    SelectionFinishStatus, SelectionRun, SelectionRunError, SelectionRunErrorCode,
};

/// The window that has the keyboard focus now. The tracker knows its class,
/// which tells a terminal; without it X11 can still tell the window.
#[cfg(target_os = "linux")]
fn active_target(terminal_apps: &[String]) -> Option<SelectionTarget> {
    use super::{session, terminals::is_terminal_class, window_tracker::tracker};

    if tracker().is_running() {
        return tracker().active_window().map(|window| SelectionTarget {
            is_terminal: is_terminal_class(&window.class, terminal_apps),
            id: window.id,
        });
    }
    if !session::current().is_x11() {
        return None;
    }
    let id = super::linux::x11::active_window()?;
    Some(SelectionTarget {
        is_terminal: super::linux::x11::is_terminal_window(&id, terminal_apps),
        id,
    })
}

#[cfg(target_os = "linux")]
fn active_target_id() -> Option<String> {
    active_target(&[]).map(|target| target.id)
}

/// The text the copy keys overwrite: a clipboard still holding it means
/// nothing was copied.
#[cfg(any(target_os = "linux", target_os = "windows", test))]
const SELECTION_PROBE_PREFIX: &str = "tyco-selection-probe-";

#[cfg(any(target_os = "linux", target_os = "windows", test))]
fn probe_text() -> String {
    format!(
        "{SELECTION_PROBE_PREFIX}{}",
        crate::services::clock::now_ns()
    )
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
fn new_run(target: SelectionTarget) -> SelectionRun {
    SelectionRun {
        id: 0,
        is_external: false,
        captured_text: None,
        target,
        started_at: Instant::now(),
    }
}

#[cfg(target_os = "linux")]
fn no_target_error() -> SelectionRunError {
    use super::{session, window_tracker::tracker};
    let session = session::current();
    let message = if session.is_kde_wayland() && !tracker().is_running() {
        "Replacing a selection needs the KWin window tracker, which is not running"
    } else if session.is_wayland() && !session.is_kde_wayland() {
        "Replacing a selection on Wayland needs KDE Plasma: this desktop does not tell Tyco which window has the focus"
    } else {
        "No application window has the focus"
    };
    SelectionRunError::new(SelectionRunErrorCode::NoTarget, message)
}

#[cfg(target_os = "linux")]
pub(crate) fn capture(user_config: &Value) -> Result<(String, SelectionRun), SelectionRunError> {
    let terminal_apps = crate::models::user_config::terminal_apps(user_config);
    let target = active_target(&terminal_apps).ok_or_else(no_target_error)?;
    let text = if target.is_terminal {
        terminal_selection(&target.id)?
    } else {
        let injector = super::linux::text_injector::SystemTextInjector::detect();
        copy_selection(
            &LinuxCopyProbe {
                injector: &injector,
                user_config,
            },
            &SystemCaptureClipboard,
            &target.id,
        )?
    };
    Ok((text, new_run(target)))
}

/// The selection of a terminal, from the primary selection, which it fills
/// as soon as the text is selected; only when it was made in that terminal.
#[cfg(target_os = "linux")]
fn terminal_selection(target_id: &str) -> Result<String, SelectionRunError> {
    let display = super::session::current().display;
    if super::linux::is_selection_from(display, Some(target_id)) == Some(false) {
        return Err(no_selection_error());
    }
    super::linux::clipboard_restore::read_primary()
        .filter(|text| !text.trim().is_empty())
        .ok_or_else(no_selection_error)
}

#[cfg(target_os = "linux")]
fn no_selection_error() -> SelectionRunError {
    SelectionRunError::new(
        SelectionRunErrorCode::NoSelection,
        "Nothing is selected in the focused window",
    )
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
pub(crate) fn capture(_user_config: &Value) -> Result<(String, SelectionRun), SelectionRunError> {
    Err(SelectionRunError::new(
        SelectionRunErrorCode::Unsupported,
        "Replacing the selection is only available on Linux and Windows",
    ))
}

#[cfg(target_os = "windows")]
pub(crate) fn capture(user_config: &Value) -> Result<(String, SelectionRun), SelectionRunError> {
    use super::windows;
    let terminal_apps = crate::models::user_config::terminal_apps(user_config);
    let id = windows::focused_foreground_target().ok_or_else(|| {
        SelectionRunError::new(SelectionRunErrorCode::NoTarget, "No foreground window")
    })?;
    let keys = windows::window_keys_of(&id, &terminal_apps);
    if !keys.can_copy() {
        return Err(SelectionRunError::new(
            SelectionRunErrorCode::Capture,
            "This terminal copies a selection as soon as it is made and has no copy keys: copy the text yourself",
        ));
    }
    windows::ensure_window_not_elevated(&id).map_err(|error| {
        SelectionRunError::new(SelectionRunErrorCode::Capture, error.to_string())
    })?;
    let probe = WindowsCopyProbe::new(keys);
    let text = copy_selection(&probe, &SystemCaptureClipboard, &id)?;
    Ok((
        text,
        new_run(SelectionTarget {
            id,
            is_terminal: keys.is_terminal(),
        }),
    ))
}

/// Copies the selection of `target_id` and gives the clipboard its content
/// back, see `copy_with_probe` and `settle_clipboard`.
#[cfg(any(target_os = "linux", target_os = "windows", test))]
fn copy_selection<C: CaptureClipboard>(
    io: &impl CopyProbe,
    clipboard: &C,
    target_id: &str,
) -> Result<String, SelectionRunError> {
    let snapshot = clipboard.snapshot();
    let outcome = copy_with_probe(io, &SystemClock, target_id, &probe_text());
    settle_clipboard(clipboard, snapshot, &outcome);
    match outcome {
        Ok(CopyOutcome::Copied(text)) => Ok(text),
        Ok(CopyOutcome::Nothing) => Err(SelectionRunError::new(
            SelectionRunErrorCode::NoSelection,
            "Nothing is selected in the focused window",
        )),
        Ok(CopyOutcome::FocusChanged) => Err(SelectionRunError::new(
            SelectionRunErrorCode::NoTarget,
            "Focus changed before capture",
        )),
        Err(error) => Err(SelectionRunError::new(
            SelectionRunErrorCode::Capture,
            error.to_string(),
        )),
    }
}

/// The clipboard as a capture uses it, so that giving its content back can
/// be tested without a real one.
#[cfg(any(target_os = "linux", target_os = "windows", test))]
trait CaptureClipboard {
    type Snapshot;
    fn snapshot(&self) -> Option<Self::Snapshot>;
    fn read_text(&self) -> Option<String>;
    fn restore_now(&self, snapshot: &Self::Snapshot);
    /// Puts the snapshot back again if an application copies over it soon.
    fn guard_restored(&self, snapshot: Self::Snapshot);
    fn clear(&self);
}

/// Gives the clipboard what it held before the copy keys. A clipboard that
/// holds neither the probe nor the copied text got something else meanwhile,
/// from the user, and keeps it. Without a snapshot only the probe goes: a
/// copied selection is what the user had selected anyway.
#[cfg(any(target_os = "linux", target_os = "windows", test))]
fn settle_clipboard<C: CaptureClipboard>(
    clipboard: &C,
    snapshot: Option<C::Snapshot>,
    outcome: &Result<CopyOutcome, AppError>,
) {
    let current = clipboard.read_text();
    let holds_probe = current
        .as_deref()
        .is_some_and(|text| text.starts_with(SELECTION_PROBE_PREFIX));
    match (outcome, snapshot) {
        (Ok(CopyOutcome::Copied(text)), Some(snapshot)) if current.as_ref() == Some(text) => {
            clipboard.restore_now(&snapshot);
        }
        (Ok(CopyOutcome::Copied(_)), _) => {}
        // the window may still copy after the wait gave up
        (Ok(CopyOutcome::Nothing), Some(snapshot)) if holds_probe || current.is_none() => {
            clipboard.restore_now(&snapshot);
            clipboard.guard_restored(snapshot);
        }
        (_, Some(snapshot)) if holds_probe => clipboard.restore_now(&snapshot),
        (_, None) if holds_probe => clipboard.clear(),
        _ => {}
    }
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
struct SystemCaptureClipboard;

#[cfg(any(target_os = "linux", target_os = "windows"))]
impl CaptureClipboard for SystemCaptureClipboard {
    type Snapshot = super::clipboard::ClipboardSnapshot;
    fn snapshot(&self) -> Option<Self::Snapshot> {
        let snapshot = super::clipboard::snapshot();
        if snapshot.is_none() {
            log::warn!("The clipboard content cannot be preserved; the copied text replaces it");
        }
        snapshot
    }
    fn read_text(&self) -> Option<String> {
        super::clipboard::read_text()
    }
    fn restore_now(&self, snapshot: &Self::Snapshot) {
        super::clipboard::restore_now(snapshot);
    }
    fn guard_restored(&self, snapshot: Self::Snapshot) {
        super::clipboard::guard_restored(snapshot);
    }
    fn clear(&self) {
        super::clipboard::clear();
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
    clock: &impl MonotonicClock,
    target_id: &str,
    probe: &str,
) -> Result<CopyOutcome, AppError> {
    io.write_probe(probe)?;
    if io.focused_target_id().as_deref() != Some(target_id) {
        return Ok(CopyOutcome::FocusChanged);
    }
    io.press_copy()?;
    let deadline = clock.now() + COPY_TIMEOUT;
    loop {
        let read = io.read_text();
        match read {
            Some(ref text) if text == probe => {}
            Some(ref text) if text.trim().is_empty() => return Ok(CopyOutcome::Nothing),
            Some(text) => return Ok(CopyOutcome::Copied(text)),
            // not text, e.g. an image, or not answered yet
            None => {}
        }
        if clock.now() >= deadline {
            log::debug!(
                "The copy keys changed nothing in the clipboard: {}",
                match read {
                    Some(_) => "the probe text is still there",
                    None => "it holds no text",
                }
            );
            return Ok(CopyOutcome::Nothing);
        }
        clock.sleep(COPY_POLL_INTERVAL);
    }
}

#[cfg(target_os = "linux")]
struct LinuxCopyProbe<'a> {
    injector: &'a super::linux::text_injector::SystemTextInjector,
    user_config: &'a Value,
}

#[cfg(target_os = "linux")]
impl CopyProbe for LinuxCopyProbe<'_> {
    fn write_probe(&self, probe: &str) -> Result<(), AppError> {
        super::clipboard::copy_to_clipboard(probe)
    }
    fn focused_target_id(&self) -> Option<String> {
        active_target_id()
    }
    fn press_copy(&self) -> Result<(), AppError> {
        use super::linux::text_injector::FocusedKeyAction;
        self.injector
            .press_in_focused(self.user_config, FocusedKeyAction::Copy)
    }
    fn read_text(&self) -> Option<String> {
        super::clipboard::read_text()
    }
}

/// Reads the clipboard only once its sequence number changed: opening it
/// every poll would keep the copying application from writing to it, which
/// Office and remote desktops report as a failed copy.
#[cfg(target_os = "windows")]
struct WindowsCopyProbe {
    keys: super::windows::WindowKeys,
    sequence: std::cell::Cell<u32>,
}

#[cfg(target_os = "windows")]
impl WindowsCopyProbe {
    fn new(keys: super::windows::WindowKeys) -> Self {
        Self {
            keys,
            sequence: std::cell::Cell::new(0),
        }
    }
}

#[cfg(target_os = "windows")]
impl CopyProbe for WindowsCopyProbe {
    fn write_probe(&self, probe: &str) -> Result<(), AppError> {
        super::windows::clipboard::write_text(probe)?;
        self.sequence
            .set(super::windows::clipboard::sequence_number());
        Ok(())
    }
    fn focused_target_id(&self) -> Option<String> {
        super::windows::focused_foreground_target()
    }
    fn press_copy(&self) -> Result<(), AppError> {
        super::windows::press_keys(self.keys, super::windows::KeyAction::Copy)
    }
    fn read_text(&self) -> Option<String> {
        if super::windows::clipboard::sequence_number() == self.sequence.get() {
            return None;
        }
        super::clipboard::read_text()
    }
}

/// The system effects of pasting a result over the selection.
#[cfg(any(target_os = "linux", target_os = "windows", test))]
trait PasteExecutor {
    type Snapshot;
    fn snapshot(&self) -> Option<Self::Snapshot>;
    /// Copies the selection of `target` again, to tell whether it is still
    /// the one the result was made of.
    fn copy_selection(
        &self,
        config: &Value,
        target: &SelectionTarget,
    ) -> Result<CopyOutcome, AppError>;
    fn write_text(&self, text: &str) -> Result<(), AppError>;
    fn active_target_id(&self) -> Option<String>;
    fn paste_keys(&self, config: &Value, target: &SelectionTarget) -> Result<(), AppError>;
    fn restore_now(&self, snapshot: &Self::Snapshot);
    fn restore_later(&self, snapshot: Self::Snapshot, text: String);
}

/// Line breaks as one character, the way the result and a copy compare: a
/// Windows application copies CRLF.
#[cfg(any(target_os = "linux", target_os = "windows", test))]
fn same_text(first: &str, second: &str) -> bool {
    first.replace("\r\n", "\n") == second.replace("\r\n", "\n")
}

/// Pastes `text` over the selection of the run, when the selection is still
/// there: the user may have moved the cursor or selected other text while the
/// action ran. Otherwise, and in a terminal, the result waits in the
/// clipboard. After a paste the clipboard gets its content back.
#[cfg(any(target_os = "linux", target_os = "windows", test))]
fn paste_with<E: PasteExecutor>(
    executor: &E,
    config: &Value,
    run: SelectionRun,
    text: String,
) -> Result<SelectionFinishStatus, AppError> {
    if run.target.is_terminal {
        executor.write_text(&text)?;
        return Ok(SelectionFinishStatus::TerminalClipboard);
    }
    if executor.active_target_id().as_deref() != Some(run.target.id.as_str()) {
        executor.write_text(&text)?;
        return Ok(SelectionFinishStatus::CopiedToClipboard);
    }
    let snapshot = executor.snapshot();
    let give_back = |snapshot: Option<E::Snapshot>| {
        if let Some(snapshot) = snapshot {
            executor.restore_now(&snapshot);
        }
    };
    if let Some(captured) = run.captured_text.as_deref() {
        match executor.copy_selection(config, &run.target) {
            Ok(CopyOutcome::Copied(current)) if same_text(&current, captured) => {}
            Ok(CopyOutcome::FocusChanged) => {
                executor.write_text(&text)?;
                return Ok(SelectionFinishStatus::CopiedToClipboard);
            }
            Ok(_) => {
                executor.write_text(&text)?;
                return Ok(SelectionFinishStatus::SelectionChanged);
            }
            Err(error) => {
                give_back(snapshot);
                return Err(error);
            }
        }
    }
    if let Err(error) = executor.write_text(&text) {
        give_back(snapshot);
        return Err(error);
    }
    if executor.active_target_id().as_deref() != Some(run.target.id.as_str()) {
        return Ok(SelectionFinishStatus::CopiedToClipboard);
    }
    executor.paste_keys(config, &run.target)?;
    if let Some(snapshot) = snapshot {
        executor.restore_later(snapshot, text);
    }
    Ok(SelectionFinishStatus::Pasted)
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
struct SystemPasteExecutor;

#[cfg(any(target_os = "linux", target_os = "windows"))]
impl PasteExecutor for SystemPasteExecutor {
    type Snapshot = super::clipboard::ClipboardSnapshot;
    fn snapshot(&self) -> Option<Self::Snapshot> {
        super::clipboard::snapshot()
    }
    fn copy_selection(
        &self,
        config: &Value,
        target: &SelectionTarget,
    ) -> Result<CopyOutcome, AppError> {
        #[cfg(target_os = "linux")]
        {
            let injector = super::linux::text_injector::SystemTextInjector::detect();
            let probe = LinuxCopyProbe {
                injector: &injector,
                user_config: config,
            };
            copy_with_probe(&probe, &SystemClock, &target.id, &probe_text())
        }
        #[cfg(target_os = "windows")]
        {
            let terminal_apps = crate::models::user_config::terminal_apps(config);
            let probe =
                WindowsCopyProbe::new(super::windows::window_keys_of(&target.id, &terminal_apps));
            copy_with_probe(&probe, &SystemClock, &target.id, &probe_text())
        }
    }
    fn write_text(&self, text: &str) -> Result<(), AppError> {
        super::clipboard::copy_to_clipboard(text)
    }
    fn active_target_id(&self) -> Option<String> {
        #[cfg(target_os = "linux")]
        {
            active_target_id()
        }
        #[cfg(target_os = "windows")]
        {
            super::windows::focused_foreground_target()
        }
    }
    fn paste_keys(&self, config: &Value, target: &SelectionTarget) -> Result<(), AppError> {
        #[cfg(target_os = "linux")]
        {
            let _ = target;
            use super::linux::text_injector::{FocusedKeyAction, SystemTextInjector};
            SystemTextInjector::detect()
                .press_in_focused(config, FocusedKeyAction::Paste)
                .map_err(|error| {
                    AppError::Failed(format!("{error}. The result is in the clipboard"))
                })
        }
        #[cfg(target_os = "windows")]
        {
            let terminal_apps = crate::models::user_config::terminal_apps(config);
            super::windows::press_keys(
                super::windows::window_keys_of(&target.id, &terminal_apps),
                super::windows::KeyAction::Paste,
            )
        }
    }
    fn restore_now(&self, snapshot: &Self::Snapshot) {
        super::clipboard::restore_now(snapshot);
    }
    fn restore_later(&self, snapshot: Self::Snapshot, text: String) {
        super::clipboard::restore_later(snapshot, text);
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
    use std::cell::{Cell, RefCell};

    struct Probe {
        calls: RefCell<Vec<String>>,
        focused: Option<&'static str>,
        /// What the clipboard reads, one value per poll; the last one repeats
        reads: RefCell<Vec<Option<&'static str>>>,
        elapsed: Cell<Duration>,
        start: Instant,
    }

    fn probe(focused: Option<&'static str>, reads: Vec<Option<&'static str>>) -> Probe {
        Probe {
            calls: RefCell::new(Vec::new()),
            focused,
            reads: RefCell::new(reads),
            elapsed: Cell::new(Duration::ZERO),
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
    }

    impl MonotonicClock for Probe {
        fn now(&self) -> Instant {
            self.start + self.elapsed.get()
        }
        fn sleep(&self, duration: Duration) {
            self.elapsed.set(self.elapsed.get() + duration);
        }
    }

    #[test]
    fn copy_keys_are_never_pressed_once_the_focus_moved() {
        for focused in [None, Some("terminal")] {
            let io = probe(focused, vec![Some("selected")]);
            assert_eq!(
                copy_with_probe(&io, &io, "target", "p").unwrap(),
                CopyOutcome::FocusChanged
            );
            assert_eq!(*io.calls.borrow(), ["probe:p"]);
        }
    }

    #[test]
    fn the_copied_text_replaces_the_probe() {
        let io = probe(Some("target"), vec![Some("PROBE"), None, Some("selected")]);
        assert_eq!(
            copy_with_probe(&io, &io, "target", "p").unwrap(),
            CopyOutcome::Copied("selected".into())
        );
        assert_eq!(*io.calls.borrow(), ["probe:p", "copy"]);
        assert_eq!(io.elapsed.get(), COPY_POLL_INTERVAL * 2);
    }

    #[test]
    fn whitespace_or_an_unchanged_clipboard_is_no_selection() {
        let io = probe(Some("target"), vec![Some(" \n")]);
        assert_eq!(
            copy_with_probe(&io, &io, "target", "p").unwrap(),
            CopyOutcome::Nothing
        );
        assert_eq!(io.elapsed.get(), Duration::ZERO);
        for read in [Some("PROBE"), None] {
            let io = probe(Some("target"), vec![read]);
            assert_eq!(
                copy_with_probe(&io, &io, "target", "p").unwrap(),
                CopyOutcome::Nothing
            );
            assert!(io.elapsed.get() >= COPY_TIMEOUT);
        }
    }

    /// A clipboard holding `current`, whose snapshot is "user content".
    struct Clipboard {
        current: Option<String>,
        calls: RefCell<Vec<&'static str>>,
    }

    fn clipboard(current: Option<&str>) -> Clipboard {
        Clipboard {
            current: current.map(str::to_owned),
            calls: RefCell::new(Vec::new()),
        }
    }

    impl CaptureClipboard for Clipboard {
        type Snapshot = ();
        fn snapshot(&self) -> Option<()> {
            Some(())
        }
        fn read_text(&self) -> Option<String> {
            self.current.clone()
        }
        fn restore_now(&self, _: &()) {
            self.calls.borrow_mut().push("restore");
        }
        fn guard_restored(&self, _: ()) {
            self.calls.borrow_mut().push("guard");
        }
        fn clear(&self) {
            self.calls.borrow_mut().push("clear");
        }
    }

    fn probe_in_clipboard() -> String {
        format!("{SELECTION_PROBE_PREFIX}1")
    }

    #[test]
    fn a_copied_selection_gives_the_clipboard_back_at_once() {
        let copied = Ok(CopyOutcome::Copied("selected".into()));
        let board = clipboard(Some("selected"));
        settle_clipboard(&board, Some(()), &copied);
        assert_eq!(*board.calls.borrow(), ["restore"]);

        // the user copied something meanwhile: it stays
        let board = clipboard(Some("copied by the user"));
        settle_clipboard(&board, Some(()), &copied);
        assert!(board.calls.borrow().is_empty());

        // without a snapshot the selection stays, as the user selected it
        let board = clipboard(Some("selected"));
        settle_clipboard(&board, None, &copied);
        assert!(board.calls.borrow().is_empty());
    }

    #[test]
    fn a_capture_that_gave_up_guards_against_a_late_copy() {
        let board = clipboard(Some(&probe_in_clipboard()));
        settle_clipboard(&board, Some(()), &Ok(CopyOutcome::Nothing));
        assert_eq!(*board.calls.borrow(), ["restore", "guard"]);
    }

    #[test]
    fn a_failed_capture_removes_only_its_probe() {
        let failed: Result<CopyOutcome, AppError> = Err(AppError::Failed("keys".into()));
        let board = clipboard(Some(&probe_in_clipboard()));
        settle_clipboard(&board, Some(()), &failed);
        assert_eq!(*board.calls.borrow(), ["restore"]);

        let board = clipboard(Some(&probe_in_clipboard()));
        settle_clipboard(&board, None, &Ok(CopyOutcome::FocusChanged));
        assert_eq!(*board.calls.borrow(), ["clear"]);

        let board = clipboard(Some("copied by the user"));
        settle_clipboard(&board, Some(()), &failed);
        assert!(board.calls.borrow().is_empty());
    }

    struct Executor {
        /// The focused window, one value per check; the last one repeats
        focused: RefCell<Vec<Option<&'static str>>>,
        copied: fn() -> Result<CopyOutcome, AppError>,
        paste_fails: bool,
        calls: RefCell<Vec<String>>,
    }

    fn new_executor(copied: fn() -> Result<CopyOutcome, AppError>) -> Executor {
        Executor {
            focused: RefCell::new(vec![Some("target")]),
            copied,
            paste_fails: false,
            calls: RefCell::new(Vec::new()),
        }
    }

    impl PasteExecutor for Executor {
        type Snapshot = ();
        fn snapshot(&self) -> Option<()> {
            self.calls.borrow_mut().push("snapshot".into());
            Some(())
        }
        fn copy_selection(
            &self,
            _config: &Value,
            _target: &SelectionTarget,
        ) -> Result<CopyOutcome, AppError> {
            self.calls.borrow_mut().push("copy".into());
            (self.copied)()
        }
        fn write_text(&self, text: &str) -> Result<(), AppError> {
            self.calls.borrow_mut().push(format!("write:{text}"));
            Ok(())
        }
        fn active_target_id(&self) -> Option<String> {
            let mut focused = self.focused.borrow_mut();
            let current = if focused.len() > 1 {
                focused.remove(0)
            } else {
                focused[0]
            };
            current.map(str::to_owned)
        }
        fn paste_keys(&self, _config: &Value, _target: &SelectionTarget) -> Result<(), AppError> {
            self.calls.borrow_mut().push("paste".into());
            if self.paste_fails {
                Err(AppError::Failed("paste failed".into()))
            } else {
                Ok(())
            }
        }
        fn restore_now(&self, _: &()) {
            self.calls.borrow_mut().push("restore-now".into());
        }
        fn restore_later(&self, _: (), text: String) {
            self.calls
                .borrow_mut()
                .push(format!("restore-later:{text}"));
        }
    }

    fn run(is_terminal: bool) -> SelectionRun {
        SelectionRun {
            id: 1,
            is_external: false,
            captured_text: Some("line one\nline two".into()),
            target: SelectionTarget {
                id: "target".into(),
                is_terminal,
            },
            started_at: Instant::now(),
        }
    }

    fn unchanged() -> Result<CopyOutcome, AppError> {
        Ok(CopyOutcome::Copied("line one\r\nline two".into()))
    }

    #[test]
    fn an_unchanged_selection_is_replaced_and_the_clipboard_comes_back_later() {
        let executor = new_executor(unchanged);
        assert_eq!(
            paste_with(&executor, &Value::Null, run(false), "result".into()).unwrap(),
            SelectionFinishStatus::Pasted
        );
        assert_eq!(
            *executor.calls.borrow(),
            [
                "snapshot",
                "copy",
                "write:result",
                "paste",
                "restore-later:result"
            ]
        );
    }

    #[test]
    fn a_changed_selection_keeps_the_result_in_the_clipboard() {
        for copied in [
            (|| Ok(CopyOutcome::Copied("other text".into()))) as fn() -> _,
            || Ok(CopyOutcome::Nothing),
        ] {
            let executor = new_executor(copied);
            assert_eq!(
                paste_with(&executor, &Value::Null, run(false), "result".into()).unwrap(),
                SelectionFinishStatus::SelectionChanged
            );
            assert_eq!(
                *executor.calls.borrow(),
                ["snapshot", "copy", "write:result"]
            );
        }
    }

    #[test]
    fn a_terminal_selection_is_never_pasted_over() {
        let executor = new_executor(unchanged);
        assert_eq!(
            paste_with(&executor, &Value::Null, run(true), "result".into()).unwrap(),
            SelectionFinishStatus::TerminalClipboard
        );
        assert_eq!(*executor.calls.borrow(), ["write:result"]);
    }

    #[test]
    fn changed_focus_keeps_the_result_in_the_clipboard_without_pressing_keys() {
        let executor = Executor {
            focused: RefCell::new(vec![Some("other")]),
            ..new_executor(unchanged)
        };
        assert_eq!(
            paste_with(&executor, &Value::Null, run(false), "result".into()).unwrap(),
            SelectionFinishStatus::CopiedToClipboard
        );
        assert_eq!(*executor.calls.borrow(), ["write:result"]);

        // the focus moved while the selection was checked
        let executor = Executor {
            focused: RefCell::new(vec![Some("target"), None]),
            ..new_executor(unchanged)
        };
        assert_eq!(
            paste_with(&executor, &Value::Null, run(false), "result".into()).unwrap(),
            SelectionFinishStatus::CopiedToClipboard
        );
        assert_eq!(
            *executor.calls.borrow(),
            ["snapshot", "copy", "write:result"]
        );
    }

    #[test]
    fn a_failed_check_gives_the_clipboard_back_and_a_failed_paste_keeps_the_result() {
        let executor = new_executor(|| Err(AppError::Failed("keys".into())));
        assert!(paste_with(&executor, &Value::Null, run(false), "result".into()).is_err());
        assert_eq!(
            *executor.calls.borrow(),
            ["snapshot", "copy", "restore-now"]
        );

        let executor = Executor {
            paste_fails: true,
            ..new_executor(unchanged)
        };
        assert!(paste_with(&executor, &Value::Null, run(false), "result".into()).is_err());
        assert_eq!(
            *executor.calls.borrow(),
            ["snapshot", "copy", "write:result", "paste"]
        );
    }
}
