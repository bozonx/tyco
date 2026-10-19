//! Tracks releases independently for each hotkey press.
use crate::locks::MutexExt;
use std::collections::HashMap;
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};

#[derive(Default)]
struct HotkeyReleases {
    counts: Mutex<HashMap<String, u64>>,
    changed: Condvar,
}

fn hotkey_releases() -> &'static Arc<HotkeyReleases> {
    static RELEASES: OnceLock<Arc<HotkeyReleases>> = OnceLock::new();
    RELEASES.get_or_init(|| Arc::new(HotkeyReleases::default()))
}

/// A press of the hotkey `id`, waiting for its release.
pub struct HotkeyPress {
    releases: Arc<HotkeyReleases>,
    id: String,
    initial_release_count: u64,
}

impl HotkeyPress {
    pub fn new(id: &str) -> Self {
        Self::with_releases(id, Arc::clone(hotkey_releases()))
    }

    fn with_releases(id: &str, releases: Arc<HotkeyReleases>) -> Self {
        let initial_release_count = releases
            .counts
            .locked()
            .get(id)
            .copied()
            .unwrap_or_default();
        Self {
            releases,
            id: id.to_owned(),
            initial_release_count,
        }
    }

    /// Returns once the hotkey was released, or after `timeout` for providers
    /// that do not report releases.
    pub(super) fn wait(&self, timeout: Duration) -> bool {
        let releases = &self.releases;
        let deadline = Instant::now() + timeout;
        let mut counts = releases.counts.locked();
        let started = Instant::now();
        while counts.get(&self.id).copied().unwrap_or_default() == self.initial_release_count {
            let now = Instant::now();
            if now >= deadline {
                log::debug!("Hotkey {} was not reported released in time", self.id);
                return false;
            }
            counts = releases
                .changed
                .wait_timeout(counts, deadline - now)
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .0;
        }
        log::debug!(
            "Hotkey {} was released after {:?}",
            self.id,
            started.elapsed()
        );
        true
    }
}

/// Reported by the hotkey providers when the keys of a hotkey go up.
pub fn hotkey_released(id: &str) {
    hotkey_releases().released(id);
}

impl HotkeyReleases {
    fn released(&self, id: &str) {
        *self.counts.locked().entry(id.to_owned()).or_default() += 1;
        self.changed.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_is_local_to_the_pressed_hotkey_and_new_presses_ignore_old_releases() {
        let releases = Arc::new(HotkeyReleases::default());
        let press = HotkeyPress::with_releases("release", Arc::clone(&releases));
        releases.released("other");
        assert_eq!(releases.counts.lock().unwrap().get("release"), None);
        releases.released("release");
        assert!(press.wait(Duration::ZERO));
        let press = HotkeyPress::with_releases("release", Arc::clone(&releases));
        assert_eq!(press.initial_release_count, 1);
        // The timeout branch needs no wall-clock wait.
        assert!(!press.wait(Duration::ZERO));
        assert_eq!(releases.counts.lock().unwrap().get("release"), Some(&1));
    }
}
