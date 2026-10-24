//! Give trusted webviews a bounded opportunity to flush their settings drafts.
use crate::locks::MutexExt;
use std::collections::HashSet;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};

use crate::events;

#[derive(Default)]
pub struct SettingsShutdown(Mutex<ShutdownState>);

#[derive(Default)]
struct ShutdownState {
    generation: u64,
    pending: Option<HashSet<String>>,
}

#[derive(Debug, PartialEq, Eq)]
enum ShutdownFlushOutcome {
    Ignored,
    Pending,
    Complete,
    Cancelled,
}

impl ShutdownState {
    fn start(&mut self, windows: HashSet<String>) -> Option<u64> {
        if self.pending.is_some() {
            return None;
        }
        self.generation += 1;
        self.pending = Some(windows);
        Some(self.generation)
    }

    fn acknowledge(&mut self, generation: u64, window: &str, saved: bool) -> ShutdownFlushOutcome {
        if generation != self.generation {
            return ShutdownFlushOutcome::Ignored;
        }
        let Some(pending) = self.pending.as_mut() else {
            return ShutdownFlushOutcome::Ignored;
        };
        if !pending.remove(window) {
            return ShutdownFlushOutcome::Ignored;
        }
        if !saved {
            self.pending = None;
            return ShutdownFlushOutcome::Cancelled;
        }
        if pending.is_empty() {
            self.pending = None;
            return ShutdownFlushOutcome::Complete;
        }
        ShutdownFlushOutcome::Pending
    }

    fn expire(&mut self, generation: u64) -> Option<HashSet<String>> {
        if self.generation != generation {
            return None;
        }
        self.pending.take()
    }

    fn cancel(&mut self, generation: u64) -> bool {
        if self.generation == generation && self.pending.is_some() {
            self.pending = None;
            return true;
        }
        false
    }
}

fn cancel_exit(app: &AppHandle) {
    if let Err(error) = events::emit::<events::QuitCancelled, _>(app, ()) {
        log::warn!("Could not publish cancelled shutdown: {error}");
    }
    if let Err(error) = super::show_application(app) {
        log::warn!("Could not show unsaved settings: {error}");
    }
}

pub fn request(app: &AppHandle) {
    let windows = [super::MAIN_WINDOW_LABEL, super::QUICK_WINDOW_LABEL]
        .into_iter()
        .filter(|label| app.get_webview_window(label).is_some())
        .map(str::to_owned)
        .collect::<HashSet<_>>();
    if windows.is_empty() {
        super::request_exit(app);
        return;
    }
    let Some(request_id) = app
        .state::<SettingsShutdown>()
        .0
        .locked()
        .start(windows.clone())
    else {
        return;
    };
    for window in windows {
        if let Err(error) = events::emit_to::<events::QuitRequested, _>(app, &window, request_id) {
            log::warn!("Could not request settings flush: {error}");
            app.state::<SettingsShutdown>()
                .0
                .locked()
                .cancel(request_id);
            cancel_exit(app);
            return;
        }
    }
    let app = app.clone();
    let services = app.state::<crate::services::background::BackgroundServices>();
    let handle = app.clone();
    if let Err(error) = services.spawn_async(async move {
        let app = handle;
        tokio::time::sleep(Duration::from_secs(10)).await;
        let pending = app
            .state::<SettingsShutdown>()
            .0
            .locked()
            .expire(request_id);
        if let Some(windows) = pending {
            log::warn!("Settings flush deadline expired for {windows:?}; continuing shutdown");
            super::request_exit(&app);
        }
    }) {
        log::warn!("Could not watch settings shutdown: {error}");
        app.state::<SettingsShutdown>()
            .0
            .locked()
            .expire(request_id);
        super::request_exit(&app);
    }
}

pub fn acknowledge(app: &AppHandle, request_id: u64, window: &str, saved: bool) {
    let result = app
        .state::<SettingsShutdown>()
        .0
        .locked()
        .acknowledge(request_id, window, saved);
    match result {
        ShutdownFlushOutcome::Complete => {
            super::request_exit(app);
        }
        ShutdownFlushOutcome::Cancelled => cancel_exit(app),
        ShutdownFlushOutcome::Ignored | ShutdownFlushOutcome::Pending => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn windows() -> HashSet<String> {
        ["main".into(), "quick".into()].into_iter().collect()
    }

    #[test]
    fn exit_waits_for_every_window_and_ignores_duplicate_or_stale_replies() {
        let mut state = ShutdownState::default();
        let id = state.start(windows()).unwrap();
        assert!(state.start(windows()).is_none());
        assert_eq!(
            state.acknowledge(id + 1, "main", true),
            ShutdownFlushOutcome::Ignored
        );
        assert_eq!(
            state.acknowledge(id, "unknown", true),
            ShutdownFlushOutcome::Ignored
        );
        assert_eq!(
            state.acknowledge(id, "main", true),
            ShutdownFlushOutcome::Pending
        );
        assert_eq!(
            state.acknowledge(id, "main", true),
            ShutdownFlushOutcome::Ignored
        );
        assert_eq!(
            state.acknowledge(id, "quick", true),
            ShutdownFlushOutcome::Complete
        );
    }

    #[test]
    fn timeout_releases_unresponsive_windows_and_ignores_late_replies() {
        let mut state = ShutdownState::default();
        let id = state.start(windows()).unwrap();
        assert_eq!(
            state.acknowledge(id, "main", true),
            ShutdownFlushOutcome::Pending
        );
        assert!(state.expire(id + 1).is_none());
        assert_eq!(
            state.expire(id),
            Some(["quick".into()].into_iter().collect())
        );
        assert_eq!(
            state.acknowledge(id, "quick", true),
            ShutdownFlushOutcome::Ignored
        );
        assert!(state.expire(id).is_none());
    }

    #[test]
    fn failed_write_cancels_exit_and_allows_another_request() {
        let mut state = ShutdownState::default();
        let id = state.start(windows()).unwrap();
        assert_eq!(
            state.acknowledge(id, "main", false),
            ShutdownFlushOutcome::Cancelled
        );
        let next = state.start(windows()).unwrap();
        assert!(!state.cancel(id));
        assert!(state.cancel(next));
        assert_eq!(
            state.acknowledge(next, "quick", true),
            ShutdownFlushOutcome::Ignored
        );
        assert!(state.start(windows()).is_some());
    }
}
