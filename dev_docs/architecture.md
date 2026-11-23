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

Optional modes stay out of the startup path. The dialog (`docs/dialog.md`) is
one: `dialog.isEnabled` hides its tab and route, and a running dialog stops
and is saved when it is turned off. `DialogView` is a lazy route that brings
`stores/dialog.ts` and `lib/dialog/*` with it; the nav tab reads only
`stores/dialog-status.ts`. The `lib/dialog/*` models take capture, STT,
translation and history injected, and `stores/dialog.ts` is the one place that
wires them to other features. The history keeps a typed `dialog` block rather
than an opaque feature payload: it acts on it (a recorded session is kept, its
file is listed and checked) and journals are read by older builds on other
devices, so a generic block would change the format for no new capability.

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

## Operations, commands and tools

Three terms that look alike name different layers; keep them apart in code,
docs and UI:

- An **operation** (`lib/operations/`, `OperationDefinition` in the SDK,
  `core.*` or `<plugin>.<id>`) is what the app or a plugin can do. It has a
  config schema and an input schema, and nothing runs it by itself. The UI calls
  it the type of a command.
- A **command** (`lib/commands/`, `CommandConfig`) is the user's configured
  instance of an operation: `operationId` + `operationConfig`, name,
  description, hotkey, voice phrases, platforms and output. A command is the
  only way to reach an action outside the chat: hotkeys, toolbar, action menu,
  voice, `tyco-ctl`/D-Bus and AI commands all run commands. A plugin toolbar
  button may reference an operation directly.
- A **tool** (`lib/chat-tools/`, `ChatToolDefinition`) is what an LLM sees and
  calls in a tool loop. Tools come only from `ChatToolProvider`s: built-in ones
  (files, web, memory, reply blocks), the `commands` provider (commands the
  profile selected, each with a description for the AI), plugin `chatTools`
  and, later, MCP servers. An operation never becomes a tool without a command
  or a `chatTools` contribution.

## Tool sources and permissions

TyCo's profiles are assistants, not code agents, and the rule is
predictability: the agent can do exactly what the user set up and nothing more.
Out of the box a profile's tools see only its `workspace/` and the projects
connected to it; an outside folder is reached only as an external project.
Plugins and commands may reach further, but only because the user installed or
wrote them. There is no computer use: no screen, clipboard, selection or window
tools. No tool changes settings, permissions, profiles, projects or commands
(`TOOL_COMMANDS` in `services/ai_tools/permissions.rs` and
`CHAT_TOOL_COMMANDS` in `desktop-chat-tools.ts` keep the list).

**Sources.** Every `ChatToolDefinition` names its `source` (`core`, `plugin`,
`mcp`, `commands` + id) and its `risk`: `read`, `write`, `destructive`,
`external`. `lib/chat-tools/tool-catalog.ts` holds the keys (`<kind>:<id>` and
`<kind>:<id>:<tool>`, `:` escaped; Rust mirrors them), the defaults and
`toolStateIn(scope, tool)`, which decides a tool's state where it is offered:
`off` (the model does not see it), `ask` or `allow`. There is no `deny` for a
tool; it stays only in project permissions.

- `external` is a request outside the app: the network, a script, another
  program. The web tools are `external` yet run freely by default
  (`defaultPolicy: 'allow'`); their leak target asks once the chat holds
  personal data.
- Default policy: `read` → `allow`, the rest → `ask`. Commands ask (their risk
  is `external`: Tyco cannot know what they do; the profile may allow them); an AI command called as a tool
  has the highest risk of its whitelist (`commandRisk`), the web counting as
  `external` there, since inside the command it has no leak protection. A third-party plugin's
  tools ask whatever risk they declare; MCP hints will count only for a trusted
  server.
- Memory, the reply blocks and the attachments are always on and never ask;
  `memoryMode` (`auto`, `read-only`, `off`) decides only whether the memory is
  there and writable. The file tools take their policy from the project
  permissions; changes to existing files in `workspace/` ask. New files can use the create-only option, which refuses to overwrite an existing file. `move_path`
  needs deleting where the file comes from and writing where it goes.
  Changing the memory asks once the chat took in untrusted content (a web
  page, a command's or a plugin's output; `givesUntrustedContent`,
  `asksAfterUntrustedContent`): the memory steers every chat to come.

**Two levels.** Globally (`tools.sources` and `tools.tools` in the user
config, Settings → Tools) any source or single tool of the catalog, core ones
included, can be switched off everywhere: "Ask AI", profiles and AI commands
never get it (`isToolAvailable`; Rust `is_tool_available`). Everything is on by
default; the always-on helpers are not switched there. A profile (`AiProfile.tools`: `sources`, `tools`, `commandIds`)
keeps only its differences from the defaults: `core` and `plugin` sources are
on, commands and MCP servers are picked. Project permissions are on the
profile ↔ project link with `read`, `write` and `delete` (never freer than
`write`; `normalizedProjectPermission`, `ProjectPermission::effective_delete`).

**Where the call comes from** (`ToolScope` in the webview, `ToolCallContext`
over IPC):

- `askAi`: the web by `llm.tasks.chat.isWebSearchEnabled` (on when unset), the
  reply blocks and the attachments, all `allow`. No files, memory, commands,
  plugin tools or MCP: that is a boundary, not a setting.
- `profile`: the profile's settings as above; `ask` reaches the user in the
  chat window.
- `aiCommand`: its whitelist `AiCommandOperationConfig.tools: ToolRef[]`, all
  `allow`, since an AI command often runs with no window to ask in. No files or
  memory. An AI command never runs itself or a command that led to it, and
  nests at most `AI_COMMAND_MAX_DEPTH` deep. Called from a profile chat it runs
  in its own context; the chat asks about the call by its risk.

Rust checks every call of the tools it runs (`ensure_web_tool_allowed`,
`ensure_file_tool_allowed`, the project permissions, `memoryMode`), reading the
profile or the config anew each time. It does not know whether the user was
asked; it checks that the source and the tool are not switched off everywhere
nor `off` in the profile, and that the project permission is not `deny`. Plugin tools run in the webview, which checks them.

**Approvals** (`ChatToolApproval.vue`): allow once, allow in this chat (kept
with the chat as `Chat.toolPermissions`, given back when it is reopened),
always allow (writes `allow` into the profile for a tool that asks, raises the
project permission when applicable, and saves before the call runs), and deny.
The chat header can clear chat-level grants. Calls of one model step can be
allowed or denied together. A reviewed file write checks its preview again
before applying the change.

**Leak protection.** Once a chat holds personal data, network calls can
require approval even when the tool is enabled. A one-time approval covers the
current invocation. Chat-level approval can remember a destination. Search
results register structured result URLs while the chat is open. History
restores data and content sensitivity from earlier tool results, conservatively
treating results from unavailable tools as personal and untrusted. AI commands
use their own whitelist without interactive confirmation.

## Backend and trust boundaries

`commands/` adapts IPC to services and holds no workflow of its own.
`models/` holds the wire types and typed views of the config
(`models/user_config.rs`); it depends on no service. `services/` is grouped by
domain: `activation/` (coordinator, metrics, local socket), `settings/`
(schema, three-way merge, version, defaults, session state), `external/`
(the API shared by `tyco-ctl` and D-Bus, the command run slot, its jobs,
commands and access step),
`secrets/` (store, webhook headers, history redaction) and `voice/`.
`services/platform/` owns OS/session APIs, the D-Bus server and the status
overlay among them. `services/storage/` separates config loading, file paths,
JSON files, editor history and chat history; existing callers use its public
facade.

`AppState` holds the desktop snapshot, the settings lock, the history
coordinator and the lifecycle phase (running, quitting, shutting down). Other
domains manage their own state (`NetState`, `SecretStore`, `ChatImages`,
`VoiceSessionState`, `OperationCatalogState`, ...): state that needs nothing is
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

Library command runs are visible and sequential. `ExternalJobs`
(`services/external/jobs.rs`) holds one run slot, taken atomically at the start
of a run, before any selection capture, and released when the job is terminal,
a pending selection replacement included; a second run fails with `Busy` and
`CommandRunRejected` tells the running overlay. External runs
(`api::job_execution::start`) and internal ones (`start_command_run`, from a
hotkey slot or the action menu) take the same slot and open
`ActivationMode::CommandRun`, an internal mode outside `PUBLIC_MODES`, with a
`CommandRunRequest` in the snapshot. The overlay claims the job
(`claim_external_job` returns what it runs and starts the run limit,
`commandRunTimeoutSec` of the config), asks for access or text when needed and
finishes it; Esc cancels it through `cancel_external_job`. Before replacing a
selection the backend hides the overlay and waits for the focus to leave it. A
reload of the quick webview (`on_page_load`) fails the active job. The status
bubble remains only for `replace correction` and the selection hotkeys.

`commandRunTimeoutSec` (0: unbounded) is the one run limit of all library
commands. The backend applies it to overlay jobs; runs outside the overlay,
voice commands and the commands a chat calls as tools, are bounded in the
webview by `runWithinCommandLimit` (`lib/commands/command-run-limit.ts`).

Before an external `run` or `open` shows anything, `services/visible_work.rs`
asks both webviews (`EndVisibleWork`) to end what they show gracefully: the
voice dictation and the dialog stop recording and save their history, a command
run is cancelled. Each window answers with `visible_work_ended`; the request
waits for the answers for at most three seconds, off the main thread. A
rejected run ends nothing.

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
`voice/mixer.rs`) and WASAPI loopback on Windows (`audio/wasapi.rs`).
`microphoneAndSystemMix` opens the microphone and the system sound together;
`voice/microphone_mix.rs` brings each to a common loudness (a slow gated gain)
and sums them through the same mixer. The microphone keeps time and owns
the callback watchdog, so the mixed stream fills no gaps; a playback error
ends it like a microphone error.
The dialog (`CaptureSource::Dialog`) records the same two sources but keeps
them apart: `MixLayout::Separate` aligns them in two lanes of the mixer and
sends stereo PCM16, the microphone in the first channel; `VoiceCaptureInfo`
names the channel count and level events carry a level per channel. Before
normalization `voice/echo_gate.rs` mutes microphone blocks that are clearly
quieter than playback and follow its envelope: the speakers' echo without
headphones (real AEC is a later step). Without the microphone the dialog is
the system sound in one channel. A dialog capture is never superseded:
another capture fails with `AppError::CaptureBusy` (`captureBusy`), which
voice input, voice commands and listening show as "the sound is busy with the
dialog"; a dialog itself supersedes dictation. It has no duration limit.
A dialog started with `isRecorded` is also written to a new file of the
history (`storage/recordings.rs`, see `config-storage.md`): named
`YYYY-MM-DD HH-MM-SS <6 hex>.opus` by the local time, written in
`recordings/` of the state folder and moved into `history/recordings/` of the
data folder once closed; `VoiceCaptureInfo::recording_file` returns the name.
A recording needs the editor history on disk (`AppError::InvalidInput`
otherwise; the toolbar disables it) and a writable data folder. The file is
created before the capture reports started, so a folder that cannot be
written fails the start. `voice/recording.rs` encodes
Ogg/Opus while capturing (libopus via the `opus` crate, built from source
and linked statically; `ogg` for the pages): 16 kHz input, 20 ms frames,
VoIP mode, stereo at 32 kbit/s (microphone, computer) or mono at 24 kbit/s,
RFC 7845 granules at 48 kHz, a page at least every second.
The final page accounts for encoder delay and trims padding. Ogg pages stand
alone, so a crash leaves a file playable to its last complete page. By default (`dialog.isRecordingProcessed`) the file holds the very samples
sent to the webview, after the echo gate and the limiter: listening to it is
listening to what the speech provider got, short of Opus losses and of the
audio a channel drops when its provider stalls past 30 s (logged by the
webview). Unprocessed, it takes the two channels as the mix aligned them,
before the gate and the limiters: the mix keeps a copy of them in
`StreamContext::unprocessed_pcm_samples`, which `flush_pending` drains with
every flush; a capture without the microphone has none and records what it
sends. `dialog.isRecordingMixedDown`, off by default, writes the two channels
as one, their saturating sum (`RecordingSink::push`). Both are read from the
config when the recording starts (`models::user_config::dialog_recording`). For a
lossless copy set `TYCO_DUMP_STT_AUDIO=<folder>` before starting the app:
every capture, dictation included, also writes a WAV of the bytes it sends
(`voice/debug_dump.rs`). The encoder runs
on a thread of its own behind a bounded queue (`RecordingSink`). Chunks that
do not fit a full queue are owed and sent as silence when it frees or when
the recording closes. A gap over one minute or a failed write stops the
recording only and sends `recordingFailed` on the audio channel, and the
webview marks the history entry `isRecordingIncomplete`. A file whose
headers fail, or that received no audio, is removed. The capture's end, a stop or quit
closes the file and moves it into the data folder. The webview's history
names a recording by its file name (a `Dialog` entry with a `recordingFile`
is stored even without text, so the file stays reachable);
`check_dialog_recordings`, `show_dialog_recording` and
`discard_dialog_recording` accept only names of that pattern.
The history plays a recording inline with `<audio>`: on Windows from the
`tyco-media://` scheme (`services/media_protocol.rs`, allowed by `media-src`,
`http://tyco-media.localhost/recording/<file name>`), and on Linux from a
`blob:` URL created over `read_dialog_recording` (`lib/history/recording-media-url.ts`),
because WebKitGTK's GStreamer pipeline rejects custom URI schemes in
`isProtocolAllowed` while `blob:` is allowed and seekable.
The webview names the file, never a path; the backend accepts only names of the
pattern, serves no recording still being written, and `tyco-media://` answers byte ranges in
chunks of at most 2 MiB, so the element can seek a long call. A request
without a byte range receives the whole file in memory. Ogg/Opus
plays in WebView2 and in WebKitGTK with the base GStreamer plugins; the
AppImage bundles them (`bundle.linux.appimage.bundleMediaFramework`). The
history offers no playback while any capture runs: every capture publishes
`app://voice-audio-level` to all windows, which
`lib/voice/sound-capture-activity.ts` reads as a capture running. A dialog
stopped while its capture starts never names its recording in an entry: the
webview discards the file (`onCaptureAbandoned`).
The dialog's subtitles are a window of their own, `subtitles`
(`runtime/subtitles_window.rs`, behind a `SubtitlesHost`), created the first
time they are shown; the main window is minimized meanwhile. With
layer-shell it is a bottom-anchored overlay that never takes the keyboard and
lets clicks through but on its buttons (`set_subtitles_input_region`); else
a regular always-on-top window whose geometry is kept in
`dialog.compactGeometry` (device). The dialog runs in the main window, which
publishes a ready-to-render `SubtitlesView` (`publish_subtitles`; with
`recordingStartedAt` while a recording runs),
`app://subtitles-changed`); the strip loads only `subtitles.html` without the
stores and hands its buttons back (`app://subtitles-action-requested`).
A playback source delivers nothing while nothing plays, so the capture loop
fills the gap with silence (`voice/source.rs`), switches the source in place
(`switch_capture_source`) and waits for the same application when it quits.
Recording other applications requires an explicit source selection. The new
stream's overlapping setup audio is discarded at handover, so that it cannot
repeat the old stream's tail. An application is identified by its binary (Flatpak app
id on Linux, the full executable path of its process tree's root on Windows), never by
a process id. Lifecycle tests use fake streams and outputs to check setup
failure, timeout, final audio ordering, stale stops, source switches and gap
filling; `integration_records_the_system_sound_and_one_application` runs
against a real PipeWire server.
Listening capabilities are probed off the UI thread, initially and every five
seconds, under the background-service shutdown barrier. Linux probes a completed
PipeWire round trip with a one-second deadline rather than caching login-time
availability. Capture stream errors are reported, including asynchronous
PipeWire stream failures. Windows probes process-loopback activation and stream
initialization instead of guessing from an OS build number; system capture uses default-device WASAPI loopback, following endpoint
changes, matching Linux default-sink capture. It includes Tyco playback. Application capture mixes all matching independent process trees.
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

Windows application identity uses full executable paths; inaccessible processes
are omitted instead of grouped under ambiguous basenames. Helpers in the same
installation directory belong to their parent application (except System32).
Helpers installed in separate directories remain separate sources. System sound
means the default output device on both platforms, including Tyco playback;
applications routed to other outputs require application capture.
