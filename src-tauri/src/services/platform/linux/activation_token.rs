//! Activation tokens. A Wayland compositor hands the focus only to a window
//! that presents a token of `xdg-activation-v1`, which the source of the
//! user's action got: the hotkey portal, or the launcher that started
//! `tyco-ctl` (`XDG_ACTIVATION_TOKEN`). The request that brings one shows a
//! window right after, so the token waits here for that, briefly: it is good
//! for one activation, and a stale one would only be refused.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::locks::MutexExt;

/// How long a token waits for the window it was meant for.
const LIFETIME: Duration = Duration::from_secs(5);

static PENDING: Mutex<Option<(String, Instant)>> = Mutex::new(None);

/// Keeps `token` for the window shown next.
pub fn offer(token: String) {
    *PENDING.locked() = Some((token, Instant::now()));
}

/// The token for the window shown now, if one came in a moment ago.
pub fn take() -> Option<String> {
    take_at(&mut PENDING.locked(), Instant::now())
}

fn take_at(pending: &mut Option<(String, Instant)>, now: Instant) -> Option<String> {
    let (token, offered_at) = pending.take()?;
    (now.saturating_duration_since(offered_at) <= LIFETIME).then_some(token)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_token_serves_one_window_and_only_for_a_moment() {
        let start = Instant::now();
        let mut pending = Some((String::from("token"), start));
        assert_eq!(take_at(&mut pending, start).as_deref(), Some("token"));
        assert_eq!(take_at(&mut pending, start), None);
        let mut pending = Some((String::from("old"), start));
        assert_eq!(take_at(&mut pending, start + LIFETIME * 2), None);
        assert_eq!(pending, None);
    }
}
