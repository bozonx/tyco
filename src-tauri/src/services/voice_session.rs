use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

pub struct VoiceCaptureSession {
    /// Lets a stop request name the capture it belongs to, see
    /// `VoiceSessionState::take`.
    pub id: u64,
    pub stop_flag: Arc<AtomicBool>,
    pub thread: std::thread::JoinHandle<()>,
}

pub struct VoiceSessionState {
    session: Mutex<Option<VoiceCaptureSession>>,
    operation: tokio::sync::Mutex<()>,
    next_id: AtomicU64,
}
impl Default for VoiceSessionState {
    fn default() -> Self {
        Self {
            session: Mutex::new(None),
            operation: tokio::sync::Mutex::new(()),
            next_id: AtomicU64::new(1),
        }
    }
}
impl VoiceSessionState {
    pub fn replace(&self, session: Option<VoiceCaptureSession>) -> Option<VoiceCaptureSession> {
        let mut guard = self
            .session
            .lock()
            .expect("voice capture session lock poisoned");
        std::mem::replace(&mut *guard, session)
    }

    /// Takes the running capture if it is the one `id` names; `None` takes any.
    /// A late stop from a dictation that is over must not end the next one.
    pub fn take(&self, id: Option<u64>) -> Option<VoiceCaptureSession> {
        let mut guard = self
            .session
            .lock()
            .expect("voice capture session lock poisoned");
        match (id, guard.as_ref()) {
            (Some(id), Some(session)) if session.id != id => None,
            _ => guard.take(),
        }
    }

    pub fn next_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::SeqCst)
    }

    pub async fn lock(&self) -> tokio::sync::MutexGuard<'_, ()> {
        self.operation.lock().await
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
    fn a_stop_for_another_capture_leaves_the_running_one() {
        let state = VoiceSessionState::default();
        state.replace(Some(session(2)));

        assert!(state.take(Some(1)).is_none());
        let taken = state.take(Some(2)).unwrap();
        assert_eq!(taken.id, 2);
        assert!(state.take(None).is_none());
    }

    #[test]
    fn a_stop_without_an_id_takes_any_capture() {
        let state = VoiceSessionState::default();
        state.replace(Some(session(5)));

        assert_eq!(state.take(None).unwrap().id, 5);
    }

    #[test]
    fn capture_ids_are_unique() {
        let state = VoiceSessionState::default();
        assert_ne!(state.next_id(), state.next_id());
    }
    #[tokio::test]
    async fn capture_operations_are_serialized() {
        let state = VoiceSessionState::default();
        let operation = state.lock().await;
        assert!(state.operation.try_lock().is_err());
        drop(operation);
        assert!(state.operation.try_lock().is_ok());
    }
}
