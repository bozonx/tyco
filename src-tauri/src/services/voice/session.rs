use crate::locks::MutexExt;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

pub struct VoiceCaptureSession {
    /// Lets a stop request name the capture it belongs to, see
    /// `VoiceSessionState::take`.
    pub id: u64,
    pub stop_flag: Arc<AtomicBool>,
    pub thread: std::thread::JoinHandle<()>,
}

impl VoiceCaptureSession {
    pub fn stop_until(self, deadline: std::time::Instant) -> Result<(), crate::errors::AppError> {
        self.stop_flag.store(true, Ordering::SeqCst);
        while !self.thread.is_finished() {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            if remaining.is_zero() {
                return Err(crate::errors::AppError::ServiceUnavailable(
                    "Voice capture stop deadline expired".into(),
                ));
            }
            std::thread::sleep(remaining.min(std::time::Duration::from_millis(5)));
        }
        self.thread
            .join()
            .map_err(|_| crate::errors::AppError::Message("Voice capture thread panicked".into()))
    }
}

#[derive(Default)]
struct CaptureState {
    is_stopping: bool,
    session: Option<VoiceCaptureSession>,
}

pub struct VoiceSessionState {
    session: Mutex<CaptureState>,
    capture_operation_lock: tokio::sync::Mutex<()>,
    next_id: AtomicU64,
}
impl Default for VoiceSessionState {
    fn default() -> Self {
        Self {
            session: Mutex::new(CaptureState::default()),
            capture_operation_lock: tokio::sync::Mutex::new(()),
            next_id: AtomicU64::new(1),
        }
    }
}
impl VoiceSessionState {
    pub fn can_start(&self) -> bool {
        !self.session.locked().is_stopping
    }

    /// Recheck under the shutdown lock after potentially slow device setup.
    pub fn install(&self, session: VoiceCaptureSession) -> Result<(), VoiceCaptureSession> {
        let mut guard = self.session.locked();
        if guard.is_stopping || guard.session.is_some() {
            return Err(session);
        }
        guard.session = Some(session);
        Ok(())
    }

    pub fn shutdown(&self) -> Option<VoiceCaptureSession> {
        let mut guard = self.session.locked();
        guard.is_stopping = true;
        guard.session.take()
    }

    /// Takes the running capture if it is the one `id` names; `None` takes any.
    /// A late stop from a dictation that is over must not end the next one.
    pub fn take(&self, id: Option<u64>) -> Option<VoiceCaptureSession> {
        let mut guard = self.session.locked();
        match (id, guard.session.as_ref()) {
            (Some(id), Some(session)) if session.id != id => None,
            _ => guard.session.take(),
        }
    }

    pub fn allocate_session_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::SeqCst)
    }

    pub async fn lock_capture_operation(&self) -> tokio::sync::MutexGuard<'_, ()> {
        self.capture_operation_lock.lock().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(id: u64) -> VoiceCaptureSession {
        VoiceCaptureSession {
            id,
            stop_flag: Arc::new(AtomicBool::new(false)),
            thread: std::thread::spawn(|| {}),
        }
    }

    #[test]
    fn shutdown_rejects_a_capture_whose_setup_finished_late() {
        let state = VoiceSessionState::default();
        assert!(state.install(session(1)).is_ok());
        let active = state.shutdown().unwrap();
        assert!(!state.can_start());
        let rejected = state.install(session(2)).err().unwrap();
        rejected
            .stop_until(std::time::Instant::now() + std::time::Duration::from_secs(1))
            .unwrap();
        active
            .stop_until(std::time::Instant::now() + std::time::Duration::from_secs(1))
            .unwrap();
        assert!(state.take(None).is_none());
    }

    #[test]
    fn stalled_audio_worker_cannot_exceed_the_stop_deadline() {
        let (release, waiting) = std::sync::mpsc::channel();
        let stop_flag = Arc::new(AtomicBool::new(false));
        let capture = VoiceCaptureSession {
            id: 1,
            stop_flag: stop_flag.clone(),
            thread: std::thread::spawn(move || {
                let _ = waiting.recv();
            }),
        };
        assert!(capture.stop_until(std::time::Instant::now()).is_err());
        assert!(stop_flag.load(Ordering::SeqCst));
        release.send(()).unwrap();
    }

    #[test]
    fn a_stop_for_another_capture_leaves_the_running_one() {
        let state = VoiceSessionState::default();
        assert!(state.install(session(2)).is_ok());

        assert!(state.take(Some(1)).is_none());
        let taken = state.take(Some(2)).unwrap();
        assert_eq!(taken.id, 2);
        assert!(state.take(None).is_none());
    }

    #[test]
    fn a_stop_without_an_id_takes_any_capture() {
        let state = VoiceSessionState::default();
        assert!(state.install(session(5)).is_ok());

        assert_eq!(state.take(None).unwrap().id, 5);
    }

    #[test]
    fn capture_ids_are_unique() {
        let state = VoiceSessionState::default();
        assert_ne!(state.allocate_session_id(), state.allocate_session_id());
    }
    #[tokio::test]
    async fn capture_operations_are_serialized() {
        let state = VoiceSessionState::default();
        let capture_operation_lock = state.lock_capture_operation().await;
        assert!(state.capture_operation_lock.try_lock().is_err());
        drop(capture_operation_lock);
        assert!(state.capture_operation_lock.try_lock().is_ok());
    }
}
