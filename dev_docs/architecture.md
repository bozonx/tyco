# Architecture and verification

TyCo is a desktop application with two trusted windows: `main` owns settings,
plugin installation and key management; `quick` owns background jobs and
activation. External plugin code runs in a worker on a separate custom origin.

## Frontend dependencies

- Views and components render UI and delegate operations to stores/composables.
- Pinia stores wire dependencies and expose reactive model state.
- `src/lib/` contains feature models and infrastructure adapters. Models must
  not import components, views, stores or composables; ESLint enforces this.
- Native APIs live behind `lib/desktop/` and `lib/net/tauri-net.ts`.
- `@tyco/shared` contains wire contracts and config types; `@tyco/plugin-sdk`
  contains the independently usable plugin contract.

Utilities, stores and composables use kebab-case filenames. Vue components
and their adjacent component tests retain PascalCase component names.
Components are grouped by feature (`chat`, `editor`, `history`, `quick`,
`settings`); shared presentation primitives live in `components/common`.

Settings tabs edit a draft owned by `createSettingsSession`, not persisted
state. The four tabs that deliberately mutate that draft have explicit local
ESLint exceptions. Config normalization and autosave are separate tested models.
Saves send the local edits applied to the stored baseline, and the baseline;
what only the webview fills in (plugin defaults) is not written unchanged.
Rust merges independently changed fields under the config lock and rejects
concurrent conflicting edits (including arrays). A rejected save preserves the
draft. A conflict pauses the autosave until the user keeps their values or takes
the other window's ones for the conflicting fields; other local edits stay
either way, and only "Reload" discards them. New edits during a save are rebased
onto its result. The session follows the stored config (`savedUserConfig`), not
the config an external run brings. On exit the webview flushes the config and
every draft registered with `registerDraft` (AI profiles and projects).

## Backend and trust boundaries

`commands/` adapts IPC to services and holds no workflow of its own.
`models/` holds the wire types and typed views of the config
(`models/user_config.rs`); it depends on no service. `services/` is grouped by
domain: `activation/` (coordinator, metrics, local socket), `settings/`
(schema, three-way merge, version, defaults, session state), `external/`
(the API shared by `tyco-ctl` and D-Bus, its jobs, commands and access prompt),
`secrets/` (store, webhook headers, history redaction) and `voice/`.
`services/platform/` owns OS/session APIs, the D-Bus server and the status
overlay among them. `services/storage/` separates config loading, file paths,
JSON files, editor history and chat history; existing callers use its public
facade.

`AppState` holds the desktop snapshot, the settings lock, the history
coordinator and the lifecycle phase (running, quitting, shutting down). Other
domains manage their own state (`NetState`, `SecretStore`, `ChatImages`,
`VoiceSessionState`, `ToolCatalogState`, ...): state that needs nothing is
managed on the builder, state built from the config or a window in `setup`,
after the config is read and before the windows exist.

Errors cross IPC as `AppError` with a stable `code`. Calls from outside use
the `ErrorCode` of `tyco-activation-protocol`, which also maps each code to
the exit status of `tyco-ctl`.

Settings orchestration lives in `services/settings.rs`, with supplied secret,
hotkey, config-storage, history and publication effects. History policies and
network origin authorization use typed views parsed at the config boundary.
An editor storage-mode transition prepares its destination before the config
write while retaining its source. Failed writes restore the previous config and
prepared editor file. A successful write updates the desktop snapshot once,
under the history repository locks, before irreversible retention cleanup.
Cleanup failures keep the committed policy and are retried by maintenance,
later saves and startup; a partially applied chat journal is replayed forward.

`services/background.rs` owns admission, cancellation and a lease-based
completion barrier for application services. Blocking work keeps its lease even
if its async caller is cancelled. Local control, D-Bus, window trackers, portal
streams, selection workers and warmup participate in shutdown. After both
webviews flush settings, the coordinator runs off the UI thread and shares a
three-second deadline across voice, network, scripts, platform cleanup and
background services, each a `StoppableService`: all are cancelled before the
first wait. Stalled native workers are reported rather than joined
indefinitely. Each application owns its script registry, including unnamed runs;
intentionally detached applications remain independent of Tyco's lifetime.

The network gateway owns request startup and uses one limit of 32 active HTTP
and WebSocket operations, including request preparation. Cancellation releases
capacity only when the operation lease is dropped. Shutdown closes admission,
rejects late socket registration and waits for outstanding leases.

Activation policy lives in `services/activation/coordinator.rs`, with a supplied
window host and generation checks that discard late context captures. Generation
allocation and window mutation run together on the main-thread executor; no
coordinator lock is held while another thread waits for that executor.
`SelectionRuns` coordinates capture, cancellation, publication and completion
through a supplied backend; clipboard and focused-window effects live in
`platform/selection.rs`. Paste and hotkey policies accept substitutable input
and registration adapters, including rollback after a shortcut conflict.
Voice capture accepts an audio source, level output and polling runtime;
`platform/audio.rs` opens the microphone through CPAL and the sound the
computer plays natively: PipeWire on Linux (`audio/pipewire.rs`: the default
sink's monitor, or every output stream of one application, mixed by
`voice/mixer.rs`) and WASAPI process loopback on Windows (`audio/wasapi.rs`).
A playback source delivers nothing while nothing plays, so the capture loop
fills the gap with silence (`voice/source.rs`), switches the source in place
(`switch_capture_source`) and waits for the same application when it quits.
Recording other applications requires an explicit source selection. The new
stream's overlapping setup audio is discarded at handover, so that it cannot
repeat the old stream's tail. An application is identified by its binary (Flatpak app
id on Linux, the executable of its process tree's root on Windows), never by
a process id. Lifecycle tests use fake streams and outputs to check setup
failure, timeout, final audio ordering, stale stops, source switches and gap
filling; `integration_records_the_system_sound_and_one_application` runs
against a real PipeWire server.
Listening capabilities are probed off the UI thread, initially and every five
seconds, under the background-service shutdown barrier. Linux probes a completed
PipeWire round trip with a one-second deadline rather than caching login-time
availability. Capture stream errors are reported, including asynchronous
PipeWire stream failures. Windows probes process-loopback activation and stream
initialization instead of guessing from an OS build number; whole-system
capture falls back to default-device WASAPI loopback, following endpoint
changes. Application capture mixes all matching independent process trees.
Session meters enumerate all active render endpoints on each poll, including
applications routed away from the default device. Opening and dropping source
watches runs on the blocking pool, not the async executor.

Live STT connection policy is separate from capture lifetime. Gemini rotates
connections gracefully after eight minutes of wall time or audio, and earlier
on `goAway`. The capture and its bounded in-memory queue remain alive while the
old connection drains and the next one opens. No audio or settled transcript is
replayed; timestamps gain the preceding audio duration, and an outstanding
recognized draft is retained at a rotation boundary. Rotation applies to voice
input too. Cancellation or a genuine provider failure ends the workflow rather
than retrying indefinitely. Tests use short limits and controlled queues to
exercise multiple connections, final draining, cancellation and exact audio
ownership without waiting eight minutes.

The policy was checked against the [Gemini session-management guide](https://ai.google.dev/gemini-api/docs/live-api/session-management)
(approximately ten minutes per connection and fifteen minutes of audio without
compression), [Deepgram streaming timeout guidance](https://developers.deepgram.com/docs/stt-troubleshooting-websocket-data-and-net-errors)
and the [sherpa streaming-server protocol](https://k2-fsa.github.io/sherpa/onnx/websocket/online-websocket.html).
Deepgram continues receiving PCM silence through playback gaps; no shorter fixed
session limit is assumed. Sherpa session limits depend on the configured server.
A custom server or proxy that closes early produces an explicit error and keeps
recognized text. No claim is made that arbitrary server policies can be bypassed.

Listening asks for continuous endpointing: Gemini receives quiet chunks and soft
speech too, without the dictation-only 1.5-second silence cutoff. Provider turns
are bounded to thirty seconds while capture continues. A voice reply passes the
heard message to correction and, when an AI request is chosen in the result menu
or through a buffered shortcut, uses it as context and the dictated text as the
request. This context belongs to one activation only.

Retention and polling tests supply timestamps or virtual time instead of sleeping.
The remaining device and compositor behavior belongs to desktop smoke tests.

The screenshot area selector temporarily reuses the quick window. On Wayland,
its layer-shell surface anchors to all output edges with exclusive zone `-1`,
so desktop panels do not offset or shrink the frozen image. Ordinary panel and
sheet profiles restore zone `0` when selection ends. Native verification should
check selection and cancellation with a visible desktop panel: the frozen image
must align with the screen, and the restored quick window must respect panels.

`build.rs` declares every app command in `AppManifest`. Capability files grant
explicit command permissions to `main`, `quick`, or both, without remote or
wildcard window access. The core event listener permissions are shared; native
focus/visibility/resize permissions belong to `quick`. Plugins receive neither
these capabilities nor direct network access. Plugin host operations enforce
the SDK capability list separately. Sandbox messages use serializable snapshots
so Vue proxies never cross a MessagePort. Resource URLs preserve path separators
and the Wry protocol prefix used by Windows; all three URL forms have unit tests.

Every installed plugin must supply every locale listed in
`packages/plugin-sdk/src/locales.json` with identical dictionary structure and
interpolation arguments. Both Rust and the
SDK validate this before activation. Dictionaries are never merged with another
locale. Incompatible installed packages remain visible so they can be removed.

## Checks and desktop smoke tests

`pnpm check:architecture` checks command registration against AppManifest,
frontend command names and explicit capabilities. Shared wire fixtures are
validated in TypeScript and checked against Rust serialization.

`pnpm validate:all` checks source quality, unit tests, frontend build and Rust.
CI additionally runs:

- `pnpm test:plugin-runtime` in Chromium for isolated worker behavior.
- Actual Linux AppImage/deb packaging and artifact upload.
- Required compilation and unit tests on Windows, and on macOS only to keep
  its unsupported backend compiling.
- `pnpm test:desktop` against a built debug app in WebKitGTK using Tauri WebDriver,
  Xvfb and a dedicated temporary `TYCO_DEV_HOME`.

The desktop smoke requires `tauri-driver` and `WebKitWebDriver` in PATH, plus a
running display and D-Bus session. Build with
`pnpm tauri:build --debug --no-bundle`, then run:

```sh
xvfb-run -a dbus-run-session -- sh -c 'openbox >/tmp/tyco-openbox.log 2>&1 & pnpm test:desktop'
```

It checks real IPC permissions, stale config saves, plugin custom-protocol/CSP
isolation and lazy route loading. It does not substitute for platform tests of
microphone capture, global hotkeys, clipboard restoration or injection into
foreign applications. These remain the platform-specific scenarios described
in `vm-testing.md`. Failed smoke tests produce a screenshot for CI artifacts.

Routes are loaded dynamically. Heavy optional renderers also use dynamic
imports. Track startup and memory measurements in the actual system webview;
chunk size alone is not an estimate of total memory or startup latency.
