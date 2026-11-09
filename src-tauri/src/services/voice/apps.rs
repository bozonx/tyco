//! The watches of the applications that play sound, for the source menu of
//! the listening overlay. Streams are watched only while someone looks.
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::Serialize;

use crate::errors::AppError;
use crate::locks::MutexExt;
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
pub struct AudioAppsWatches {
    next_id: AtomicU64,
    watches: Mutex<HashMap<u64, AudioAppsWatch>>,
}

impl AudioAppsWatches {
    fn insert(&self, watch: AudioAppsWatch) -> u64 {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        self.watches.locked().insert(id, watch);
        id
    }

    fn remove(&self, id: u64) -> Option<AudioAppsWatch> {
        self.watches.locked().remove(&id)
    }

    /// Ends every watch, e.g. on shutdown.
    pub fn clear(&self) {
        let watches: Vec<_> = self.watches.locked().drain().map(|(_, watch)| watch).collect();
        drop(watches);
    }
}

/// Starts sending the playing applications to `sink`; returns the id that
/// `unwatch` takes.
pub fn watch<S: EventSink>(watches: &AudioAppsWatches, sink: S) -> Result<u64, AppError> {
    if !audio::can_capture_apps() {
        return Err(AppError::ServiceUnavailable(
            "Recording an application is not available on this system".into(),
        ));
    }
    let watch = audio::watch_audio_apps(Box::new(move |apps| {
        sink.send_event(&AudioAppsEvent::Apps { apps });
    }))?;
    Ok(watches.insert(watch))
}

pub fn unwatch(watches: &AudioAppsWatches, id: u64) {
    // dropped outside the lock: ending a watch joins its thread
    let watch = watches.remove(id);
    drop(watch);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_watch_is_removed_once() {
        let watches = AudioAppsWatches::default();
        let id = watches.insert(Box::new(()));
        assert!(watches.remove(id).is_some());
        assert!(watches.remove(id).is_none());
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
