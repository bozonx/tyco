//! Inserting text from a quick window into the window it was opened from.
use tauri::{AppHandle, Manager};

use super::{hide_window_without_refocus, wait_until_unfocused, FOCUS_RELEASE_TIMEOUT};
use crate::errors::AppError;
use crate::services::platform::{
    self, ClipboardSnapshot, ForegroundTarget, SystemTextInjector, TextInjector,
};
use crate::state::AppState;

/// The effects of an insertion, so that its order and its handling of a newer
/// activation can be tested without windows or a clipboard.
trait TargetPasteHost {
    type Snapshot;
    fn activation_id(&self) -> u64;
    fn clipboard_snapshot(&self) -> Option<Self::Snapshot>;
    fn hide(&self) -> Result<(), AppError>;
    fn copy(&self, text: &str) -> Result<(), AppError>;
    fn release_focus(&self);
    fn inject(&self) -> Result<(), AppError>;
    fn restore_now(&self, snapshot: &Self::Snapshot);
    fn restore_later(&self, snapshot: Self::Snapshot, text: String);
}

/// Hides the window, puts `text` into the clipboard and pastes it into the
/// target window. The clipboard gets its content back after a paste, and also
/// when a newer activation makes the insertion stale: that is no failure the
/// user would look for the text in the clipboard after. Any other failure
/// leaves the text in the clipboard.
fn paste_with<H: TargetPasteHost>(
    host: &H,
    activation_id: u64,
    text: String,
) -> Result<(), AppError> {
    let stale = |message: &str| AppError::Stale(message.into());
    if host.activation_id() != activation_id {
        return Err(stale("The insertion activation is no longer current"));
    }
    let previous = host.clipboard_snapshot();
    host.hide()?;
    host.copy(&text)?;
    let give_back = |previous: Option<H::Snapshot>| {
        if let Some(previous) = previous {
            host.restore_now(&previous);
        }
    };
    if host.activation_id() != activation_id {
        give_back(previous);
        return Err(stale("The insertion activation changed"));
    }
    host.release_focus();
    if host.activation_id() != activation_id {
        give_back(previous);
        return Err(stale(
            "The insertion activation changed while waiting for focus",
        ));
    }
    match host.inject() {
        Ok(()) => {
            if let Some(previous) = previous {
                host.restore_later(previous, text);
            }
            Ok(())
        }
        Err(error @ AppError::Stale(_)) => {
            give_back(previous);
            Err(error)
        }
        Err(error) => Err(error),
    }
}

struct AppPasteHost<'a> {
    app: &'a AppHandle,
    window_label: String,
    activation_id: u64,
    target: Option<ForegroundTarget>,
    user_config: std::sync::Arc<serde_json::Value>,
}

impl TargetPasteHost for AppPasteHost<'_> {
    type Snapshot = ClipboardSnapshot;
    fn activation_id(&self) -> u64 {
        self.app
            .state::<AppState>()
            .snapshot()
            .activation
            .activation_id
    }
    fn clipboard_snapshot(&self) -> Option<ClipboardSnapshot> {
        platform::clipboard::snapshot()
    }
    fn hide(&self) -> Result<(), AppError> {
        hide_window_without_refocus(self.app, self.window_label.clone(), self.activation_id)
    }
    fn copy(&self, text: &str) -> Result<(), AppError> {
        platform::clipboard::copy_to_clipboard(text)
    }
    fn release_focus(&self) {
        wait_until_unfocused(self.app, FOCUS_RELEASE_TIMEOUT);
    }
    fn inject(&self) -> Result<(), AppError> {
        SystemTextInjector.inject(&self.user_config, self.target.as_ref())
    }
    fn restore_now(&self, snapshot: &ClipboardSnapshot) {
        platform::clipboard::restore_now(snapshot);
    }
    fn restore_later(&self, snapshot: ClipboardSnapshot, text: String) {
        platform::clipboard::restore_later(snapshot, text);
    }
}

/// Pastes `text` into the target window of `activation_id`, see `paste_with`.
/// Waits for the clipboard tools and for the focus, so it must run on the
/// blocking pool.
pub fn paste_into_target(
    app: &AppHandle,
    window_label: String,
    activation_id: u64,
    text: String,
) -> Result<(), AppError> {
    let snapshot = app.state::<AppState>().snapshot();
    let host = AppPasteHost {
        app,
        window_label,
        activation_id,
        target: snapshot
            .activation
            .target_window_id
            .clone()
            .map(ForegroundTarget::from_platform_id),
        user_config: snapshot.settings.user_config.clone(),
    };
    paste_with(&host, activation_id, text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    #[derive(Default)]
    struct Host {
        calls: RefCell<Vec<&'static str>>,
        activation_id: Cell<u64>,
        /// The activation a step changes to: 1 hide, 2 copy, 3 focus release
        change_after: Option<u8>,
        has_snapshot: bool,
        copy_fails: bool,
        inject_error: Option<fn() -> AppError>,
    }

    impl Host {
        fn step(&self, name: &'static str, number: u8) {
            self.calls.borrow_mut().push(name);
            if self.change_after == Some(number) {
                self.activation_id.set(self.activation_id.get() + 1);
            }
        }
    }

    impl TargetPasteHost for Host {
        type Snapshot = ();
        fn activation_id(&self) -> u64 {
            self.activation_id.get()
        }
        fn clipboard_snapshot(&self) -> Option<()> {
            self.has_snapshot.then_some(())
        }
        fn hide(&self) -> Result<(), AppError> {
            self.step("hide", 1);
            Ok(())
        }
        fn copy(&self, text: &str) -> Result<(), AppError> {
            assert_eq!(text, "text");
            self.step("copy", 2);
            if self.copy_fails {
                return Err(AppError::Failed("copy failed".into()));
            }
            Ok(())
        }
        fn release_focus(&self) {
            self.step("focus", 3);
        }
        fn inject(&self) -> Result<(), AppError> {
            self.calls.borrow_mut().push("inject");
            self.inject_error.map_or(Ok(()), |error| Err(error()))
        }
        fn restore_now(&self, _: &()) {
            self.calls.borrow_mut().push("restore-now");
        }
        fn restore_later(&self, _: (), text: String) {
            assert_eq!(text, "text");
            self.calls.borrow_mut().push("restore-later");
        }
    }

    fn with_snapshot() -> Host {
        Host {
            has_snapshot: true,
            ..Host::default()
        }
    }

    #[test]
    fn a_paste_restores_the_clipboard_after_injecting() {
        let host = with_snapshot();
        paste_with(&host, 0, "text".into()).unwrap();
        assert_eq!(
            *host.calls.borrow(),
            ["hide", "copy", "focus", "inject", "restore-later"]
        );
    }

    #[test]
    fn a_stale_insertion_never_touches_the_window() {
        let host = with_snapshot();
        assert!(matches!(
            paste_with(&host, 7, "text".into()),
            Err(AppError::Stale(_))
        ));
        assert!(host.calls.borrow().is_empty());
    }

    #[test]
    fn a_newer_activation_gives_the_clipboard_back() {
        for (change_after, expected) in [
            (2, vec!["hide", "copy", "restore-now"]),
            (3, vec!["hide", "copy", "focus", "restore-now"]),
        ] {
            let host = Host {
                change_after: Some(change_after),
                ..with_snapshot()
            };
            assert!(matches!(
                paste_with(&host, 0, "text".into()),
                Err(AppError::Stale(_))
            ));
            assert_eq!(*host.calls.borrow(), expected);
        }
        let host = Host {
            inject_error: Some(|| AppError::Stale("target closed".into())),
            ..with_snapshot()
        };
        assert!(paste_with(&host, 0, "text".into()).is_err());
        assert_eq!(
            *host.calls.borrow(),
            ["hide", "copy", "focus", "inject", "restore-now"]
        );
    }

    #[test]
    fn a_failed_injection_keeps_the_text_in_the_clipboard() {
        let host = Host {
            inject_error: Some(|| AppError::Failed("no ydotoold".into())),
            ..with_snapshot()
        };
        assert!(paste_with(&host, 0, "text".into()).is_err());
        assert_eq!(*host.calls.borrow(), ["hide", "copy", "focus", "inject"]);
    }

    #[test]
    fn without_a_snapshot_or_a_copy_nothing_is_restored() {
        let host = Host {
            change_after: Some(2),
            ..Host::default()
        };
        assert!(paste_with(&host, 0, "text".into()).is_err());
        assert_eq!(*host.calls.borrow(), ["hide", "copy"]);
        let host = Host {
            copy_fails: true,
            ..with_snapshot()
        };
        assert!(paste_with(&host, 0, "text".into()).is_err());
        assert_eq!(*host.calls.borrow(), ["hide", "copy"]);
    }
}
