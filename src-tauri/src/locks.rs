//! Locks that do not report poisoning. A release build aborts on a panic
//! (`panic = "abort"`), so no lock is ever left poisoned there; a test that
//! panicked while holding one fails on its own.
use std::sync::{
    Condvar, Mutex, MutexGuard, PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard,
    WaitTimeoutResult,
};
use std::time::{Duration, Instant};

pub trait MutexExt<T: ?Sized> {
    fn locked(&self) -> MutexGuard<'_, T>;
}

impl<T: ?Sized> MutexExt<T> for Mutex<T> {
    fn locked(&self) -> MutexGuard<'_, T> {
        self.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

pub trait RwLockExt<T: ?Sized> {
    fn read_locked(&self) -> RwLockReadGuard<'_, T>;
    fn write_locked(&self) -> RwLockWriteGuard<'_, T>;
}

impl<T: ?Sized> RwLockExt<T> for RwLock<T> {
    fn read_locked(&self) -> RwLockReadGuard<'_, T> {
        self.read().unwrap_or_else(PoisonError::into_inner)
    }

    fn write_locked(&self) -> RwLockWriteGuard<'_, T> {
        self.write().unwrap_or_else(PoisonError::into_inner)
    }
}

pub trait CondvarExt {
    fn wait_locked<'a, T>(&self, guard: MutexGuard<'a, T>) -> MutexGuard<'a, T>;
    fn wait_timeout_locked<'a, T>(
        &self,
        guard: MutexGuard<'a, T>,
        timeout: Duration,
    ) -> (MutexGuard<'a, T>, WaitTimeoutResult);
    fn wait_timeout_while_locked<'a, T>(
        &self,
        guard: MutexGuard<'a, T>,
        timeout: Duration,
        condition: impl FnMut(&mut T) -> bool,
    ) -> (MutexGuard<'a, T>, WaitTimeoutResult);
    /// Waits while `condition` holds, but not past `deadline`; true when the
    /// condition cleared in time.
    fn wait_while_until<T>(
        &self,
        guard: MutexGuard<'_, T>,
        deadline: Instant,
        condition: impl FnMut(&mut T) -> bool,
    ) -> bool {
        let remaining = deadline.saturating_duration_since(Instant::now());
        !self
            .wait_timeout_while_locked(guard, remaining, condition)
            .1
            .timed_out()
    }
}

impl CondvarExt for Condvar {
    fn wait_locked<'a, T>(&self, guard: MutexGuard<'a, T>) -> MutexGuard<'a, T> {
        self.wait(guard).unwrap_or_else(PoisonError::into_inner)
    }

    fn wait_timeout_locked<'a, T>(
        &self,
        guard: MutexGuard<'a, T>,
        timeout: Duration,
    ) -> (MutexGuard<'a, T>, WaitTimeoutResult) {
        self.wait_timeout(guard, timeout)
            .unwrap_or_else(PoisonError::into_inner)
    }

    fn wait_timeout_while_locked<'a, T>(
        &self,
        guard: MutexGuard<'a, T>,
        timeout: Duration,
        condition: impl FnMut(&mut T) -> bool,
    ) -> (MutexGuard<'a, T>, WaitTimeoutResult) {
        self.wait_timeout_while(guard, timeout, condition)
            .unwrap_or_else(PoisonError::into_inner)
    }
}
