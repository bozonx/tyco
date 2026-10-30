#[test]
fn capture_info_preserves_the_frontend_wire_names() {
    let info = super::VoiceCaptureInfo {
        sample_rate_hz: 16_000,
        session_id: 7,
    };
    assert_eq!(
        serde_json::to_value(info).unwrap(),
        serde_json::json!({"sampleRate": 16_000, "sessionId": 7})
    );
}

use super::*;

#[derive(Default)]
struct RecordingSink {
    chunks: Mutex<Vec<Vec<u8>>>,
    events: Mutex<Vec<String>>,
    closed: bool,
}

impl EventSink for RecordingSink {
    fn send_event<T: Serialize>(&self, event: &T) -> bool {
        self.events
            .lock()
            .unwrap()
            .push(serde_json::to_string(event).unwrap());
        !self.closed
    }

    fn send_bytes(&self, bytes: Vec<u8>) -> bool {
        self.chunks.lock().unwrap().push(bytes);
        !self.closed
    }
}

#[derive(Clone, Default)]
struct Trace(Arc<Mutex<Vec<String>>>);

impl Trace {
    fn push(&self, value: impl Into<String>) {
        self.0.lock().unwrap().push(value.into());
    }
    fn values(&self) -> Vec<String> {
        self.0.lock().unwrap().clone()
    }
}

impl AudioLevelSink for Trace {
    fn publish(&self, payload: VoiceAudioLevelPayload) {
        self.push(format!("level:{}", payload.level));
    }
}

impl EventSink for Trace {
    fn send_event<T: Serialize>(&self, event: &T) -> bool {
        self.push(serde_json::to_string(event).unwrap());
        true
    }
    fn send_bytes(&self, bytes: Vec<u8>) -> bool {
        self.push(format!("bytes:{}", bytes.len()));
        true
    }
}

struct TestStream {
    pending_pcm_samples: Arc<Mutex<Vec<i16>>>,
    trace: Trace,
}

impl Drop for TestStream {
    fn drop(&mut self) {
        self.trace.push("drop-stream");
        // Simulate the last callback completing when the stream shuts down.
        self.pending_pcm_samples.lock().unwrap().push(7);
    }
}

#[derive(Default)]
struct TestSource {
    trace: Trace,
    fail: bool,
    stop_on_open: bool,
    stream_error: Option<String>,
}

impl AudioSource for TestSource {
    type Stream = TestStream;
    fn open(&self, stop_flag: &Arc<AtomicBool>) -> Result<OpenedCapture<TestStream>, AppError> {
        self.trace.push("open");
        if self.fail {
            return Err(AppError::Failed("device unavailable".into()));
        }
        stop_flag.store(self.stop_on_open, Ordering::SeqCst);
        let pending_pcm_samples = Arc::new(Mutex::new(vec![1; 1600]));
        Ok(OpenedCapture {
            stream: TestStream {
                pending_pcm_samples: Arc::clone(&pending_pcm_samples),
                trace: self.trace.clone(),
            },
            output_sample_rate_hz: TARGET_SAMPLE_RATE_HZ,
            context: StreamContext {
                pending_pcm_samples,
                stream_error: Arc::new(Mutex::new(self.stream_error.clone())),
                current_level: Arc::new(Mutex::new((0.5, 0.75))),
                callback_count: Arc::new(AtomicU64::new(0)),
                stop_flag: Arc::clone(stop_flag),
                device_sample_rate_hz: TARGET_SAMPLE_RATE_HZ,
                output_sample_rate_hz: TARGET_SAMPLE_RATE_HZ,
            },
        })
    }
}

struct TestRuntime {
    now: std::cell::Cell<Instant>,
    stop: Arc<AtomicBool>,
}

impl MonotonicClock for TestRuntime {
    fn now(&self) -> Instant {
        self.now.get()
    }
    fn sleep(&self, _duration: Duration) {
        self.now.set(self.now.get() + LEVEL_INTERVAL);
        self.stop.store(true, Ordering::SeqCst);
    }
}

#[test]
fn stream_stops_before_final_samples_and_end_and_resets_the_audio_level() {
    let trace = Trace::default();
    let source = TestSource {
        trace: trace.clone(),
        ..TestSource::default()
    };
    let stop = Arc::new(AtomicBool::new(false));
    let runtime = TestRuntime {
        now: std::cell::Cell::new(Instant::now()),
        stop: Arc::clone(&stop),
    };
    let (tx, rx) = std_mpsc::sync_channel(1);
    run_capture_thread(&source, &trace, &runtime, &trace, &stop, &tx).unwrap();
    assert_eq!(rx.try_recv().unwrap().unwrap(), TARGET_SAMPLE_RATE_HZ);
    assert_eq!(
        trace.values(),
        [
            "open",
            "bytes:3200",
            "level:0.5",
            "drop-stream",
            "level:0",
            "bytes:2",
            r#"{"type":"end"}"#
        ]
    );
}

#[test]
fn stream_failure_emits_error_instead_of_final_audio_and_end() {
    let trace = Trace::default();
    let source = TestSource {
        trace: trace.clone(),
        stop_on_open: true,
        stream_error: Some("stream failed".into()),
        ..TestSource::default()
    };
    let stop = Arc::new(AtomicBool::new(false));
    let runtime = TestRuntime {
        now: std::cell::Cell::new(Instant::now()),
        stop: Arc::clone(&stop),
    };
    let (tx, _rx) = std_mpsc::sync_channel(1);
    run_capture_thread(&source, &trace, &runtime, &trace, &stop, &tx).unwrap();
    assert_eq!(
        trace.values(),
        [
            "open",
            "drop-stream",
            "level:0",
            r#"{"type":"error","message":"stream failed"}"#
        ]
    );
}

#[test]
fn a_device_that_stops_callbacks_emits_error_and_releases_the_stream() {
    struct StalledRuntime(std::cell::Cell<Instant>);
    impl MonotonicClock for StalledRuntime {
        fn now(&self) -> Instant {
            self.0.get()
        }
        fn sleep(&self, _duration: Duration) {
            self.0.set(self.0.get() + CALLBACK_TIMEOUT);
        }
    }
    let trace = Trace::default();
    let source = TestSource {
        trace: trace.clone(),
        ..TestSource::default()
    };
    let stop = Arc::new(AtomicBool::new(false));
    let (tx, _rx) = std_mpsc::sync_channel(1);
    run_capture_thread(
        &source,
        &trace,
        &StalledRuntime(std::cell::Cell::new(Instant::now())),
        &trace,
        &stop,
        &tx,
    )
    .unwrap();
    assert!(stop.load(Ordering::SeqCst));
    assert_eq!(
        trace.values(),
        [
            "open",
            "drop-stream",
            "level:0",
            r#"{"type":"error","message":"Audio input stopped delivering samples"}"#
        ]
    );
}

#[test]
fn recurring_callbacks_keep_capture_alive_even_when_samples_are_silent() {
    struct SilentSource(Arc<AtomicU64>);
    impl AudioSource for SilentSource {
        type Stream = TestStream;
        fn open(&self, stop: &Arc<AtomicBool>) -> Result<OpenedCapture<TestStream>, AppError> {
            let mut opened = TestSource::default().open(stop)?;
            opened.context.callback_count = Arc::clone(&self.0);
            opened.context.pending_pcm_samples.locked().fill(0);
            Ok(opened)
        }
    }
    struct SilentRuntime {
        now: std::cell::Cell<Instant>,
        callbacks: Arc<AtomicU64>,
        stop: Arc<AtomicBool>,
    }
    impl MonotonicClock for SilentRuntime {
        fn now(&self) -> Instant {
            self.now.get()
        }
        fn sleep(&self, _duration: Duration) {
            self.now.set(self.now.get() + CALLBACK_TIMEOUT);
            if self.callbacks.fetch_add(1, Ordering::Relaxed) == 3 {
                self.stop.store(true, Ordering::SeqCst);
            }
        }
    }
    let callbacks = Arc::new(AtomicU64::new(0));
    let stop = Arc::new(AtomicBool::new(false));
    let runtime = SilentRuntime {
        now: std::cell::Cell::new(Instant::now()),
        callbacks: Arc::clone(&callbacks),
        stop: Arc::clone(&stop),
    };
    let sink = RecordingSink::default();
    let (tx, _rx) = std_mpsc::sync_channel(1);
    run_capture_thread(
        &SilentSource(callbacks),
        &Trace::default(),
        &runtime,
        &sink,
        &stop,
        &tx,
    )
    .unwrap();
    assert_eq!(*sink.events.locked(), [r#"{"type":"end"}"#]);
    assert!(sink.chunks.locked()[0].iter().all(|byte| *byte == 0));
}

#[test]
fn a_closed_listener_stops_capture_without_sending_end() {
    let trace = Trace::default();
    let source = TestSource {
        trace: trace.clone(),
        ..TestSource::default()
    };
    let sink = RecordingSink {
        closed: true,
        ..RecordingSink::default()
    };
    let stop = Arc::new(AtomicBool::new(false));
    let runtime = TestRuntime {
        now: std::cell::Cell::new(Instant::now()),
        stop: Arc::clone(&stop),
    };
    let (tx, _rx) = std_mpsc::sync_channel(1);
    run_capture_thread(&source, &trace, &runtime, &sink, &stop, &tx).unwrap();
    assert!(stop.load(Ordering::SeqCst));
    assert!(sink.events.lock().unwrap().is_empty());
    assert_eq!(trace.values(), ["open", "drop-stream", "level:0"]);
}

#[test]
fn device_setup_errors_are_returned_without_a_tauri_runtime() {
    let source = TestSource {
        fail: true,
        ..TestSource::default()
    };
    let error = create_capture_session(
        source,
        Trace::default(),
        Trace::default(),
        1,
        Duration::from_secs(1),
    )
    .err()
    .unwrap();
    assert_eq!(error.to_string(), "device unavailable");
}

#[test]
fn setup_timeout_signals_stop_without_joining_a_blocked_device() {
    struct BlockedSource {
        release: Mutex<std_mpsc::Receiver<()>>,
        done: std_mpsc::Sender<bool>,
    }
    impl AudioSource for BlockedSource {
        type Stream = ();
        fn open(&self, stop: &Arc<AtomicBool>) -> Result<OpenedCapture<()>, AppError> {
            self.release.lock().unwrap().recv().unwrap();
            self.done.send(stop.load(Ordering::SeqCst)).unwrap();
            Err(AppError::Failed("device released".into()))
        }
    }
    let (release_tx, release_rx) = std_mpsc::channel();
    let (done_tx, done_rx) = std_mpsc::channel();
    let source = BlockedSource {
        release: Mutex::new(release_rx),
        done: done_tx,
    };
    let error = create_capture_session(
        source,
        Trace::default(),
        Trace::default(),
        1,
        Duration::ZERO,
    )
    .err()
    .unwrap();
    assert!(error.to_string().contains("did not start in time"));
    release_tx.send(()).unwrap();
    assert!(done_rx.recv_timeout(Duration::from_secs(1)).unwrap());
}

#[tokio::test]
async fn new_capture_replaces_the_old_one_and_a_stale_stop_leaves_it_running() {
    let state = VoiceSessionState::default();
    let trace = Trace::default();
    let first = start_capture_with(
        TestSource {
            stop_on_open: true,
            trace: trace.clone(),
            ..TestSource::default()
        },
        trace.clone(),
        &state,
        trace.clone(),
    )
    .await
    .unwrap();
    let second = start_capture_with(
        TestSource {
            stop_on_open: true,
            trace: trace.clone(),
            ..TestSource::default()
        },
        trace.clone(),
        &state,
        trace.clone(),
    )
    .await
    .unwrap();
    assert_ne!(first.session_id, second.session_id);
    stop_capture(&state, Some(first.session_id)).await.unwrap();
    let session = state
        .take(Some(second.session_id))
        .expect("new capture was stopped");
    assert!(state.install(session).is_ok());
    stop_capture(&state, Some(second.session_id)).await.unwrap();
    assert!(state.take(None).is_none());
    let values = trace.values();
    let second_open = values
        .iter()
        .enumerate()
        .filter(|(_, value)| *value == "open")
        .nth(1)
        .unwrap()
        .0;
    let first_end = values
        .iter()
        .position(|value| value == r#"{"type":"end"}"#)
        .unwrap();
    assert!(
        first_end < second_open,
        "old capture must finish before the new device opens"
    );
}

#[test]
fn flushes_only_full_chunks_until_forced() {
    let sink = RecordingSink::default();
    let pending_pcm_samples = Mutex::new(vec![1_i16, 2, 3]);

    assert!(flush_pending(&pending_pcm_samples, &sink, 4));
    assert!(sink.chunks.lock().unwrap().is_empty());

    assert!(flush_pending(&pending_pcm_samples, &sink, 1));
    assert_eq!(sink.chunks.lock().unwrap().len(), 1);
    assert!(pending_pcm_samples.lock().unwrap().is_empty());

    // nothing left: no empty frame goes out
    assert!(flush_pending(&pending_pcm_samples, &sink, 1));
    assert_eq!(sink.chunks.lock().unwrap().len(), 1);
}

#[test]
fn reports_a_gone_listener() {
    let sink = RecordingSink {
        closed: true,
        ..RecordingSink::default()
    };
    assert!(!flush_pending(&Mutex::new(vec![1_i16]), &sink, 1));
}

#[test]
fn serializes_control_events() {
    assert_eq!(
        serde_json::to_string(&CaptureEvent::End).unwrap(),
        r#"{"type":"end"}"#
    );
    assert_eq!(
        serde_json::to_string(&CaptureEvent::Error {
            message: "boom".into()
        })
        .unwrap(),
        r#"{"type":"error","message":"boom"}"#
    );
}
