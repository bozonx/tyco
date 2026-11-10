//! The sound the computer plays, through PipeWire: the monitor of the default
//! sink for the whole sound, the output streams of one application for it
//! alone. CPAL reaches neither. Plain PulseAudio is not supported, see
//! `dev_docs/cross-platform.md`.
//!
//! Each capture and each watch of the applications runs a PipeWire main loop
//! on a thread of its own; dropping its handle quits the loop.
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::atomic::AtomicBool;
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;

use pipewire as pw;
use pw::properties::properties;
use pw::spa;
use pw::spa::utils::dict::DictRef;
use pw::types::ObjectType;

use crate::errors::AppError;
use crate::locks::MutexExt;
use crate::services::voice::mixer::StreamMixer;
use crate::services::voice::{
    AudioApp, AudioAppId, CaptureSource, OpenedCapture, SourceStatus, StreamContext,
    TARGET_SAMPLE_RATE_HZ,
};

const SETUP_TIMEOUT: Duration = Duration::from_secs(5);
/// How far one stream of an application may run ahead of a stalled one.
const MIX_MAX_LAG_MS: u64 = 200;
/// The rate of the peak streams that meter the applications.
const PEAK_RATE_HZ: u32 = 25;
const APPS_EMIT_INTERVAL: Duration = Duration::from_millis(250);
const OUTPUT_STREAM_CLASS: &str = "Stream/Output/Audio";

/// Probe the server on each request: it may restart or appear after login.
pub(super) fn is_available() -> bool {
    thread::spawn(|| {
        pw::init();
        let Ok(main_loop) = pw::main_loop::MainLoopRc::new(None) else {
            return false;
        };
        let Ok(context) = pw::context::ContextRc::new(&main_loop, None) else {
            return false;
        };
        let Ok(core) = context.connect_rc(None) else {
            return false;
        };
        let available = Rc::new(std::cell::Cell::new(false));
        let done_available = Rc::clone(&available);
        let done_loop = main_loop.downgrade();
        let error_loop = main_loop.downgrade();
        let _listener = core
            .add_listener_local()
            .done(move |_, _| {
                done_available.set(true);
                if let Some(main_loop) = done_loop.upgrade() {
                    main_loop.quit();
                }
            })
            .error(move |_, _, _, _| {
                if let Some(main_loop) = error_loop.upgrade() {
                    main_loop.quit();
                }
            })
            .register();
        let timeout_loop = main_loop.downgrade();
        let timer = main_loop.loop_().add_timer(move |_| {
            if let Some(main_loop) = timeout_loop.upgrade() {
                main_loop.quit();
            }
        });
        if timer
            .update_timer(Some(Duration::from_secs(1)), None)
            .into_result()
            .is_err()
            || core.sync(0).is_err()
        {
            return false;
        }
        main_loop.run();
        available.get()
    })
    .join()
    .unwrap_or(false)
}

/// The identity of the application a node or client belongs to, see
/// `AudioAppId`: a Flatpak app id, else the binary, else the name.
pub(super) fn app_id_of(get: impl Fn(&str) -> Option<String>) -> Option<AudioAppId> {
    [
        "pipewire.access.portal.app_id",
        "application.process.binary",
        "application.name",
    ]
    .into_iter()
    .find_map(|key| {
        get(key)
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
    })
}

fn app_id_in(props: &DictRef) -> Option<AudioAppId> {
    app_id_of(|key| props.get(key).map(str::to_owned))
}

/// Whether the object belongs to this process: Tyco does not list or record
/// itself.
fn is_own(props: &DictRef) -> bool {
    let own = std::process::id().to_string();
    [*pw::keys::APP_PROCESS_ID, *pw::keys::SEC_PID]
        .into_iter()
        .any(|key| props.get(key) == Some(own.as_str()))
}

/// The handle of a PipeWire loop thread; dropping it quits the loop.
pub(super) struct LoopThread {
    quit: Option<pw::channel::Sender<()>>,
    thread: Option<thread::JoinHandle<()>>,
}

impl Drop for LoopThread {
    fn drop(&mut self) {
        if let Some(quit) = self.quit.take() {
            let _ = quit.send(());
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// Runs `body` on a thread with a PipeWire loop until the handle is dropped.
/// `body` sets the loop up, calls `ready` and runs the loop; an error before
/// `ready` is the error of the setup.
fn spawn_loop<F>(name: &str, body: F) -> Result<LoopThread, AppError>
where
    F: FnOnce(&pw::main_loop::MainLoopRc, &pw::core::CoreRc, &dyn Fn()) -> Result<(), AppError>
        + Send
        + 'static,
{
    let (quit, quit_rx) = pw::channel::channel::<()>();
    let (setup_tx, setup_rx) = mpsc::sync_channel::<Result<(), AppError>>(1);
    let thread = thread::Builder::new()
        .name(name.to_owned())
        .spawn(move || {
            let failed = |error: AppError| {
                let _ = setup_tx.send(Err(error));
            };
            pw::init();
            let main_loop = match pw::main_loop::MainLoopRc::new(None) {
                Ok(main_loop) => main_loop,
                Err(error) => return failed(pipewire_error(error)),
            };
            let context = match pw::context::ContextRc::new(&main_loop, None) {
                Ok(context) => context,
                Err(error) => return failed(pipewire_error(error)),
            };
            let core = match context.connect_rc(None) {
                Ok(core) => core,
                Err(error) => return failed(pipewire_error(error)),
            };
            let weak_loop = main_loop.downgrade();
            let _quit = quit_rx.attach(main_loop.loop_(), move |()| {
                if let Some(main_loop) = weak_loop.upgrade() {
                    main_loop.quit();
                }
            });
            let ready = || {
                let _ = setup_tx.send(Ok(()));
            };
            if let Err(error) = body(&main_loop, &core, &ready) {
                log::warn!("PipeWire loop failed: {error}");
                failed(error);
            }
        })
        .map_err(|error| AppError::Failed(format!("cannot start the PipeWire thread: {error}")))?;
    let handle = LoopThread {
        quit: Some(quit),
        thread: Some(thread),
    };
    match setup_rx.recv_timeout(SETUP_TIMEOUT) {
        Ok(Ok(())) => Ok(handle),
        Ok(Err(error)) => Err(error),
        Err(_) => Err(AppError::ServiceUnavailable(
            "PipeWire did not answer in time".into(),
        )),
    }
}

fn pipewire_error(error: pw::Error) -> AppError {
    AppError::ServiceUnavailable(format!("PipeWire: {error}"))
}

/// The format every stream asks for: PipeWire converts and mixes down.
fn format_param(rate_hz: u32) -> Vec<u8> {
    let mut info = spa::param::audio::AudioInfoRaw::new();
    info.set_format(spa::param::audio::AudioFormat::F32LE);
    info.set_rate(rate_hz);
    info.set_channels(1);
    let mut position = [0; spa::sys::SPA_AUDIO_MAX_CHANNELS as usize];
    position[0] = spa::sys::SPA_AUDIO_CHANNEL_MONO;
    info.set_position(position);
    let object = spa::pod::Object {
        type_: spa::utils::SpaTypes::ObjectParamFormat.as_raw(),
        id: spa::param::ParamType::EnumFormat.as_raw(),
        properties: info.into(),
    };
    spa::pod::serialize::PodSerializer::serialize(
        std::io::Cursor::new(Vec::new()),
        &spa::pod::Value::Object(object),
    )
    .map(|(cursor, _)| cursor.into_inner())
    .unwrap_or_default()
}

/// Reads the f32 samples of the next buffer of `stream`.
fn take_samples(stream: &pw::stream::Stream, samples: &mut Vec<f32>) {
    samples.clear();
    let Some(mut buffer) = stream.dequeue_buffer() else {
        return;
    };
    let Some(data) = buffer.datas_mut().first_mut() else {
        return;
    };
    let offset = data.chunk().offset() as usize;
    let size = data.chunk().size() as usize;
    if let Some(bytes) = data.data() {
        let end = (offset + size).min(bytes.len());
        let start = offset.min(end);
        samples.extend(
            bytes[start..end]
                .as_chunks::<4>()
                .0
                .iter()
                .map(|sample| f32::from_le_bytes(*sample)),
        );
    }
}

fn connect_capture(stream: &pw::stream::Stream, rate_hz: u32) -> Result<(), AppError> {
    let format = format_param(rate_hz);
    let pod = spa::pod::Pod::from_bytes(&format)
        .ok_or_else(|| AppError::Failed("cannot build the PipeWire format".into()))?;
    stream
        .connect(
            spa::utils::Direction::Input,
            None,
            pw::stream::StreamFlags::AUTOCONNECT | pw::stream::StreamFlags::MAP_BUFFERS,
            &mut [pod],
        )
        .map_err(pipewire_error)
}

/// A capture stream of `target`, a node serial; one that never falls back to
/// another node, such as the microphone, once its target is gone.
fn stream_of_target(
    core: &pw::core::CoreRc,
    name: &str,
    target: &str,
    extra: &[(&str, &str)],
) -> Result<pw::stream::StreamRc, AppError> {
    let mut props = properties! {
        *pw::keys::MEDIA_TYPE => "Audio",
        *pw::keys::MEDIA_CATEGORY => "Capture",
        *pw::keys::MEDIA_ROLE => "Communication",
        "target.object" => target,
        *pw::keys::NODE_DONT_RECONNECT => "true",
        "node.dont-fallback" => "true",
        "node.dont-move" => "true",
    };
    for (key, value) in extra {
        props.insert(*key, *value);
    }
    pw::stream::StreamRc::new(core.clone(), name, props).map_err(pipewire_error)
}

/// Starts recording a playback source.
pub(super) fn open_playback(
    source: &CaptureSource,
    stop_flag: &Arc<AtomicBool>,
) -> Result<OpenedCapture<LoopThread>, AppError> {
    let mut context = StreamContext::new(stop_flag, TARGET_SAMPLE_RATE_HZ, TARGET_SAMPLE_RATE_HZ);
    context.fills_gaps = true;
    let output = Output {
        pending: Arc::clone(&context.pending_pcm_samples),
        level: Arc::clone(&context.current_level),
        callback_count: Arc::clone(&context.callback_count),
        stream_error: Arc::clone(&context.stream_error),
        status: Arc::clone(&context.status),
    };
    let source = source.clone();
    let stream = spawn_loop("tyco-pw-capture", move |main_loop, core, ready| {
        let state = match source {
            CaptureSource::Application { app_id } => capture_application(core, app_id, output)?,
            _ => capture_system_mix(core, output)?,
        };
        ready();
        main_loop.run();
        drop(state);
        Ok(())
    })?;
    Ok(OpenedCapture {
        stream,
        context,
        output_sample_rate_hz: TARGET_SAMPLE_RATE_HZ,
    })
}

/// The parts of `StreamContext` the loop thread writes to.
#[derive(Clone)]
struct Output {
    pending: Arc<Mutex<Vec<i16>>>,
    level: Arc<Mutex<(f32, f32)>>,
    callback_count: Arc<std::sync::atomic::AtomicU64>,
    stream_error: Arc<Mutex<Option<String>>>,
    status: Arc<Mutex<SourceStatus>>,
}

impl Output {
    fn deliver(&self, samples: &[f32]) {
        let context = StreamContext {
            pending_pcm_samples: Arc::clone(&self.pending),
            stream_error: Arc::clone(&self.stream_error),
            recoverable_error: Arc::default(),
            current_level: Arc::clone(&self.level),
            callback_count: Arc::clone(&self.callback_count),
            stop_flag: Arc::default(),
            device_sample_rate_hz: TARGET_SAMPLE_RATE_HZ,
            output_sample_rate_hz: TARGET_SAMPLE_RATE_HZ,
            fills_gaps: true,
            status: Arc::clone(&self.status),
        };
        context.deliver(samples);
    }

    fn fail(&self, message: String) {
        *self.stream_error.locked() = Some(message);
    }
}

fn on_core_error(core: &pw::core::CoreRc, output: Output) -> pw::core::Listener {
    core.add_listener_local()
        .error(move |id, _seq, _res, message| {
            // id 0 is the connection itself: the server went away
            if id == 0 {
                output.fail(format!("PipeWire connection failed: {message}"));
            }
        })
        .register()
}

/// The monitor of the default sink; PipeWire moves the stream along when
/// the default output changes, from headphones to speakers.
fn capture_system_mix(
    core: &pw::core::CoreRc,
    output: Output,
) -> Result<Box<dyn std::any::Any>, AppError> {
    let stream = pw::stream::StreamRc::new(
        core.clone(),
        "tyco-listen",
        properties! {
            *pw::keys::MEDIA_TYPE => "Audio",
            *pw::keys::MEDIA_CATEGORY => "Capture",
            *pw::keys::MEDIA_ROLE => "Communication",
            *pw::keys::STREAM_CAPTURE_SINK => "true",
        },
    )
    .map_err(pipewire_error)?;
    let process_output = output.clone();
    let error_output = output.clone();
    let mut samples = Vec::new();
    let listener = stream
        .add_local_listener::<()>()
        .state_changed(move |_, _, _, state| {
            if let pw::stream::StreamState::Error(message) = state {
                error_output.fail(format!("PipeWire capture failed: {message}"));
            }
        })
        .process(move |stream, _| {
            take_samples(stream, &mut samples);
            process_output.deliver(&samples);
        })
        .register()
        .map_err(pipewire_error)?;
    connect_capture(&stream, TARGET_SAMPLE_RATE_HZ)?;
    let core_listener = on_core_error(core, output);
    Ok(Box::new((stream, listener, core_listener)))
}

/// The application behind a PipeWire client. Only the client knows it: a
/// stream node carries no binary, and its name may differ (`pw-play` plays
/// as client `pw-cat`).
#[derive(Clone, Debug, PartialEq)]
struct ClientApp {
    app_id: AudioAppId,
    label: String,
    icon_name: Option<String>,
    is_own: bool,
}

impl ClientApp {
    fn from_props(props: &DictRef) -> Option<Self> {
        let app_id = app_id_in(props)?;
        Some(Self {
            label: props
                .get(*pw::keys::APP_NAME)
                .map(str::to_owned)
                .unwrap_or_else(|| app_id.clone()),
            icon_name: props.get(*pw::keys::APP_ICON_NAME).map(str::to_owned),
            is_own: is_own(props),
            app_id,
        })
    }
}

struct ClientEntry {
    /// `None` until the client's info arrives.
    app: Rc<RefCell<Option<ClientApp>>>,
    _proxy: pw::client::Client,
    _listener: pw::client::ClientListener,
}

/// An output stream node: what plays sound.
struct NodeEntry {
    client_id: Option<u32>,
    serial: String,
    icon_name: Option<String>,
}

/// The clients and output streams of the PipeWire graph, kept up to date.
/// Whoever owns it reconciles what it records with them in `on_change`.
struct Directory {
    clients: RefCell<HashMap<u32, ClientEntry>>,
    nodes: RefCell<HashMap<u32, NodeEntry>>,
    on_change: RefCell<Option<Box<dyn Fn()>>>,
}

impl Directory {
    fn notify(&self) {
        if let Some(on_change) = self.on_change.borrow().as_ref() {
            on_change();
        }
    }

    fn app_of_client(&self, client_id: u32) -> Option<ClientApp> {
        self.clients
            .borrow()
            .get(&client_id)
            .and_then(|client| client.app.borrow().clone())
    }

    /// The output nodes whose application is known, with that application.
    fn playing_nodes(&self) -> Vec<(u32, String, ClientApp, Option<String>)> {
        self.nodes
            .borrow()
            .iter()
            .filter_map(|(id, node)| {
                let app = self.app_of_client(node.client_id?)?;
                (!app.is_own).then(|| (*id, node.serial.clone(), app, node.icon_name.clone()))
            })
            .collect()
    }

    fn has_client_of(&self, app_id: &str) -> bool {
        self.clients.borrow().values().any(|client| {
            client
                .app
                .borrow()
                .as_ref()
                .is_some_and(|app| app.app_id == app_id)
        })
    }
}

/// Follows the graph of `core`; the listeners live as long as the result.
fn follow_graph(
    core: &pw::core::CoreRc,
) -> Result<(Rc<Directory>, Box<dyn std::any::Any>), AppError> {
    let registry = core.get_registry_rc().map_err(pipewire_error)?;
    let directory = Rc::new(Directory {
        clients: RefCell::default(),
        nodes: RefCell::default(),
        on_change: RefCell::new(None),
    });
    let on_global = Rc::downgrade(&directory);
    let on_remove = Rc::downgrade(&directory);
    let bind_registry = registry.downgrade();
    let listener = registry
        .add_listener_local()
        .global(move |global| {
            let (Some(directory), Some(props)) = (on_global.upgrade(), global.props) else {
                return;
            };
            match global.type_ {
                ObjectType::Client => {
                    let Some(registry) = bind_registry.upgrade() else {
                        return;
                    };
                    let Ok(proxy) = registry.bind::<pw::client::Client, _>(global) else {
                        return;
                    };
                    // the global props lack the binary: the app is known from the info
                    let app = Rc::new(RefCell::new(None));
                    let info_app = Rc::clone(&app);
                    let info_directory = Rc::downgrade(&directory);
                    let listener = proxy
                        .add_listener_local()
                        .info(move |info| {
                            let Some(props) = info.props() else {
                                return;
                            };
                            let next = ClientApp::from_props(props);
                            if *info_app.borrow() != next {
                                *info_app.borrow_mut() = next;
                                if let Some(directory) = info_directory.upgrade() {
                                    directory.notify();
                                }
                            }
                        })
                        .register();
                    directory.clients.borrow_mut().insert(
                        global.id,
                        ClientEntry {
                            app,
                            _proxy: proxy,
                            _listener: listener,
                        },
                    );
                    directory.notify();
                }
                ObjectType::Node
                    if props.get(*pw::keys::MEDIA_CLASS) == Some(OUTPUT_STREAM_CLASS) =>
                {
                    let Some(serial) = props.get("object.serial") else {
                        return;
                    };
                    directory.nodes.borrow_mut().insert(
                        global.id,
                        NodeEntry {
                            client_id: props
                                .get(*pw::keys::CLIENT_ID)
                                .and_then(|id| id.parse().ok()),
                            serial: serial.to_owned(),
                            icon_name: props.get(*pw::keys::APP_ICON_NAME).map(str::to_owned),
                        },
                    );
                    directory.notify();
                }
                _ => {}
            }
        })
        .global_remove(move |id| {
            let Some(directory) = on_remove.upgrade() else {
                return;
            };
            let client = directory.clients.borrow_mut().remove(&id);
            let node = directory.nodes.borrow_mut().remove(&id);
            if client.is_some() || node.is_some() {
                directory.notify();
            }
            drop(client);
        })
        .register();
    Ok((directory, Box::new((registry, listener))))
}

type CaptureStreamEntry = (pw::stream::StreamRc, pw::stream::StreamListener<()>);

struct AppCapture {
    app_id: AudioAppId,
    core: pw::core::CoreRc,
    output: Output,
    mixer: RefCell<StreamMixer>,
    streams: RefCell<HashMap<u32, CaptureStreamEntry>>,
    has_seen_client: std::cell::Cell<bool>,
}

impl AppCapture {
    /// Records every stream of the application and lets go of those gone.
    fn reconcile(self: &Rc<Self>, directory: &Directory) {
        let wanted: HashMap<u32, String> = directory
            .playing_nodes()
            .into_iter()
            .filter(|(_, _, app, _)| app.app_id == self.app_id)
            .map(|(id, serial, _, _)| (id, serial))
            .collect();
        let gone: Vec<u32> = self
            .streams
            .borrow()
            .keys()
            .filter(|id| !wanted.contains_key(id))
            .copied()
            .collect();
        for id in gone {
            self.remove(id);
        }
        for (id, serial) in wanted {
            if !self.streams.borrow().contains_key(&id) {
                self.add(id, &serial);
            }
        }
        self.output.status.locked().is_waiting = self.streams.borrow().is_empty();
        if directory.has_client_of(&self.app_id) {
            self.has_seen_client.set(true);
        } else if self.has_seen_client.replace(false) {
            self.output.status.locked().is_lost = true;
        }
    }

    fn add(self: &Rc<Self>, id: u32, serial: &str) {
        let Ok(stream) = stream_of_target(&self.core, "tyco-listen-app", serial, &[]) else {
            self.output
                .fail(format!("Could not create a capture stream for node {id}"));
            return;
        };
        let weak = Rc::downgrade(self);
        let error_output = self.output.clone();
        let mut samples = Vec::new();
        let listener = stream
            .add_local_listener::<()>()
            .state_changed(move |_, _, _, state| {
                if let pw::stream::StreamState::Error(message) = state {
                    error_output.fail(format!("PipeWire application capture failed: {message}"));
                }
            })
            .process(move |stream, _| {
                take_samples(stream, &mut samples);
                if let Some(capture) = weak.upgrade() {
                    let mixed = {
                        let mut mixer = capture.mixer.borrow_mut();
                        mixer.push(id, &samples);
                        mixer.drain()
                    };
                    capture.output.deliver(&mixed);
                }
            })
            .register();
        let Ok(listener) = listener else {
            self.output
                .fail(format!("Could not observe capture stream {id}"));
            return;
        };
        if let Err(error) = connect_capture(&stream, TARGET_SAMPLE_RATE_HZ) {
            self.output
                .fail(format!("Could not record node {id}: {error}"));
            return;
        }
        self.mixer.borrow_mut().add_stream(id);
        self.streams.borrow_mut().insert(id, (stream, listener));
    }

    fn remove(&self, id: u32) {
        let removed = self.streams.borrow_mut().remove(&id);
        if let Some((stream, listener)) = removed {
            let _ = stream.disconnect();
            drop(listener);
            let mixed = {
                let mut mixer = self.mixer.borrow_mut();
                mixer.remove_stream(id);
                mixer.drain()
            };
            self.output.deliver(&mixed);
        }
    }
}

/// Every output stream of `app_id`, now and as it starts new ones.
fn capture_application(
    core: &pw::core::CoreRc,
    app_id: AudioAppId,
    output: Output,
) -> Result<Box<dyn std::any::Any>, AppError> {
    output.status.locked().is_waiting = true;
    let (directory, graph) = follow_graph(core)?;
    let capture = Rc::new(AppCapture {
        app_id,
        core: core.clone(),
        output: output.clone(),
        mixer: RefCell::new(StreamMixer::new(
            u64::from(TARGET_SAMPLE_RATE_HZ) * MIX_MAX_LAG_MS / 1_000,
        )),
        streams: RefCell::default(),
        has_seen_client: std::cell::Cell::new(false),
    });
    let weak_capture = Rc::downgrade(&capture);
    let weak_directory = Rc::downgrade(&directory);
    *directory.on_change.borrow_mut() = Some(Box::new(move || {
        if let (Some(capture), Some(directory)) = (weak_capture.upgrade(), weak_directory.upgrade())
        {
            capture.reconcile(&directory);
        }
    }));
    let core_listener = on_core_error(core, output);
    Ok(Box::new((graph, directory, capture, core_listener)))
}

/// The applications of `nodes`, the loudest stream of each giving its level.
fn group_apps<'a>(
    nodes: impl Iterator<Item = (&'a AudioAppId, &'a str, Option<&'a str>, f32)>,
) -> Vec<AudioApp> {
    let mut apps: Vec<AudioApp> = Vec::new();
    for (id, label, icon_name, level) in nodes {
        match apps.iter_mut().find(|app| &app.id == id) {
            Some(app) => {
                app.level = app.level.max(level);
                if app.icon_name.is_none() {
                    app.icon_name = icon_name.map(str::to_owned);
                }
            }
            None => apps.push(AudioApp {
                id: id.clone(),
                label: label.to_owned(),
                icon_name: icon_name.map(str::to_owned),
                level,
            }),
        }
    }
    apps.sort_by_key(|app| app.label.to_lowercase());
    apps
}

/// The peak meter of one playing node.
struct Meter {
    peak: Rc<std::cell::Cell<f32>>,
    _stream: Option<CaptureStreamEntry>,
}

/// Reports the applications that play sound, with their levels, until the
/// returned handle is dropped.
pub(super) fn watch_apps(
    on_change: Box<dyn Fn(Vec<AudioApp>) + Send>,
) -> Result<LoopThread, AppError> {
    spawn_loop("tyco-pw-apps", move |main_loop, core, ready| {
        let (directory, graph) = follow_graph(core)?;
        let meters: Rc<RefCell<HashMap<u32, Meter>>> = Rc::default();
        let reconcile_meters = Rc::clone(&meters);
        let weak_directory = Rc::downgrade(&directory);
        let meter_core = core.clone();
        *directory.on_change.borrow_mut() = Some(Box::new(move || {
            let Some(directory) = weak_directory.upgrade() else {
                return;
            };
            let playing = directory.playing_nodes();
            let mut meters = reconcile_meters.borrow_mut();
            meters.retain(|id, _| playing.iter().any(|(node, ..)| node == id));
            for (id, serial, _, _) in playing {
                meters.entry(id).or_insert_with(|| {
                    let peak = Rc::new(std::cell::Cell::new(0.0_f32));
                    Meter {
                        _stream: peak_stream(&meter_core, &serial, Rc::clone(&peak)),
                        peak,
                    }
                });
            }
        }));

        let timer_directory = Rc::clone(&directory);
        let timer_meters = Rc::clone(&meters);
        let last: RefCell<Option<Vec<AudioApp>>> = RefCell::new(None);
        let timer = main_loop.loop_().add_timer(move |_| {
            let playing = timer_directory.playing_nodes();
            let meters = timer_meters.borrow();
            let levels: Vec<f32> = playing
                .iter()
                .map(|(id, ..)| meters.get(id).map_or(0.0, |meter| meter.peak.replace(0.0)))
                .collect();
            let apps = group_apps(playing.iter().zip(levels).map(
                |((_, _, app, node_icon), level)| {
                    (
                        &app.app_id,
                        app.label.as_str(),
                        app.icon_name.as_deref().or(node_icon.as_deref()),
                        level,
                    )
                },
            ));
            if last.borrow().as_ref() != Some(&apps) {
                on_change(apps.clone());
                *last.borrow_mut() = Some(apps);
            }
        });
        timer
            .update_timer(Some(Duration::from_millis(1)), Some(APPS_EMIT_INTERVAL))
            .into_result()
            .map_err(|error| AppError::Failed(format!("PipeWire timer: {error}")))?;
        ready();
        main_loop.run();
        drop((timer, meters, directory, graph));
        Ok(())
    })
}

/// A stream of the peaks of `serial`: PipeWire's resampler hands out the
/// loudest sample of each period instead of an average.
fn peak_stream(
    core: &pw::core::CoreRc,
    serial: &str,
    peak: Rc<std::cell::Cell<f32>>,
) -> Option<CaptureStreamEntry> {
    let stream = stream_of_target(
        core,
        "tyco-listen-meter",
        serial,
        &[
            ("resample.peaks", "true"),
            (*pw::keys::NODE_PASSIVE, "true"),
        ],
    )
    .ok()?;
    let mut samples = Vec::new();
    let listener = stream
        .add_local_listener::<()>()
        .process(move |stream, _| {
            take_samples(stream, &mut samples);
            let loudest = samples
                .iter()
                .fold(0.0_f32, |max, sample| max.max(sample.abs()));
            peak.set(peak.get().max(loudest.min(1.0)));
        })
        .register()
        .ok()?;
    connect_capture(&stream, PEAK_RATE_HZ).ok()?;
    Some((stream, listener))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lookup(pairs: &'static [(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> {
        move |key| {
            pairs
                .iter()
                .find(|(name, _)| *name == key)
                .map(|(_, value)| (*value).to_owned())
        }
    }

    #[test]
    fn the_binary_identifies_an_application() {
        assert_eq!(
            app_id_of(lookup(&[
                ("application.name", "Telegram Desktop"),
                ("application.process.binary", "telegram-desktop"),
            ])),
            Some("telegram-desktop".into())
        );
    }

    #[test]
    fn a_flatpak_app_id_wins_over_the_binary() {
        assert_eq!(
            app_id_of(lookup(&[
                ("application.process.binary", "Telegram"),
                ("pipewire.access.portal.app_id", "org.telegram.desktop"),
            ])),
            Some("org.telegram.desktop".into())
        );
    }

    #[test]
    fn empty_portal_metadata_does_not_hide_a_native_application() {
        assert_eq!(
            app_id_of(lookup(&[
                ("pipewire.access.portal.app_id", "  "),
                ("application.process.binary", "firefox"),
            ])),
            Some("firefox".into())
        );
    }

    #[test]
    fn the_name_stands_in_for_a_missing_binary() {
        assert_eq!(
            app_id_of(lookup(&[("application.name", "Firefox")])),
            Some("Firefox".into())
        );
        assert_eq!(app_id_of(lookup(&[("application.name", "  ")])), None);
    }

    #[test]
    fn streams_of_one_application_are_one_entry_at_their_loudest() {
        let firefox = "firefox".to_owned();
        let telegram = "telegram-desktop".to_owned();
        let apps = group_apps(
            [
                (&telegram, "Telegram", None, 0.2),
                (&firefox, "Firefox", Some("firefox"), 0.1),
                (&firefox, "Firefox", Some("firefox"), 0.7),
            ]
            .into_iter(),
        );
        assert_eq!(apps.len(), 2);
        assert_eq!(apps[0].id, "firefox");
        assert_eq!(apps[0].level, 0.7);
        assert_eq!(apps[0].icon_name.as_deref(), Some("firefox"));
        assert_eq!(apps[1].label, "Telegram");
    }
}

/// Needs a PipeWire server and `pw-play`; run with `--ignored`.
#[cfg(test)]
mod live_tests {
    use super::*;

    fn tone_wav(path: &std::path::Path) {
        let rate: u32 = 48_000;
        let samples: Vec<u8> = (0..rate * 4)
            .flat_map(|i| {
                let phase = f64::from(i) * 440.0 * std::f64::consts::TAU / f64::from(rate);
                ((phase.sin() * 8_000.0) as i16).to_le_bytes()
            })
            .collect();
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(36 + samples.len() as u32).to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16_u32.to_le_bytes());
        wav.extend_from_slice(&1_u16.to_le_bytes());
        wav.extend_from_slice(&1_u16.to_le_bytes());
        wav.extend_from_slice(&rate.to_le_bytes());
        wav.extend_from_slice(&(rate * 2).to_le_bytes());
        wav.extend_from_slice(&2_u16.to_le_bytes());
        wav.extend_from_slice(&16_u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&(samples.len() as u32).to_le_bytes());
        wav.extend_from_slice(&samples);
        std::fs::write(path, wav).unwrap();
    }

    #[test]
    #[ignore = "needs a PipeWire server and pw-play"]
    fn integration_records_the_system_sound_and_one_application() {
        let dir = std::env::temp_dir().join(format!("tyco-pw-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let wav = dir.join("tone.wav");
        tone_wav(&wav);
        let mut play = std::process::Command::new("pw-play")
            .arg(&wav)
            .spawn()
            .unwrap();
        std::thread::sleep(Duration::from_millis(500));
        let stop = Arc::new(AtomicBool::new(false));
        let listed = Arc::new(Mutex::new(Vec::new()));
        let seen = Arc::clone(&listed);
        let watch = watch_apps(Box::new(move |apps| *seen.locked() = apps)).unwrap();

        let mix = open_playback(&CaptureSource::SystemMix, &stop).unwrap();
        let app = open_playback(
            &CaptureSource::Application {
                app_id: "pw-cat".into(),
            },
            &stop,
        )
        .unwrap();
        std::thread::sleep(Duration::from_millis(1_000));
        let mix_samples = mix.context.pending_pcm_samples.locked().len();
        let app_samples = app.context.pending_pcm_samples.locked().len();
        let app_level = listed
            .locked()
            .iter()
            .find(|entry| entry.id == "pw-cat")
            .map(|entry| entry.level);
        let _ = play.kill();
        let _ = play.wait();
        std::thread::sleep(Duration::from_millis(500));
        let status = *app.context.status.locked();
        drop((mix, app, watch));
        let _ = std::fs::remove_dir_all(&dir);

        assert!(mix_samples > 8_000, "{mix_samples}");
        assert!(app_samples > 8_000, "{app_samples}");
        assert!(app_level.is_some_and(|level| level > 0.0), "{app_level:?}");
        assert!(status.is_waiting && status.is_lost, "{status:?}");
    }
}
