//! Which window has the focus on Windows. Out-of-context WinEvent hooks tell
//! about every change of the foreground window and every window destroyed,
//! as Microsoft recommends instead of polling `GetForegroundWindow`. The
//! callbacks run on the thread that set the hooks, inside its message loop.
//!
//! The shell takes the foreground in passing: the taskbar when a tray icon
//! is clicked, the task switcher during Alt+Tab, the Start menu and search.
//! Such a window is no target, and it does not make Tyco forget the window
//! the user worked in; only the desktop does.

use std::cell::RefCell;
use std::ptr::null_mut;
use std::time::Duration;

use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::System::Threading::GetCurrentThreadId;
use windows_sys::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, GetAncestor, GetClassNameW, GetForegroundWindow, GetMessageW, GetWindowLongW,
    GetWindowThreadProcessId, PeekMessageW, PostThreadMessageW, TranslateMessage, CHILDID_SELF,
    EVENT_OBJECT_DESTROY, EVENT_SYSTEM_FOREGROUND, GA_ROOT, GWL_EXSTYLE, MSG, OBJID_WINDOW,
    PM_NOREMOVE, WINEVENT_OUTOFCONTEXT, WM_QUIT, WM_USER, WS_EX_NOACTIVATE,
};

use crate::errors::AppError;
use crate::services::platform::window_tracker::{
    finish_startup, new_session, tracker, TrackerChange, WindowKind,
};

/// Windows of the desktop itself: focusing it means there is no target.
const DESKTOP_CLASSES: &[&str] = &["Progman", "WorkerW"];

/// Shell windows that take the foreground in passing, see the module docs.
const PASSING_CLASSES: &[&str] = &[
    // the taskbar, also on other monitors, and the tray overflow
    "Shell_TrayWnd",
    "Shell_SecondaryTrayWnd",
    "NotifyIconOverflowWindow",
    "TopLevelWindowForOverflowXamlIsland",
    // Start, search, the action and notification centers
    "Windows.UI.Core.CoreWindow",
    // Alt+Tab and Task View on Windows 10 and 11
    "MultitaskingViewFrame",
    "XamlExplorerHostIslandWindow",
    "TaskSwitcherWnd",
    "ForegroundStaging",
    "TaskListThumbnailWnd",
    // the Win+X menu, the input language switcher, context menus
    "LauncherTipWnd",
    "Shell_InputSwitchTopLevelWindow",
    "#32768",
    "Xaml_WindowedPopupClass",
];

/// What the focus on a window means for the tracker.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Focus {
    Window(WindowKind),
    /// The shell has it in passing, see the module docs.
    Passing,
}

pub(crate) fn class_name(window: HWND) -> String {
    let mut class = [0u16; 256];
    // SAFETY: the buffer outlives the call, which writes at most its length
    let length = unsafe { GetClassNameW(window, class.as_mut_ptr(), class.len() as i32) };
    if length <= 0 {
        return String::new();
    }
    String::from_utf16_lossy(&class[..length as usize])
}

/// What the focus on `window`, a top-level window, means.
pub(crate) fn classify(window: HWND, class: &str) -> Focus {
    if window.is_null() {
        return Focus::Passing;
    }
    let mut process_id = 0;
    // SAFETY: plain query; a stale handle yields a zero process id
    unsafe { GetWindowThreadProcessId(window, &mut process_id) };
    // SAFETY: plain query of the extended style
    let extended_style = unsafe { GetWindowLongW(window, GWL_EXSTYLE) } as u32;
    focus_of(
        process_id == std::process::id(),
        class,
        extended_style & WS_EX_NOACTIVATE != 0,
    )
}

fn focus_of(is_own: bool, class: &str, is_no_activate: bool) -> Focus {
    if is_own {
        Focus::Window(WindowKind::Own)
    } else if DESKTOP_CLASSES.contains(&class) {
        Focus::Window(WindowKind::Other)
    } else if is_no_activate || PASSING_CLASSES.contains(&class) {
        Focus::Passing
    } else {
        Focus::Window(WindowKind::Foreign)
    }
}

/// The top-level window an event names.
fn root_window(window: HWND) -> HWND {
    if window.is_null() {
        return window;
    }
    // SAFETY: plain query; a stale handle yields null
    let root = unsafe { GetAncestor(window, GA_ROOT) };
    if root.is_null() {
        window
    } else {
        root
    }
}

struct HookContext {
    session: String,
    seq: u64,
    on_change: Box<dyn Fn(TrackerChange)>,
}

impl HookContext {
    fn next_seq(&mut self) -> String {
        self.seq += 1;
        format!("{}:{}", self.session, self.seq)
    }

    fn foreground_changed(&mut self, window: HWND) {
        let window = root_window(window);
        let class = class_name(window);
        let seq = self.next_seq();
        let applied = match classify(window, &class) {
            Focus::Window(kind) => {
                tracker().window_activated(&seq, &(window as isize).to_string(), kind, &class)
            }
            Focus::Passing => tracker().window_activated(&seq, "", WindowKind::Other, ""),
        };
        if applied {
            (self.on_change)(TrackerChange::Activated);
        }
    }

    fn window_destroyed(&mut self, window: HWND) {
        let id = (window as isize).to_string();
        if !tracker().is_tracked(&id) {
            return;
        }
        let seq = self.next_seq();
        if tracker().window_closed(&seq, &id) {
            (self.on_change)(TrackerChange::Closed(id));
        }
    }
}

thread_local! {
    static CONTEXT: RefCell<Option<HookContext>> = const { RefCell::new(None) };
}

unsafe extern "system" fn on_win_event(
    _hook: HWINEVENTHOOK,
    event: u32,
    window: HWND,
    object_id: i32,
    child_id: i32,
    _event_thread: u32,
    _event_time: u32,
) {
    CONTEXT.with(|context| {
        // a callback re-entered from `on_change` finds the context taken
        let Ok(mut context) = context.try_borrow_mut() else {
            return;
        };
        let Some(context) = context.as_mut() else {
            return;
        };
        match event {
            EVENT_SYSTEM_FOREGROUND => context.foreground_changed(window),
            EVENT_OBJECT_DESTROY
                if object_id == OBJID_WINDOW && child_id == CHILDID_SELF as i32 =>
            {
                context.window_destroyed(window);
            }
            _ => {}
        }
    });
}

/// Tracks windows on a thread of its own for the lifetime of the process;
/// `on_change` hears about every change the tracker applied.
pub fn spawn_tracker(
    services: &crate::services::background::BackgroundServices,
    on_change: impl Fn(TrackerChange) + Send + 'static,
) -> Result<(), AppError> {
    services.spawn_thread("windows-window-tracker", move |stop| {
        if let Err(error) = run(Box::new(on_change), &stop) {
            log::warn!("Windows window tracker is unavailable: {error}");
        }
        tracker().reset(false, String::new());
        finish_startup();
    })
}

fn run(
    on_change: Box<dyn Fn(TrackerChange)>,
    stop: &crate::services::background::StopToken,
) -> Result<(), AppError> {
    // SAFETY: MSG is plain data, valid when zeroed
    let mut message: MSG = unsafe { std::mem::zeroed() };
    // SAFETY: creates the message queue of this thread, so that the stop
    // message posted from another thread cannot get lost
    unsafe { PeekMessageW(&mut message, null_mut(), WM_USER, WM_USER, PM_NOREMOVE) };
    // SAFETY: plain query
    let thread_id = unsafe { GetCurrentThreadId() };

    let session = new_session();
    tracker().reset(true, session.clone());
    CONTEXT.with(|context| {
        *context.borrow_mut() = Some(HookContext {
            session,
            seq: 0,
            on_change,
        })
    });
    let hooks = Hooks::set()?;
    // SAFETY: plain query
    let foreground = unsafe { GetForegroundWindow() };
    CONTEXT.with(|context| {
        if let Some(context) = context.borrow_mut().as_mut() {
            context.foreground_changed(foreground);
        }
    });
    finish_startup();
    log::info!("Tracking foreign windows with WinEvent hooks");

    let stop = stop.clone();
    std::thread::Builder::new()
        .name("windows-tracker-stop".into())
        .spawn(move || {
            while !stop.wait(Duration::from_secs(3600)) {}
            // SAFETY: posts to the queue the tracker thread created above
            unsafe { PostThreadMessageW(thread_id, WM_QUIT, 0, 0) };
        })?;
    loop {
        // SAFETY: `message` is a live MSG; 0 is WM_QUIT, -1 an error
        let result = unsafe { GetMessageW(&mut message, null_mut(), 0, 0) };
        if result == 0 || result == -1 {
            break;
        }
        // SAFETY: dispatches the message just received
        unsafe {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
    drop(hooks);
    CONTEXT.with(|context| *context.borrow_mut() = None);
    Ok(())
}

/// The hooks of the tracker thread, removed when it ends.
struct Hooks([HWINEVENTHOOK; 2]);

impl Hooks {
    fn set() -> Result<Self, AppError> {
        let set = |event| {
            // SAFETY: an out-of-context hook with a callback that lives for
            // the whole process; no module handle is needed for it
            unsafe {
                SetWinEventHook(
                    event,
                    event,
                    null_mut(),
                    Some(on_win_event),
                    0,
                    0,
                    WINEVENT_OUTOFCONTEXT,
                )
            }
        };
        let hooks = Self([set(EVENT_SYSTEM_FOREGROUND), set(EVENT_OBJECT_DESTROY)]);
        if hooks.0.iter().any(|hook| hook.is_null()) {
            return Err(AppError::Failed(String::from(
                "SetWinEventHook refused the window hooks",
            )));
        }
        Ok(hooks)
    }
}

impl Drop for Hooks {
    fn drop(&mut self) {
        for hook in self.0 {
            if !hook.is_null() {
                // SAFETY: a hook this thread set and has not removed yet
                unsafe { UnhookWinEvent(hook) };
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tells_targets_from_the_desktop_and_passing_shell_windows() {
        assert_eq!(
            focus_of(false, "Notepad", false),
            Focus::Window(WindowKind::Foreign)
        );
        assert_eq!(
            focus_of(true, "Notepad", false),
            Focus::Window(WindowKind::Own)
        );
        assert_eq!(
            focus_of(false, "Progman", false),
            Focus::Window(WindowKind::Other)
        );
        assert_eq!(focus_of(false, "Shell_TrayWnd", false), Focus::Passing);
        assert_eq!(
            focus_of(false, "XamlExplorerHostIslandWindow", false),
            Focus::Passing
        );
        assert_eq!(focus_of(false, "SomeOverlay", true), Focus::Passing);
    }
}
