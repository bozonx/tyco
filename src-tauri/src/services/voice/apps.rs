//! The watches of the applications that play sound, for the source menu of
//! the listening overlay. Streams are watched only while someone looks.
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Instant;

use serde::Serialize;

use crate::errors::AppError;
use crate::locks::{CondvarExt, MutexExt};
use crate::services::background::StoppableService;
use crate::services::net::EventSink;
use crate::services::platform::audio::{self, AudioAppsWatch};
use crate::services::voice::AudioApp;

/// What a watch sends through its channel.
#[derive(Serialize, Debug, PartialEq, ts_rs::TS)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AudioAppsEvent {
    /// The applications that play sound now, with their levels.
    Apps { apps: Vec<AudioApp> },
}

#[derive(Default)]
struct WatchesState {
    is_stopping: bool,
    active_drops: usize,
    watches: HashMap<u64, AudioAppsWatch>,
}

#[derive(Default)]
struct SharedWatches {
    state: Mutex<WatchesState>,
    changed: Condvar,
}

struct DropCountGuard {
    shared: Arc<SharedWatches>,
    count: usize,
}

impl Drop for DropCountGuard {
    fn drop(&mut self) {
        self.shared.state.locked().active_drops -= self.count;
        self.shared.changed.notify_all();
    }
}

#[derive(Clone, Default)]
pub struct AudioAppsWatches {
    next_id: Arc<AtomicU64>,
    shared: Arc<SharedWatches>,
}

impl AudioAppsWatches {
    fn is_stopping(&self) -> bool {
        self.shared.state.locked().is_stopping
    }

    fn insert(&self, watch: AudioAppsWatch) -> Result<u64, AudioAppsWatch> {
        let mut state = self.shared.state.locked();
        if state.is_stopping {
            return Err(watch);
        }
        let id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        state.watches.insert(id, watch);
        Ok(id)
    }

    fn remove(&self, id: u64) -> Option<AudioAppsWatch> {
        self.shared.state.locked().watches.remove(&id)
    }
}

impl StoppableService for AudioAppsWatches {
    /// Rejects new watches and stops active ones off the shutdown coordinator
    /// thread so a stalled audio backend cannot block past the deadline.
    fn stop(&self) {
        let watches: Vec<_> = {
            let mut state = self.shared.state.locked();
            state.is_stopping = true;
            let drained: Vec<_> = state.watches.drain().map(|(_, watch)| watch).collect();
            state.active_drops += drained.len();
            drained
        };
        if watches.is_empty() {
            return;
        }
        let guard = DropCountGuard {
            shared: Arc::clone(&self.shared),
            count: watches.len(),
        };
        let spawned = std::thread::Builder::new()
            .name("audio-apps-watch-shutdown".into())
            .spawn(move || {
                let _guard = guard;
                drop(watches);
            });
        if let Err(error) = spawned {
            log::warn!("Could not start audio apps watch shutdown thread: {error}");
        }
    }

    fn wait_until(&self, deadline: Instant) -> bool {
        let state = self.shared.state.locked();
        self.shared
            .changed
            .wait_while_until(state, deadline, |state| state.active_drops != 0)
    }
}

/// Starts sending the playing applications to `sink`; returns the id that
/// `unwatch` takes.
pub fn watch<S: EventSink>(watches: &AudioAppsWatches, sink: S) -> Result<u64, AppError> {
    if watches.is_stopping() {
        return Err(AppError::ServiceUnavailable(
            "Audio application watches are shutting down".into(),
        ));
    }
    if !audio::can_capture_apps() {
        return Err(AppError::ServiceUnavailable(
            "Recording an application is not available on this system".into(),
        ));
    }
    let watch = audio::watch_audio_apps(Box::new(move |apps| {
        sink.send_event(&AudioAppsEvent::Apps { apps });
    }))?;
    watches.insert(watch).map_err(|late_watch| {
        drop(late_watch);
        AppError::ServiceUnavailable("Audio application watches are shutting down".into())
    })
}

pub fn unwatch(watches: &AudioAppsWatches, id: u64) {
    // dropped outside the lock: ending a watch joins its thread
    let watch = watches.remove(id);
    drop(watch);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;
    use std::time::Duration;

    #[test]
    fn a_watch_is_removed_once() {
        let watches = AudioAppsWatches::default();
        let id = watches.insert(Box::new(())).unwrap();
        assert!(watches.remove(id).is_some());
        assert!(watches.remove(id).is_none());
    }

    #[test]
    fn shutdown_rejects_new_watches_and_bounds_stalled_drops() {
        struct StalledWatch(std::sync::mpsc::Receiver<()>);
        impl Drop for StalledWatch {
            fn drop(&mut self) {
                let _ = self.0.recv();
            }
        }

        let watches = AudioAppsWatches::default();
        let dropped = Arc::new(AtomicBool::new(false));
        struct FastWatch(Arc<AtomicBool>);
        impl Drop for FastWatch {
            fn drop(&mut self) {
                self.0.store(true, Ordering::SeqCst);
            }
        }
        watches
            .insert(Box::new(FastWatch(dropped.clone())))
            .unwrap();
        watches.stop();
        assert!(watches.wait_until(Instant::now() + Duration::from_secs(1)));
        assert!(dropped.load(Ordering::SeqCst));
        assert!(watches.insert(Box::new(())).is_err());

        let stalled = AudioAppsWatches::default();
        let (release, waiting) = std::sync::mpsc::channel();
        stalled.insert(Box::new(StalledWatch(waiting))).unwrap();
        stalled.stop();
        assert!(!stalled.wait_until(Instant::now()));
        release.send(()).unwrap();
        assert!(stalled.wait_until(Instant::now() + Duration::from_secs(1)));
    }

    #[test]
    fn apps_events_keep_their_wire_names() {
        let event = AudioAppsEvent::Apps {
            apps: vec![AudioApp {
                id: "firefox".into(),
                label: "Firefox".into(),
                icon_name: None,
                level: 0.5,
            }],
        };
        assert_eq!(
            serde_json::to_value(event).unwrap(),
            serde_json::json!({"type": "apps", "apps": [
                {"id": "firefox", "label": "Firefox", "level": 0.5}
            ]})
        );
    }
}
