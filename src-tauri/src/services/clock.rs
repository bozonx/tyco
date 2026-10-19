//! Wall-clock time since the Unix epoch. A clock set before 1970 reads as
//! zero rather than failing: timestamps and unique names need no error path.
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub fn since_epoch() -> Duration {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
}

pub fn now_ms() -> u64 {
    u64::try_from(since_epoch().as_millis()).unwrap_or(u64::MAX)
}

pub fn now_ns() -> u128 {
    since_epoch().as_nanos()
}
