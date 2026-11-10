//! The sound the computer plays, through WASAPI process loopback: the whole
//! sound without Tyco's own process tree, or the tree of one application.
//! Process loopback is probed at runtime. When unavailable, the whole
//! sound comes from the loopback of the default output device.
//!
//! Process loopback reports no mix format: the stream asks for float32 at
//! 48 kHz in stereo and is mixed down and resampled here.
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use windows::core::{implement, Interface, Ref, HRESULT};
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
use windows::Win32::Media::Audio::{
    eConsole, eRender, ActivateAudioInterfaceAsync, AudioSessionStateActive,
    IActivateAudioInterfaceAsyncOperation, IActivateAudioInterfaceCompletionHandler,
    IActivateAudioInterfaceCompletionHandler_Impl, IAudioCaptureClient, IAudioClient,
    IAudioSessionControl2, IAudioSessionManager2, IMMDevice, IMMDeviceEnumerator,
    MMDeviceEnumerator, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
    AUDCLNT_STREAMFLAGS_EVENTCALLBACK, AUDCLNT_STREAMFLAGS_LOOPBACK, AUDIOCLIENT_ACTIVATION_PARAMS,
    AUDIOCLIENT_ACTIVATION_PARAMS_0, AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
    AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS, DEVICE_STATE_ACTIVE, PROCESS_LOOPBACK_MODE,
    PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE,
    PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE, VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
    WAVEFORMATEX,
};
use windows::Win32::System::Com::StructuredStorage::{
    PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, BLOB, CLSCTX_ALL,
    COINIT_MULTITHREADED,
};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject};
use windows::Win32::System::Variant::VT_BLOB;

use super::process_tree::{app_label, app_root, app_roots, is_in_tree, ProcessEntry};
use super::CaptureStream;
use crate::errors::AppError;
use crate::locks::MutexExt;
use crate::services::voice::mixer::StreamMixer;
use crate::services::voice::{
    AudioApp, CaptureSource, OpenedCapture, PlaybackConverter, StreamContext, TARGET_SAMPLE_RATE_HZ,
};

/// `WAVE_FORMAT_IEEE_FLOAT` of `mmreg.h`.
const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
const LOOPBACK_RATE_HZ: u32 = 48_000;
const LOOPBACK_CHANNELS: u16 = 2;
/// The buffer of the loopback stream, in 100 ns units: 200 ms.
const BUFFER_DURATION: i64 = 2_000_000;
const ACTIVATION_TIMEOUT: Duration = Duration::from_secs(5);
const WAIT_INTERVAL_MS: u32 = 100;
/// How often a capture of an application looks for its process and session.
const APP_CHECK_INTERVAL: Duration = Duration::from_millis(500);
const APPS_EMIT_INTERVAL: Duration = Duration::from_millis(250);

/// Probe activation and initialization instead of guessing from the OS build.
pub(super) fn has_process_loopback() -> bool {
    static AVAILABLE: OnceLock<Mutex<bool>> = OnceLock::new();
    let mut available = AVAILABLE.get_or_init(|| Mutex::new(false)).locked();
    if *available {
        return true;
    }
    // A negative probe may only mean the audio service is temporarily down.
    *available = thread::spawn(|| {
        let Ok(_com) = ComScope::enter() else {
            return false;
        };
        activate_process_loopback(
            std::process::id(),
            PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE,
        )
        .and_then(LoopbackStream::start)
        .is_ok()
    })
    .join()
    .unwrap_or(false);
    *available
}

fn com_error(error: windows::core::Error) -> AppError {
    AppError::ServiceUnavailable(format!("WASAPI: {error}"))
}

/// COM for the thread it is created on, until it is dropped.
struct ComScope;

impl ComScope {
    fn enter() -> Result<Self, AppError> {
        // SAFETY: balanced by `CoUninitialize` in `drop`
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
            .ok()
            .map_err(com_error)?;
        Ok(Self)
    }
}

impl Drop for ComScope {
    fn drop(&mut self) {
        // SAFETY: this thread entered COM in `enter`
        unsafe { CoUninitialize() };
    }
}

/// Every running process, for the trees of the applications.
fn process_snapshot() -> Vec<ProcessEntry> {
    let mut processes = Vec::new();
    // SAFETY: the snapshot handle is closed below; the entry size is set
    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return processes;
        };
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        let mut found = Process32FirstW(snapshot, &mut entry).is_ok();
        while found {
            let length = entry
                .szExeFile
                .iter()
                .position(|unit| *unit == 0)
                .unwrap_or(entry.szExeFile.len());
            processes.push(ProcessEntry {
                pid: entry.th32ProcessID,
                parent_pid: entry.th32ParentProcessID,
                exe_name: String::from_utf16_lossy(&entry.szExeFile[..length]),
            });
            found = Process32NextW(snapshot, &mut entry).is_ok();
        }
        let _ = CloseHandle(snapshot);
    }
    processes
}

#[implement(IActivateAudioInterfaceCompletionHandler)]
struct ActivationHandler {
    done: Mutex<Option<mpsc::SyncSender<()>>>,
}

impl IActivateAudioInterfaceCompletionHandler_Impl for ActivationHandler_Impl {
    fn ActivateCompleted(
        &self,
        _operation: Ref<IActivateAudioInterfaceAsyncOperation>,
    ) -> windows::core::Result<()> {
        if let Some(done) = self.done.locked().take() {
            let _ = done.send(());
        }
        Ok(())
    }
}

/// An audio client recording the process tree of `pid`, or everything but it.
fn activate_process_loopback(
    pid: u32,
    mode: PROCESS_LOOPBACK_MODE,
) -> Result<IAudioClient, AppError> {
    let mut params = AUDIOCLIENT_ACTIVATION_PARAMS {
        ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
            ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                TargetProcessId: pid,
                ProcessLoopbackMode: mode,
            },
        },
    };
    let variant = PROPVARIANT {
        Anonymous: PROPVARIANT_0 {
            Anonymous: std::mem::ManuallyDrop::new(PROPVARIANT_0_0 {
                vt: VT_BLOB,
                wReserved1: 0,
                wReserved2: 0,
                wReserved3: 0,
                Anonymous: PROPVARIANT_0_0_0 {
                    blob: BLOB {
                        cbSize: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
                        pBlobData: (&raw mut params).cast(),
                    },
                },
            }),
        },
    };
    let (done, finished) = mpsc::sync_channel(1);
    let handler: IActivateAudioInterfaceCompletionHandler = ActivationHandler {
        done: Mutex::new(Some(done)),
    }
    .into();
    // SAFETY: `variant` and the `params` it points to outlive the wait below
    let operation = unsafe {
        ActivateAudioInterfaceAsync(
            VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
            &IAudioClient::IID,
            Some(&variant),
            &handler,
        )
    }
    .map_err(com_error)?;
    finished
        .recv_timeout(ACTIVATION_TIMEOUT)
        .map_err(|_| AppError::ServiceUnavailable("Process loopback did not activate".into()))?;
    let mut result = HRESULT(0);
    let mut interface = None;
    // SAFETY: the activation completed: its result can be read
    unsafe { operation.GetActivateResult(&mut result, &mut interface) }.map_err(com_error)?;
    result.ok().map_err(com_error)?;
    interface
        .ok_or_else(|| AppError::ServiceUnavailable("No audio client was activated".into()))?
        .cast()
        .map_err(com_error)
}

/// A started loopback stream: an event signals each buffer.
struct LoopbackStream {
    client: IAudioClient,
    capture: IAudioCaptureClient,
    event: HANDLE,
}

impl LoopbackStream {
    fn start(client: IAudioClient) -> Result<Self, AppError> {
        let block_align = LOOPBACK_CHANNELS * 4;
        let format = WAVEFORMATEX {
            wFormatTag: WAVE_FORMAT_IEEE_FLOAT,
            nChannels: LOOPBACK_CHANNELS,
            nSamplesPerSec: LOOPBACK_RATE_HZ,
            nAvgBytesPerSec: LOOPBACK_RATE_HZ * u32::from(block_align),
            nBlockAlign: block_align,
            wBitsPerSample: 32,
            cbSize: 0,
        };
        // SAFETY: plain COM calls on a client this thread activated; the
        // event is closed in `drop`
        unsafe {
            client
                .Initialize(
                    AUDCLNT_SHAREMODE_SHARED,
                    AUDCLNT_STREAMFLAGS_LOOPBACK
                        | AUDCLNT_STREAMFLAGS_EVENTCALLBACK
                        | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
                    BUFFER_DURATION,
                    0,
                    &format,
                    None,
                )
                .map_err(com_error)?;
            let capture = client.GetService().map_err(com_error)?;
            let event = CreateEventW(None, false, false, None).map_err(com_error)?;
            let stream = Self {
                capture,
                client,
                event,
            };
            stream
                .client
                .SetEventHandle(stream.event)
                .map_err(com_error)?;
            stream.client.Start().map_err(com_error)?;
            Ok(stream)
        }
    }

    /// Waits for the next buffer and hands its frames to `deliver`.
    fn read(&self, wait_ms: u32, mut deliver: impl FnMut(&[f32])) -> Result<(), AppError> {
        // SAFETY: the buffer is read within GetBuffer and ReleaseBuffer
        unsafe {
            if WaitForSingleObject(self.event, wait_ms) != WAIT_OBJECT_0 {
                return Ok(());
            }
            loop {
                let packet = self.capture.GetNextPacketSize().map_err(com_error)?;
                if packet == 0 {
                    return Ok(());
                }
                let mut data = std::ptr::null_mut();
                let mut frames = 0;
                let mut flags = 0;
                self.capture
                    .GetBuffer(&mut data, &mut frames, &mut flags, None, None)
                    .map_err(com_error)?;
                let samples = frames as usize * usize::from(LOOPBACK_CHANNELS);
                // AUDCLNT_BUFFERFLAGS_SILENT: the data is to be read as silence
                if flags & 0x2 != 0 || data.is_null() {
                    deliver(&vec![0.0; samples]);
                } else {
                    deliver(std::slice::from_raw_parts(data.cast::<f32>(), samples));
                }
                self.capture.ReleaseBuffer(frames).map_err(com_error)?;
            }
        }
    }
}

impl Drop for LoopbackStream {
    fn drop(&mut self) {
        // SAFETY: the client was started and the event created in `start`
        unsafe {
            let _ = self.client.Stop();
            let _ = CloseHandle(self.event);
        }
    }
}

/// The handle of a capture thread; dropping it ends the capture.
struct CaptureThread {
    quit: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}

impl Drop for CaptureThread {
    fn drop(&mut self) {
        self.quit.store(true, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// Starts recording a playback source.
pub(super) fn open_playback(
    source: &CaptureSource,
    stop_flag: &Arc<AtomicBool>,
) -> Result<OpenedCapture<CaptureStream>, AppError> {
    let target = match source {
        CaptureSource::Application { app_id } if has_process_loopback() => {
            Target::Application(app_id.clone())
        }
        CaptureSource::Application { .. } => {
            return Err(AppError::ServiceUnavailable(
                "Process loopback is unavailable on this Windows system".into(),
            ))
        }
        _ if has_process_loopback() => Target::AllButOwn,
        // before process loopback: the whole sound of the default output
        _ => Target::Device,
    };
    let mut context = StreamContext::new(stop_flag, LOOPBACK_RATE_HZ, TARGET_SAMPLE_RATE_HZ);
    context.fills_gaps = true;
    let shared = SharedContext::of(&context);
    let quit = Arc::new(AtomicBool::new(false));
    let thread_quit = Arc::clone(&quit);
    let (setup_tx, setup_rx) = mpsc::sync_channel(1);
    let thread = thread::Builder::new()
        .name("tyco-wasapi-capture".into())
        .spawn(move || run_capture(target, shared, &thread_quit, &setup_tx))
        .map_err(|error| AppError::Failed(format!("cannot start the capture thread: {error}")))?;
    let handle = CaptureThread {
        quit,
        thread: Some(thread),
    };
    match setup_rx.recv_timeout(ACTIVATION_TIMEOUT * 2) {
        Ok(Ok(())) => Ok(OpenedCapture {
            stream: Box::new(handle),
            context,
            output_sample_rate_hz: TARGET_SAMPLE_RATE_HZ,
        }),
        Ok(Err(error)) => Err(error),
        Err(_) => Err(AppError::ServiceUnavailable(
            "The loopback capture did not start in time".into(),
        )),
    }
}

enum Target {
    AllButOwn,
    Application(String),
    Device,
}

fn default_output_device() -> Result<(String, IMMDevice), AppError> {
    // SAFETY: the caller has entered COM; GetId allocates with CoTaskMemAlloc.
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(com_error)?;
        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(com_error)?;
        let raw_id = device.GetId().map_err(com_error)?;
        let id = raw_id.to_string();
        CoTaskMemFree(Some(raw_id.0.cast()));
        Ok((
            id.map_err(|error| AppError::Failed(format!("Invalid output device id: {error}")))?,
            device,
        ))
    }
}

fn device_stream(device: &IMMDevice) -> Result<LoopbackStream, AppError> {
    // SAFETY: plain COM calls on this capture thread.
    let client = unsafe { device.Activate::<IAudioClient>(CLSCTX_ALL, None) }.map_err(com_error)?;
    LoopbackStream::start(client)
}

/// Old Windows fallback: reopen when the default endpoint changes.
fn run_device_capture(
    context: &StreamContext,
    quit: &AtomicBool,
    setup_tx: &mpsc::SyncSender<Result<(), AppError>>,
) {
    let opened = default_output_device().and_then(|(id, device)| Ok((id, device_stream(&device)?)));
    let (mut id, mut stream) = match opened {
        Ok(opened) => opened,
        Err(error) => {
            let _ = setup_tx.send(Err(error));
            return;
        }
    };
    let _ = setup_tx.send(Ok(()));
    let mut converter = PlaybackConverter::new(
        LOOPBACK_RATE_HZ,
        TARGET_SAMPLE_RATE_HZ,
        usize::from(LOOPBACK_CHANNELS),
    );
    let mut checked = Instant::now();
    while !quit.load(Ordering::SeqCst) {
        if checked.elapsed() >= APP_CHECK_INTERVAL {
            checked = Instant::now();
            match default_output_device() {
                Ok((next_id, device)) if next_id != id => match device_stream(&device) {
                    Ok(next) => {
                        stream = next;
                        id = next_id;
                    }
                    Err(error) => {
                        *context.stream_error.locked() = Some(error.to_string());
                        return;
                    }
                },
                Err(error) => {
                    *context.stream_error.locked() = Some(error.to_string());
                    return;
                }
                _ => {}
            }
        }
        if let Err(error) = stream.read(WAIT_INTERVAL_MS, |frames| {
            converter.deliver(context, frames)
        }) {
            // An endpoint can disappear before the next default-device poll.
            // Try the current endpoint immediately before reporting a failure.
            match default_output_device().and_then(|(id, device)| Ok((id, device_stream(&device)?)))
            {
                Ok((next_id, next)) => {
                    id = next_id;
                    stream = next;
                }
                Err(_) => {
                    *context.stream_error.locked() = Some(error.to_string());
                    return;
                }
            }
        }
    }
}

/// The parts of `StreamContext` the capture thread writes to.
struct SharedContext {
    context: StreamContext,
}

impl SharedContext {
    fn of(context: &StreamContext) -> Self {
        Self {
            context: StreamContext {
                pending_pcm_samples: Arc::clone(&context.pending_pcm_samples),
                stream_error: Arc::clone(&context.stream_error),
                recoverable_error: Arc::clone(&context.recoverable_error),
                current_level: Arc::clone(&context.current_level),
                callback_count: Arc::clone(&context.callback_count),
                stop_flag: Arc::clone(&context.stop_flag),
                device_sample_rate_hz: context.device_sample_rate_hz,
                output_sample_rate_hz: context.output_sample_rate_hz,
                fills_gaps: context.fills_gaps,
                status: Arc::clone(&context.status),
            },
        }
    }
}

fn run_capture(
    target: Target,
    shared: SharedContext,
    quit: &AtomicBool,
    setup_tx: &mpsc::SyncSender<Result<(), AppError>>,
) {
    let _com = match ComScope::enter() {
        Ok(com) => com,
        Err(error) => {
            let _ = setup_tx.send(Err(error));
            return;
        }
    };
    let context = &shared.context;
    let mut converter = PlaybackConverter::new(
        LOOPBACK_RATE_HZ,
        TARGET_SAMPLE_RATE_HZ,
        usize::from(LOOPBACK_CHANNELS),
    );
    match target {
        Target::AllButOwn => {
            let stream = activate_process_loopback(
                std::process::id(),
                PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE,
            )
            .and_then(LoopbackStream::start);
            let stream = match stream {
                Ok(stream) => stream,
                Err(error) => {
                    log::info!("Process loopback unavailable, using the output device: {error}");
                    run_device_capture(context, quit, setup_tx);
                    return;
                }
            };
            let _ = setup_tx.send(Ok(()));
            while !quit.load(Ordering::SeqCst) {
                if let Err(error) = stream.read(WAIT_INTERVAL_MS, |frames| {
                    converter.deliver(context, frames)
                }) {
                    *context.stream_error.locked() = Some(error.to_string());
                    return;
                }
            }
        }
        Target::Device => run_device_capture(context, quit, setup_tx),
        Target::Application(app_id) => {
            context.status.locked().is_waiting = true;
            let _ = setup_tx.send(Ok(()));
            run_application_capture(&app_id, context, quit);
        }
    }
}

/// Records the tree of `app_id` while it runs: waits for it to start and
/// reports when it quits, see `SourceStatus`.
fn run_application_capture(app_id: &str, context: &StreamContext, quit: &AtomicBool) {
    let sessions = match SessionMeter::new() {
        Ok(sessions) => sessions,
        Err(error) => {
            *context.stream_error.locked() = Some(error.to_string());
            return;
        }
    };
    let mut recordings: HashMap<u32, LoopbackStream> = HashMap::new();
    let mut mixer = StreamMixer::new(u64::from(LOOPBACK_RATE_HZ) / 5);
    let mut converter = PlaybackConverter::new(LOOPBACK_RATE_HZ, TARGET_SAMPLE_RATE_HZ, 1);
    let mut has_seen = false;
    let mut last_check: Option<Instant> = None;
    while !quit.load(Ordering::SeqCst) {
        if last_check.is_none_or(|checked| checked.elapsed() >= APP_CHECK_INTERVAL) {
            last_check = Some(Instant::now());
            let processes = process_snapshot();
            let roots = app_roots(&processes, app_id);
            recordings.retain(|pid, _| {
                if roots.contains(pid) {
                    true
                } else {
                    mixer.remove_stream(*pid);
                    false
                }
            });
            if roots.is_empty() {
                if has_seen {
                    context.status.locked().is_lost = true;
                }
                has_seen = false;
            } else {
                has_seen = true;
            }
            for root in roots {
                if let std::collections::hash_map::Entry::Vacant(entry) = recordings.entry(root) {
                    match activate_process_loopback(
                        root,
                        PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
                    )
                    .and_then(LoopbackStream::start)
                    {
                        Ok(stream) => {
                            entry.insert(stream);
                            mixer.add_stream(root);
                        }
                        Err(error) => {
                            *context.stream_error.locked() =
                                Some(format!("Could not record {app_id}: {error}"));
                            return;
                        }
                    }
                }
            }
            match sessions.active_pids() {
                Ok(pids) => {
                    context.status.locked().is_waiting = !pids.into_iter().any(|pid| {
                        recordings
                            .keys()
                            .any(|root| is_in_tree(&processes, pid, *root))
                    })
                }
                Err(error) => {
                    *context.stream_error.locked() = Some(error.to_string());
                    return;
                }
            }
        }
        for (pid, stream) in &recordings {
            // Poll every tree without a per-tree wait, so a silent instance
            // cannot make another instance overrun its 200 ms capture buffer.
            if let Err(error) = stream.read(0, |frames| {
                let mono: Vec<f32> = frames
                    .chunks(usize::from(LOOPBACK_CHANNELS))
                    .map(|frame| frame.iter().sum::<f32>() / frame.len() as f32)
                    .collect();
                mixer.push(*pid, &mono);
            }) {
                *context.stream_error.locked() =
                    Some(format!("The capture of {app_id} failed: {error}"));
                return;
            }
        }
        converter.deliver(context, &mixer.drain());
        thread::sleep(Duration::from_millis(10));
    }
}

/// All active render endpoints, re-enumerated on each poll to follow routing
/// changes and newly attached devices without keeping stale session managers.
struct SessionMeter {
    enumerator: IMMDeviceEnumerator,
}

struct ActiveSession {
    pid: u32,
    peak: f32,
}

impl SessionMeter {
    fn new() -> Result<Self, AppError> {
        // SAFETY: the caller has entered COM on this thread.
        let enumerator = unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
            .map_err(com_error)?;
        Ok(Self { enumerator })
    }

    fn active_sessions(&self) -> Result<Vec<ActiveSession>, AppError> {
        let mut sessions = Vec::new();
        // SAFETY: these interfaces belong to the current COM thread.
        unsafe {
            let devices = self
                .enumerator
                .EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)
                .map_err(com_error)?;
            for index in 0..devices.GetCount().map_err(com_error)? {
                let device = devices.Item(index).map_err(com_error)?;
                let Ok(manager) = device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) else {
                    continue;
                };
                let Ok(list) = manager.GetSessionEnumerator() else {
                    continue;
                };
                for index in 0..list.GetCount().unwrap_or(0) {
                    let Ok(control) = list.GetSession(index) else {
                        continue;
                    };
                    if control.GetState().ok() != Some(AudioSessionStateActive) {
                        continue;
                    }
                    let Ok(control) = control.cast::<IAudioSessionControl2>() else {
                        continue;
                    };
                    if control.IsSystemSoundsSession() == HRESULT(0) {
                        continue;
                    }
                    let Ok(pid) = control.GetProcessId() else {
                        continue;
                    };
                    let peak = control
                        .cast::<IAudioMeterInformation>()
                        .and_then(|meter| meter.GetPeakValue())
                        .unwrap_or(0.0);
                    sessions.push(ActiveSession { pid, peak });
                }
            }
        }
        Ok(sessions)
    }

    fn active_pids(&self) -> Result<Vec<u32>, AppError> {
        Ok(self
            .active_sessions()?
            .into_iter()
            .map(|session| session.pid)
            .collect())
    }
}

/// The applications of the active sessions, by the root of their tree.
fn playing_apps(sessions: &[ActiveSession], processes: &[ProcessEntry]) -> Vec<AudioApp> {
    let own = std::process::id();
    let mut apps: Vec<AudioApp> = Vec::new();
    for session in sessions {
        if is_in_tree(processes, session.pid, own) {
            continue;
        }
        let Some(root) = app_root(processes, session.pid) else {
            continue;
        };
        match apps
            .iter_mut()
            .find(|app| app.id.eq_ignore_ascii_case(&root.exe_name))
        {
            Some(app) => app.level = app.level.max(session.peak),
            None => apps.push(AudioApp {
                id: root.exe_name.clone(),
                label: app_label(&root.exe_name),
                icon_name: None,
                level: session.peak.clamp(0.0, 1.0),
            }),
        }
    }
    apps.sort_by_key(|app| app.label.to_lowercase());
    apps
}

/// Reports the applications that play sound, with their levels, until the
/// returned handle is dropped.
pub(super) fn watch_apps(
    on_change: Box<dyn Fn(Vec<AudioApp>) + Send>,
) -> Result<AppsWatch, AppError> {
    let quit = Arc::new(AtomicBool::new(false));
    let thread_quit = Arc::clone(&quit);
    let (setup_tx, setup_rx) = mpsc::sync_channel::<Result<(), AppError>>(1);
    let thread = thread::Builder::new()
        .name("tyco-wasapi-apps".into())
        .spawn(move || {
            let meter = ComScope::enter().and_then(|com| Ok((com, SessionMeter::new()?)));
            let (_com, meter) = match meter {
                Ok(meter) => meter,
                Err(error) => {
                    let _ = setup_tx.send(Err(error));
                    return;
                }
            };
            let _ = setup_tx.send(Ok(()));
            let mut last: Option<Vec<AudioApp>> = None;
            while !thread_quit.load(Ordering::SeqCst) {
                let sessions = match meter.active_sessions() {
                    Ok(sessions) => sessions,
                    Err(error) => {
                        log::warn!("Could not enumerate audio sessions: {error}");
                        Vec::new()
                    }
                };
                let apps = playing_apps(&sessions, &process_snapshot());
                if last.as_ref() != Some(&apps) {
                    on_change(apps.clone());
                    last = Some(apps);
                }
                thread::sleep(APPS_EMIT_INTERVAL);
            }
        })
        .map_err(|error| AppError::Failed(format!("cannot start the apps thread: {error}")))?;
    let watch = AppsWatch {
        _thread: CaptureThread {
            quit,
            thread: Some(thread),
        },
    };
    match setup_rx.recv_timeout(ACTIVATION_TIMEOUT) {
        Ok(Ok(())) => Ok(watch),
        Ok(Err(error)) => Err(error),
        Err(_) => Err(AppError::ServiceUnavailable(
            "The audio sessions did not answer in time".into(),
        )),
    }
}

/// Watches the applications; dropping it stops watching.
pub(super) struct AppsWatch {
    _thread: CaptureThread,
}
