//! Desktop notifications retain their sender until application shutdown.

use crate::errors::AppError;
use crate::services::background::StoppableService;
use std::time::Instant;

#[cfg(any(target_os = "linux", test))]
use crate::locks::MutexExt;
#[cfg(any(target_os = "linux", test))]
use std::sync::{Condvar, Mutex};

#[cfg(any(target_os = "linux", test))]
struct SenderState<C> {
    connection: Option<C>,
    busy: bool,
    stopped: bool,
}

/// Serializes sends without holding a lock across native calls. Shutdown
/// rejects queued sends immediately and shares the application's deadline.
#[cfg(any(target_os = "linux", test))]
struct PersistentSender<C> {
    state: Mutex<SenderState<C>>,
    changed: Condvar,
}

#[cfg(any(target_os = "linux", test))]
impl<C> Default for PersistentSender<C> {
    fn default() -> Self {
        Self {
            state: Mutex::new(SenderState {
                connection: None,
                busy: false,
                stopped: false,
            }),
            changed: Condvar::new(),
        }
    }
}

#[cfg(any(target_os = "linux", test))]
impl<C> PersistentSender<C> {
    fn send(
        &self,
        connect: impl FnOnce() -> Result<C, AppError>,
        send: impl FnOnce(&C) -> Result<(), AppError>,
    ) -> Result<(), AppError> {
        let mut state = self.state.locked();
        while state.busy && !state.stopped {
            state = self
                .changed
                .wait(state)
                .unwrap_or_else(std::sync::PoisonError::into_inner);
        }
        if state.stopped {
            return Err(AppError::ServiceUnavailable(
                "Notifications are shutting down".into(),
            ));
        }
        state.busy = true;
        let cached = state.connection.take();
        drop(state);
        let connection = cached.map_or_else(connect, Ok);
        let result = connection
            .as_ref()
            .map_err(|error| AppError::ServiceUnavailable(error.to_string()))
            .and_then(send);
        let mut state = self.state.locked();
        if result.is_ok() && !state.stopped {
            state.connection = connection.ok();
        }
        state.busy = false;
        self.changed.notify_all();
        result
    }
}

#[cfg(any(target_os = "linux", test))]
impl<C> StoppableService for PersistentSender<C> {
    fn stop(&self) {
        let mut state = self.state.locked();
        state.stopped = true;
        let connection = state.connection.take();
        self.changed.notify_all();
        drop(state);
        drop(connection);
    }

    fn wait_until(&self, deadline: Instant) -> bool {
        let mut state = self.state.locked();
        while state.busy {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return false;
            }
            state = self
                .changed
                .wait_timeout(state, remaining)
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .0;
        }
        true
    }
}

#[derive(Default)]
pub struct NotificationService {
    #[cfg(target_os = "linux")]
    sender: PersistentSender<zbus::blocking::Connection>,
}

impl NotificationService {
    #[cfg(target_os = "linux")]
    pub fn notify(&self, summary: &str, body: &str) -> Result<(), AppError> {
        use std::collections::HashMap;
        use std::time::Duration;
        use zbus::zvariant::Value;

        self.sender.send(
            || {
                zbus::blocking::connection::Builder::session()
                    .and_then(|builder| builder.method_timeout(Duration::from_secs(2)).build())
                    .map_err(|error| {
                        AppError::ServiceUnavailable(format!("No session bus: {error}"))
                    })
            },
            |connection| {
                let hints = HashMap::from([("desktop-entry", Value::from("com.tyco.app"))]);
                connection
                    .call_method(
                        Some("org.freedesktop.Notifications"),
                        "/org/freedesktop/Notifications",
                        Some("org.freedesktop.Notifications"),
                        "Notify",
                        &(
                            "Tyco",
                            0u32,
                            "com.tyco.app",
                            summary,
                            body,
                            Vec::<&str>::new(),
                            hints,
                            -1i32,
                        ),
                    )
                    .map_err(|error| {
                        AppError::Failed(format!("Could not show a notification: {error}"))
                    })?;
                Ok(())
            },
        )
    }

    #[cfg(not(target_os = "linux"))]
    pub fn notify(&self, _summary: &str, _body: &str) -> Result<(), AppError> {
        Ok(())
    }
}

impl StoppableService for NotificationService {
    fn stop(&self) {
        #[cfg(target_os = "linux")]
        self.sender.stop();
    }

    fn wait_until(&self, _deadline: Instant) -> bool {
        #[cfg(target_os = "linux")]
        return self.sender.wait_until(_deadline);
        #[cfg(not(target_os = "linux"))]
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    use std::time::Duration;

    struct Connection(Arc<AtomicUsize>);
    impl Drop for Connection {
        fn drop(&mut self) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
    }

    #[test]
    fn sender_survives_successful_calls_and_closes_on_shutdown() {
        let sender = PersistentSender::default();
        let closed = Arc::new(AtomicUsize::new(0));
        sender
            .send(|| Ok(Connection(closed.clone())), |_| Ok(()))
            .unwrap();
        sender
            .send(
                || panic!("A successful notification must retain its sender"),
                |_| Ok(()),
            )
            .unwrap();
        assert_eq!(closed.load(Ordering::SeqCst), 0);
        sender.stop();
        assert_eq!(closed.load(Ordering::SeqCst), 1);
        assert!(sender
            .send(|| panic!("Shutdown must reject new work"), |_| Ok(()))
            .is_err());
    }

    #[test]
    fn a_failed_send_is_not_replayed_and_the_next_request_can_reconnect() {
        let sender = PersistentSender::default();
        let closed = Arc::new(AtomicUsize::new(0));
        let result = sender.send(
            || Ok(Connection(closed.clone())),
            |_| Err(AppError::Failed("Bus disconnected".into())),
        );
        assert!(result.is_err());
        assert_eq!(closed.load(Ordering::SeqCst), 1);
        sender
            .send(|| Ok(Connection(closed.clone())), |_| Ok(()))
            .unwrap();
        assert_eq!(closed.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn stopping_an_inflight_send_is_nonblocking_and_keeps_the_deadline() {
        let sender = Arc::new(PersistentSender::default());
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let (finish_tx, finish_rx) = std::sync::mpsc::channel();
        let worker_sender = sender.clone();
        let worker = std::thread::spawn(move || {
            worker_sender.send(
                || Ok(()),
                |_| {
                    started_tx.send(()).unwrap();
                    finish_rx.recv().unwrap();
                    Ok(())
                },
            )
        });
        started_rx.recv().unwrap();
        sender.stop();
        assert!(!sender.wait_until(Instant::now()));
        finish_tx.send(()).unwrap();
        assert!(worker.join().unwrap().is_ok());
        assert!(sender.wait_until(Instant::now() + Duration::from_secs(1)));
    }
}
