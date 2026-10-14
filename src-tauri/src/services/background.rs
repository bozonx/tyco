//! Application-owned tasks share cancellation and a bounded shutdown barrier.
use std::future::Future;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use crate::errors::AppError;

#[derive(Clone)]
pub struct StopToken(Arc<StopState>);
struct StopState {
    stopped: Mutex<bool>,
    changed: Condvar,
    async_changed: tokio::sync::watch::Sender<bool>,
}
impl Default for StopToken {
    fn default() -> Self {
        Self(Arc::new(StopState {
            stopped: Mutex::new(false),
            changed: Condvar::new(),
            async_changed: tokio::sync::watch::channel(false).0,
        }))
    }
}
impl StopToken {
    pub fn is_stopped(&self) -> bool {
        *self.0.stopped.lock().expect("stop token lock poisoned")
    }
    pub fn stop(&self) {
        *self.0.stopped.lock().expect("stop token lock poisoned") = true;
        self.0.async_changed.send_replace(true);
        self.0.changed.notify_all();
    }
    /// Returns true on cancellation; retry delays can be interrupted.
    pub fn wait(&self, duration: Duration) -> bool {
        let stopped = self.0.stopped.lock().expect("stop token lock poisoned");
        *self
            .0
            .changed
            .wait_timeout_while(stopped, duration, |stopped| !*stopped)
            .expect("stop token lock poisoned")
            .0
    }
    pub async fn cancelled(&self) {
        let mut receiver = self.0.async_changed.subscribe();
        while !*receiver.borrow_and_update() {
            if receiver.changed().await.is_err() {
                return;
            }
        }
    }
}

#[derive(Default)]
struct Tasks {
    is_stopping: bool,
    active_count: usize,
}
#[derive(Default)]
struct TaskBarrier {
    tasks: Mutex<Tasks>,
    changed: Condvar,
}
pub(crate) struct TaskLease(Arc<TaskBarrier>);
impl Drop for TaskLease {
    fn drop(&mut self) {
        let mut tasks = self.0.tasks.lock().expect("background tasks lock poisoned");
        tasks.active_count -= 1;
        self.0.changed.notify_all();
    }
}

#[derive(Default)]
pub struct BackgroundServices {
    shutdown_started: std::sync::atomic::AtomicBool,
    stop: StopToken,
    barrier: Arc<TaskBarrier>,
}
impl BackgroundServices {
    pub fn begin_shutdown(&self) -> bool {
        !self
            .shutdown_started
            .swap(true, std::sync::atomic::Ordering::SeqCst)
    }
    pub fn token(&self) -> StopToken {
        self.stop.clone()
    }
    pub(crate) fn register(&self) -> Result<TaskLease, AppError> {
        let mut tasks = self
            .barrier
            .tasks
            .lock()
            .expect("background tasks lock poisoned");
        if tasks.is_stopping {
            return Err(AppError::ServiceUnavailable(
                "Background services are stopping".into(),
            ));
        }
        tasks.active_count += 1;
        Ok(TaskLease(self.barrier.clone()))
    }
    pub fn spawn_thread(
        &self,
        name: &'static str,
        run: impl FnOnce(StopToken) + Send + 'static,
    ) -> Result<(), AppError> {
        let lease = self.register()?;
        let stop = self.token();
        std::thread::Builder::new()
            .name(name.into())
            .spawn(move || {
                let _lease = lease;
                run(stop);
            })?;
        Ok(())
    }
    /// The lease belongs to the blocking closure, even if its caller is cancelled.
    pub async fn run_blocking<T: Send + 'static>(
        &self,
        run: impl FnOnce() -> T + Send + 'static,
    ) -> Result<T, AppError> {
        let lease = self.register()?;
        tauri::async_runtime::spawn_blocking(move || {
            let _lease = lease;
            run()
        })
        .await
        .map_err(|error| AppError::Message(error.to_string()))
    }
    pub fn spawn_async(
        &self,
        run: impl Future<Output = ()> + Send + 'static,
    ) -> Result<(), AppError> {
        let lease = self.register()?;
        let stop = self.token();
        tauri::async_runtime::spawn(async move {
            let _lease = lease;
            tokio::select! {
                biased;
                _ = stop.cancelled() => {}
                _ = run => {}
            }
        });
        Ok(())
    }
    pub fn stop(&self) {
        self.barrier
            .tasks
            .lock()
            .expect("background tasks lock poisoned")
            .is_stopping = true;
        self.stop.stop();
    }
    pub fn wait_until(&self, deadline: Instant) -> bool {
        let tasks = self
            .barrier
            .tasks
            .lock()
            .expect("background tasks lock poisoned");
        let remaining = deadline.saturating_duration_since(Instant::now());
        self.barrier
            .changed
            .wait_timeout_while(tasks, remaining, |tasks| tasks.active_count != 0)
            .expect("background tasks lock poisoned")
            .0
            .active_count
            == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stop_interrupts_threads_and_rejects_new_work() {
        let services = BackgroundServices::default();
        services
            .spawn_thread("test-service", |stop| {
                assert!(stop.wait(Duration::from_secs(60)));
            })
            .unwrap();
        services.stop();
        assert!(services.wait_until(Instant::now() + Duration::from_secs(1)));
        assert!(matches!(
            services.spawn_thread("late-service", |_| {}),
            Err(AppError::ServiceUnavailable(_))
        ));
    }
    #[tokio::test]
    async fn cancellation_is_visible_before_and_after_subscription() {
        let stop = StopToken::default();
        let waiting = stop.cancelled();
        stop.stop();
        tokio::time::timeout(Duration::from_secs(1), waiting)
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(1), stop.cancelled())
            .await
            .unwrap();
    }
    #[test]
    fn bounded_wait_reports_an_uncooperative_service() {
        let services = BackgroundServices::default();
        let lease = services.register().unwrap();
        services.stop();
        assert!(!services.wait_until(Instant::now()));
        drop(lease);
        assert!(services.wait_until(Instant::now()));
    }
    #[tokio::test]
    async fn cancelling_a_caller_keeps_its_blocking_work_in_the_shutdown_barrier() {
        let services = Arc::new(BackgroundServices::default());
        let (started, ready) = tokio::sync::oneshot::channel();
        let (release, waiting) = std::sync::mpsc::channel();
        let task_services = services.clone();
        let task = tokio::spawn(async move {
            task_services
                .run_blocking(move || {
                    let _ = started.send(());
                    let _ = waiting.recv();
                })
                .await
        });
        ready.await.unwrap();
        task.abort();
        let _ = task.await;
        services.stop();
        assert!(!services.wait_until(Instant::now()));
        release.send(()).unwrap();
        assert!(services.wait_until(Instant::now() + Duration::from_secs(1)));
    }

    #[tokio::test]
    async fn stopped_async_service_drops_its_resources() {
        let services = BackgroundServices::default();
        let (sender, receiver) = tokio::sync::oneshot::channel::<()>();
        services
            .spawn_async(async move {
                let _sender = sender;
                std::future::pending::<()>().await;
            })
            .unwrap();
        services.stop();
        assert!(tokio::time::timeout(Duration::from_secs(1), receiver)
            .await
            .unwrap()
            .is_err());
    }
}
