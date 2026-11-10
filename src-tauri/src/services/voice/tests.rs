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

/// The capture loop of a microphone that nobody switches.
fn run_capture<A: AudioSource, L: AudioLevelSink, S: EventSink>(
    source: &A,
    levels: &L,
    clock: &impl MonotonicClock,
    sink: &S,
    stop_flag: &Arc<AtomicBool>,
    superseded: &AtomicBool,
    setup_tx: &std_mpsc::SyncSender<Result<u32, AppError>>,
) -> Result<(), AppError> {
    let switch = SourceSwitchSlot::default();
    let control = CaptureControl {
        stop_flag,
        superseded,
        switch: &switch,
    };
    run_capture_thread(
        source,
        CaptureSource::Microphone,
        levels,
        clock,
        sink,
        &control,
        setup_tx,
    )
}

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
    fn open(
        &self,
        _source: &CaptureSource,
        stop_flag: &Arc<AtomicBool>,
    ) -> Result<OpenedCapture<TestStream>, AppError> {
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
                recoverable_error: Arc::new(Mutex::new(None)),
                current_level: Arc::new(Mutex::new((0.5, 0.75))),
                callback_count: Arc::new(AtomicU64::new(0)),
                stop_flag: Arc::clone(stop_flag),
                device_sample_rate_hz: TARGET_SAMPLE_RATE_HZ,
                output_sample_rate_hz: TARGET_SAMPLE_RATE_HZ,
                fills_gaps: false,
                status: Arc::default(),
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
    run_capture(
        &source,
        &trace,
        &runtime,
        &trace,
        &stop,
        &AtomicBool::new(false),
        &tx,
    )
    .unwrap();
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
fn stream_failure_sends_the_final_audio_then_an_error_instead_of_end() {
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
    run_capture(
        &source,
        &trace,
        &runtime,
        &trace,
        &stop,
        &AtomicBool::new(false),
        &tx,
    )
    .unwrap();
    assert_eq!(
        trace.values(),
        [
            "open",
            "drop-stream",
            "level:0",
            "bytes:3202",
            r#"{"type":"error","message":"stream failed"}"#
        ]
    );
}

#[test]
fn a_superseded_capture_sends_its_final_audio_then_superseded() {
    let trace = Trace::default();
    let source = TestSource {
        trace: trace.clone(),
        stop_on_open: true,
        ..TestSource::default()
    };
    let stop = Arc::new(AtomicBool::new(false));
    let runtime = TestRuntime {
        now: std::cell::Cell::new(Instant::now()),
        stop: Arc::clone(&stop),
    };
    let (tx, _rx) = std_mpsc::sync_channel(1);
    run_capture(
        &source,
        &trace,
        &runtime,
        &trace,
        &stop,
        &AtomicBool::new(true),
        &tx,
    )
    .unwrap();
    assert_eq!(
        trace.values(),
        [
            "open",
            "drop-stream",
            "level:0",
            "bytes:3202",
            r#"{"type":"superseded"}"#
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
    run_capture(
        &source,
        &trace,
        &StalledRuntime(std::cell::Cell::new(Instant::now())),
        &trace,
        &stop,
        &AtomicBool::new(false),
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
            "bytes:3202",
            r#"{"type":"error","message":"Audio input stopped delivering samples"}"#
        ]
    );
}

#[test]
fn recurring_callbacks_keep_capture_alive_even_when_samples_are_silent() {
    struct SilentSource(Arc<AtomicU64>);
    impl AudioSource for SilentSource {
        type Stream = TestStream;
        fn open(
            &self,
            source: &CaptureSource,
            stop: &Arc<AtomicBool>,
        ) -> Result<OpenedCapture<TestStream>, AppError> {
            let mut opened = TestSource::default().open(source, stop)?;
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
    run_capture(
        &SilentSource(callbacks),
        &Trace::default(),
        &runtime,
        &sink,
        &stop,
        &AtomicBool::new(false),
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
    run_capture(
        &source,
        &trace,
        &runtime,
        &sink,
        &stop,
        &AtomicBool::new(false),
        &tx,
    )
    .unwrap();
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
        CaptureSource::Microphone,
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
        fn open(
            &self,
            _source: &CaptureSource,
            stop: &Arc<AtomicBool>,
        ) -> Result<OpenedCapture<()>, AppError> {
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
        CaptureSource::Microphone,
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
        CaptureSource::Microphone,
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
        CaptureSource::Microphone,
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
    // the test source stops on its own at once, so the first capture may end
    // before the second one supersedes it
    let first_end = values
        .iter()
        .position(|value| value == r#"{"type":"superseded"}"# || value == r#"{"type":"end"}"#)
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

    assert!(flush_pending(&pending_pcm_samples, &sink, 4).is_some());
    assert!(sink.chunks.lock().unwrap().is_empty());

    assert!(flush_pending(&pending_pcm_samples, &sink, 1).is_some());
    assert_eq!(sink.chunks.lock().unwrap().len(), 1);
    assert!(pending_pcm_samples.lock().unwrap().is_empty());

    // nothing left: no empty frame goes out
    assert!(flush_pending(&pending_pcm_samples, &sink, 1).is_some());
    assert_eq!(sink.chunks.lock().unwrap().len(), 1);
}

#[test]
fn reports_a_gone_listener() {
    let sink = RecordingSink {
        closed: true,
        ..RecordingSink::default()
    };
    assert!(flush_pending(&Mutex::new(vec![1_i16]), &sink, 1).is_none());
}

#[test]
fn serializes_control_events() {
    assert_eq!(
        serde_json::to_string(&CaptureEvent::End).unwrap(),
        r#"{"type":"end"}"#
    );
    assert_eq!(
        serde_json::to_string(&CaptureEvent::Superseded).unwrap(),
        r#"{"type":"superseded"}"#
    );
    assert_eq!(
        serde_json::to_string(&CaptureEvent::Error {
            message: "boom".into()
        })
        .unwrap(),
        r#"{"type":"error","message":"boom"}"#
    );
}

#[tokio::test]
async fn a_running_capture_is_told_when_a_new_one_takes_the_microphone() {
    let state = VoiceSessionState::default();
    let first_sink = Trace::default();
    start_capture_with(
        TestSource::default(),
        CaptureSource::Microphone,
        Trace::default(),
        &state,
        first_sink.clone(),
    )
    .await
    .unwrap();
    let second = start_capture_with(
        TestSource {
            stop_on_open: true,
            ..TestSource::default()
        },
        CaptureSource::Microphone,
        Trace::default(),
        &state,
        Trace::default(),
    )
    .await
    .unwrap();
    assert_eq!(
        first_sink.values().last().map(String::as_str),
        Some(r#"{"type":"superseded"}"#)
    );
    stop_capture(&state, Some(second.session_id)).await.unwrap();
}

/// A source whose stream has just reported a recoverable error
struct RecoverableErrorSource {
    callbacks: Arc<AtomicU64>,
    trace: Trace,
}

impl AudioSource for RecoverableErrorSource {
    type Stream = TestStream;
    fn open(
        &self,
        source: &CaptureSource,
        stop: &Arc<AtomicBool>,
    ) -> Result<OpenedCapture<TestStream>, AppError> {
        let mut opened = TestSource {
            trace: self.trace.clone(),
            ..TestSource::default()
        }
        .open(source, stop)?;
        opened.context.callback_count = Arc::clone(&self.callbacks);
        *opened.context.recoverable_error.locked() = Some("Audio input stream failed: read".into());
        Ok(opened)
    }
}

#[test]
fn a_stream_error_followed_by_samples_does_not_end_the_capture() {
    struct RecoveringRuntime {
        now: std::cell::Cell<Instant>,
        callbacks: Arc<AtomicU64>,
        stop: Arc<AtomicBool>,
    }
    impl MonotonicClock for RecoveringRuntime {
        fn now(&self) -> Instant {
            self.now.get()
        }
        fn sleep(&self, _duration: Duration) {
            self.now.set(self.now.get() + STREAM_ERROR_GRACE);
            if self.callbacks.fetch_add(1, Ordering::Relaxed) == 3 {
                self.stop.store(true, Ordering::SeqCst);
            }
        }
    }
    let callbacks = Arc::new(AtomicU64::new(0));
    let stop = Arc::new(AtomicBool::new(false));
    let runtime = RecoveringRuntime {
        now: std::cell::Cell::new(Instant::now()),
        callbacks: Arc::clone(&callbacks),
        stop: Arc::clone(&stop),
    };
    let sink = RecordingSink::default();
    let (tx, _rx) = std_mpsc::sync_channel(1);
    run_capture(
        &RecoverableErrorSource {
            callbacks,
            trace: Trace::default(),
        },
        &Trace::default(),
        &runtime,
        &sink,
        &stop,
        &AtomicBool::new(false),
        &tx,
    )
    .unwrap();
    assert_eq!(*sink.events.locked(), [r#"{"type":"end"}"#]);
}

#[test]
fn a_stream_error_without_samples_after_it_ends_the_capture_with_that_error() {
    struct StalledRuntime(std::cell::Cell<Instant>);
    impl MonotonicClock for StalledRuntime {
        fn now(&self) -> Instant {
            self.0.get()
        }
        fn sleep(&self, _duration: Duration) {
            // far less than `CALLBACK_TIMEOUT`: the error cuts the wait short
            self.0.set(self.0.get() + STREAM_ERROR_GRACE);
        }
    }
    let sink = RecordingSink::default();
    let stop = Arc::new(AtomicBool::new(false));
    let (tx, _rx) = std_mpsc::sync_channel(1);
    run_capture(
        &RecoverableErrorSource {
            callbacks: Arc::new(AtomicU64::new(0)),
            trace: Trace::default(),
        },
        &Trace::default(),
        &StalledRuntime(std::cell::Cell::new(Instant::now())),
        &sink,
        &stop,
        &AtomicBool::new(false),
        &tx,
    )
    .unwrap();
    assert!(stop.load(Ordering::SeqCst));
    assert_eq!(
        *sink.events.locked(),
        [r#"{"type":"error","message":"Audio input stream failed: read"}"#]
    );
}

#[test]
fn only_a_lost_device_is_a_fatal_stream_error() {
    assert!(is_fatal_stream_error(
        &cpal::StreamError::DeviceNotAvailable
    ));
    assert!(!is_fatal_stream_error(
        &cpal::StreamError::BackendSpecific {
            err: cpal::BackendSpecificError {
                description: "read failed".into(),
            },
        }
    ));
}

/// A playback source that records which source it opened and delivers
/// nothing, as a sink monitor does while nothing plays.
#[derive(Default)]
struct PlaybackSource {
    trace: Trace,
    /// Marks the source of the first open as lost, as when its app quits.
    lose_first: bool,
    overlap_samples: bool,
}

impl AudioSource for PlaybackSource {
    type Stream = ();
    fn open(
        &self,
        source: &CaptureSource,
        stop_flag: &Arc<AtomicBool>,
    ) -> Result<OpenedCapture<()>, AppError> {
        let opens = self.trace.values().len();
        self.trace
            .push(format!("open:{}", serde_json::to_string(source).unwrap()));
        let mut context =
            StreamContext::new(stop_flag, TARGET_SAMPLE_RATE_HZ, TARGET_SAMPLE_RATE_HZ);
        context.fills_gaps = true;
        context.status.locked().is_waiting = matches!(source, CaptureSource::Application { .. });
        context.status.locked().is_lost = self.lose_first && opens == 0;
        if self.overlap_samples {
            context
                .pending_pcm_samples
                .locked()
                .extend(std::iter::repeat_n(opens as i16 + 1, 100));
        }
        Ok(OpenedCapture {
            stream: (),
            context,
            output_sample_rate_hz: TARGET_SAMPLE_RATE_HZ,
        })
    }
}

/// A clock that moves on by the poll interval and stops after `polls`.
struct PollClock {
    now: std::cell::Cell<Instant>,
    polls: std::cell::Cell<u32>,
    stop: Arc<AtomicBool>,
    on_poll: Box<dyn Fn(u32)>,
}

impl MonotonicClock for PollClock {
    fn now(&self) -> Instant {
        self.now.get()
    }
    fn sleep(&self, duration: Duration) {
        self.now.set(self.now.get() + duration);
        let left = self.polls.get().saturating_sub(1);
        self.polls.set(left);
        (self.on_poll)(left);
        if left == 0 {
            self.stop.store(true, Ordering::SeqCst);
        }
    }
}

fn poll_clock(polls: u32, stop: &Arc<AtomicBool>, on_poll: impl Fn(u32) + 'static) -> PollClock {
    PollClock {
        now: std::cell::Cell::new(Instant::now()),
        polls: std::cell::Cell::new(polls),
        stop: Arc::clone(stop),
        on_poll: Box::new(on_poll),
    }
}

fn sent_samples(sink: &RecordingSink) -> usize {
    sink.chunks
        .lock()
        .unwrap()
        .iter()
        .map(|chunk| chunk.len() / 2)
        .sum()
}

#[test]
fn silence_keeps_a_silent_playback_source_in_step_with_real_time() {
    let source = PlaybackSource::default();
    let stop = Arc::new(AtomicBool::new(false));
    let sink = RecordingSink::default();
    // a second of polls without a single callback
    let clock = poll_clock(50, &stop, |_| {});
    let switch = SourceSwitchSlot::default();
    let (tx, _rx) = std_mpsc::sync_channel(1);
    run_capture_thread(
        &source,
        CaptureSource::SystemMix,
        &Trace::default(),
        &clock,
        &sink,
        &CaptureControl {
            stop_flag: &stop,
            superseded: &AtomicBool::new(false),
            switch: &switch,
        },
        &tx,
    )
    .unwrap();
    // no error for the missing callbacks, and most of the second as silence
    let events = sink.events.lock().unwrap().clone();
    assert_eq!(
        events,
        [
            r#"{"type":"sourceStatus","isWaiting":false}"#,
            r#"{"type":"end"}"#
        ]
    );
    let samples = sent_samples(&sink);
    assert!((12_000..=16_000).contains(&samples), "{samples}");
}

#[test]
fn a_switch_of_the_source_keeps_one_stream_and_reports_the_wait() {
    let trace = Trace::default();
    let source = PlaybackSource {
        trace: trace.clone(),
        ..PlaybackSource::default()
    };
    let stop = Arc::new(AtomicBool::new(false));
    let sink = RecordingSink::default();
    let switch = SourceSwitchSlot::default();
    let (reply, replied) = std_mpsc::sync_channel(1);
    let request_slot = Arc::clone(&switch);
    let request = std::cell::RefCell::new(Some(SourceSwitch {
        source: CaptureSource::Application {
            app_id: "telegram-desktop".into(),
        },
        reply,
    }));
    let clock = poll_clock(10, &stop, move |left| {
        if left == 5 {
            *request_slot.locked() = request.borrow_mut().take();
        }
    });
    let (tx, _rx) = std_mpsc::sync_channel(1);
    run_capture_thread(
        &source,
        CaptureSource::SystemMix,
        &Trace::default(),
        &clock,
        &sink,
        &CaptureControl {
            stop_flag: &stop,
            superseded: &AtomicBool::new(false),
            switch: &switch,
        },
        &tx,
    )
    .unwrap();
    assert!(replied.try_recv().unwrap().is_ok());
    assert_eq!(
        trace.values(),
        [
            r#"open:{"kind":"systemMix"}"#,
            r#"open:{"kind":"application","appId":"telegram-desktop"}"#,
        ]
    );
    let events = sink.events.lock().unwrap().clone();
    assert_eq!(
        events,
        [
            r#"{"type":"sourceStatus","isWaiting":false}"#,
            r#"{"type":"sourceStatus","isWaiting":true}"#,
            r#"{"type":"end"}"#
        ]
    );
}

#[test]
fn a_lost_application_waits_without_expanding_the_recorded_source() {
    let trace = Trace::default();
    let source = PlaybackSource {
        trace: trace.clone(),
        lose_first: true,
        ..PlaybackSource::default()
    };
    let stop = Arc::new(AtomicBool::new(false));
    let sink = RecordingSink::default();
    let clock = poll_clock(3, &stop, |_| {});
    let switch = SourceSwitchSlot::default();
    let (tx, _rx) = std_mpsc::sync_channel(1);
    run_capture_thread(
        &source,
        CaptureSource::Application {
            app_id: "telegram-desktop".into(),
        },
        &Trace::default(),
        &clock,
        &sink,
        &CaptureControl {
            stop_flag: &stop,
            superseded: &AtomicBool::new(false),
            switch: &switch,
        },
        &tx,
    )
    .unwrap();
    assert_eq!(trace.values().len(), 1);
    let events = sink.events.lock().unwrap().clone();
    assert_eq!(
        events,
        [
            r#"{"type":"sourceLost","source":{"kind":"application","appId":"telegram-desktop"}}"#,
            r#"{"type":"sourceStatus","isWaiting":true}"#,
            r#"{"type":"end"}"#
        ]
    );
}

#[tokio::test]
async fn only_playback_sources_are_switched_to() {
    let state = VoiceSessionState::default();
    let error = switch_capture_source(&state, 1, CaptureSource::Microphone)
        .await
        .unwrap_err();
    assert!(matches!(error, AppError::InvalidInput(_)));
    let error = switch_capture_source(&state, 1, CaptureSource::SystemMix)
        .await
        .unwrap_err();
    assert!(matches!(error, AppError::Stale(_)));
}

#[test]
fn a_source_switch_discards_audio_recorded_twice_during_setup() {
    let source = PlaybackSource {
        overlap_samples: true,
        ..PlaybackSource::default()
    };
    let stop = Arc::new(AtomicBool::new(false));
    let sink = RecordingSink::default();
    let switch = SourceSwitchSlot::default();
    let slot = Arc::clone(&switch);
    let (reply, _replied) = std_mpsc::sync_channel(1);
    *slot.locked() = Some(SourceSwitch {
        source: CaptureSource::Application {
            app_id: "app".into(),
        },
        reply,
    });
    let clock = poll_clock(3, &stop, |_| {});
    let (tx, _rx) = std_mpsc::sync_channel(1);
    run_capture_thread(
        &source,
        CaptureSource::SystemMix,
        &Trace::default(),
        &clock,
        &sink,
        &CaptureControl {
            stop_flag: &stop,
            superseded: &AtomicBool::new(false),
            switch: &switch,
        },
        &tx,
    )
    .unwrap();
    let samples: Vec<i16> = sink
        .chunks
        .locked()
        .iter()
        .flat_map(|chunk| {
            chunk
                .as_chunks::<2>()
                .0
                .iter()
                .map(|pair| i16::from_le_bytes([pair[0], pair[1]]))
        })
        .collect();
    assert_eq!(samples, vec![1; 100]);
}
