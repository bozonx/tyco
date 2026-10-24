//! How long the long-lived connections of the Linux backends wait before they
//! try again.

use std::time::Duration;

/// A wait that doubles with each failure in a row, from `first` up to `max`.
#[derive(Clone, Copy)]
pub(super) struct Backoff {
    pub first: Duration,
    pub max: Duration,
}

impl Backoff {
    pub(super) const fn new(first: Duration, max: Duration) -> Self {
        Self { first, max }
    }

    /// The wait after `failures` failures in a row; the first one waits `first`.
    pub(super) fn delay(self, failures: u32) -> Duration {
        self.first
            .saturating_mul(2u32.saturating_pow(failures.saturating_sub(1)))
            .min(self.max)
    }
}

/// Reconnecting to the display server: the X11 window watcher and the
/// primary-selection watcher.
pub(super) const DISPLAY_RECONNECT: Backoff =
    Backoff::new(Duration::from_secs(2), Duration::from_secs(60));

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn doubles_from_the_first_wait_up_to_the_cap() {
        let backoff = Backoff::new(Duration::from_secs(5), Duration::from_secs(120));
        assert_eq!(backoff.delay(0), backoff.first);
        assert_eq!(backoff.delay(1), backoff.first);
        assert_eq!(backoff.delay(2), backoff.first * 2);
        assert_eq!(backoff.delay(3), backoff.first * 4);
        assert_eq!(backoff.delay(40), backoff.max);
    }
}
