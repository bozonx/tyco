# Testing

## Commands

Use Node.js and pnpm versions declared by the repository and the Rust toolchain
pinned in `rust-toolchain.toml`.

| Command                      | Scope                                                                       |
| ---------------------------- | --------------------------------------------------------------------------- |
| `pnpm test:unit`             | Tooling, frontend, plugins, and Rust unit tests                             |
| `pnpm test:unit:ui`          | All desktop UI unit and component tests                                     |
| `pnpm test:unit:models`      | The Node (DOM-independent) desktop UI project                               |
| `pnpm test:unit:rust`        | Workspace library/binary tests, excluding `integration_` tests              |
| `pnpm test:integration:rust` | Local socket/process tests and all integration test targets                 |
| `pnpm test`                  | Tooling, frontend, and plugin tests                                         |
| `pnpm test:rust`             | All Rust test targets and doc tests                                         |
| `pnpm test:cov`              | Frontend and plugin coverage with package coverage floors                   |
| `pnpm test:cov:rust`         | Rust unit coverage in `coverage/rust/lcov.info`                             |
| `pnpm test:browser`          | Chromium and WebKit browser integration tests and Chromium visual baselines |
| `pnpm validate:all`          | Frontend checks, tests/build, Rust formatting, Clippy, and tests            |

Extra command-line arguments can be passed directly to the package runner, for
example `pnpm --filter @tyco/desktop-ui exec vitest run --project unit-dom
src/components/common/Button.test.ts`.

## Frontend environments and isolation

`apps/desktop-ui/vitest.config.ts` defines two projects with disjoint file sets:

- `unit-node` is the default: build tooling and every test under `src/` that
  is not listed below.
- `unit-dom` runs in jsdom: tests under `src/components`, `src/views`,
  `src/composables` and `src/stores`, and any `*.dom.test.ts`.

A model test therefore gets no DOM unless it asks for one. When a module needs
browser APIs (`document`, `window`, CodeMirror views, canvas, clipboard), name
its test `<module>.dom.test.ts`. Vue reactivity alone does not require jsdom.
Both projects use the same application transforms and aliases. File isolation remains
enabled; the desktop runner caps workers at four to bound memory use.

The DOM setup automatically unmounts Vue Test Utils wrappers, clears storage and
the body, and restores real timers. Unexpected Vue warnings fail tests. Install
Pinia in the mounted application's `global.plugins` when a component uses real
stores; setting active Pinia alone does not provide Vue's injection context.
Restore any shared mounting configuration in `afterEach`.

Both projects automatically restore spies, clear mock call history, and restore
`vi.stubGlobal`/`vi.stubEnv` changes. This does not dispose application resources:
models, scopes, subscriptions, and in-flight operations must still be disposed by
the test. Use `afterEach` or `try/finally` for cleanup that must survive assertion
failures. Avoid module-wide mutable fixtures unless every test resets their state.

Use fake timers to test deadlines. Use explicitly controlled promises to test
operation ordering; fixed sleeps are not evidence that an operation has reached a
particular state. Assert public behavior and meaningful boundary cases rather
than reproducing the implementation.

All plugin/SDK test files and Vitest configurations are type-checked through
`tsconfig.test.json`; test sources stay out of published build output. Desktop
tests are checked by `tsconfig.tooling.json`.

## Component tests and the desktop boundary

Component, view and composable tests mount the real Pinia stores. Replace the
native side, not the stores: `installFakeDesktop()` from
`src/test/install-fake-desktop.ts` puts the shared in-memory backend
(`src/test/fake-desktop-backend.ts`, the same one the browser tests use)
behind `@tauri-apps/api`, so the IPC store, desktop state model and client run
as in the app.

```ts
let desktop: TestDesktop
beforeEach(async () => {
  desktop = installFakeDesktop({ userConfig })
  await desktop.load() // only when the component reads the desktop state
})
afterEach(() => desktop.dispose()) // fails on commands without a handler

desktop.backend.handle('get_text_insertion_status', () => status)
mount(Component, { global: { plugins: [desktop.pinia] } })
expect(desktop.backend.callsOf('copy_text')).toEqual([{ text: 'Hi' }])
```

Do not mock `stores/desktop` or `stores/ipc`, and do not write a new store
stand-in like `mockDesktopStore`: a copy of store logic drifts from the store.
Mocking a heavy feature store (LLM, chat) or `use-i18n` to isolate a component
is still fine. Older tests that mock the desktop stores are being migrated.

## Rust isolation

Keep unit tests in `#[cfg(test)]` modules. Inject platform/session inputs into pure
logic and test each relevant session explicitly instead of deriving expectations
from the host environment.

Use `services::test_support::TestDir` for temporary filesystem fixtures. It creates
unique directories atomically and removes them on drop, including assertion
panics. For tests of directory creation, keep a guard for an existing parent and
use a missing child path. Keep handles and stores scoped so they close before the
directory guard drops, especially on Windows.

Tests that launch actual child processes or bind local sockets have an
`integration_` name prefix, even when colocated in a source module to access
private APIs. The default full suite still runs them; the fast unit command skips
them. `scripts/check-rust-test-tiers.mjs` (part of `pnpm check`) fails when a
test body binds or connects a socket or starts a process without the prefix;
it does not follow helpers, so keep such calls visible in the test or name the
test correctly yourself. Cargo integration targets under `tests/` need no
prefix. Pure tests of protocol encoding, validation, queues, and process control
state remain in the unit suite. Local transport tests use ephemeral ports.

The real system keychain test remains ignored and is only run explicitly with
`cargo test --manifest-path src-tauri/Cargo.toml keychain -- --ignored`. It requires
a working, unlocked session keychain; unit tests use the in-memory vault instead.

## Desktop commands

`#[tauri::command]` functions are adapters without logic and have no unit
tests of their own; the services they call do. Their wiring is checked
statically and end to end:

- `scripts/check-desktop-contracts.mjs` requires every registered command to
  be in the `AppManifest` of `build.rs` and in the generated bindings, and
  checks the capability files.
- `node scripts/generate-desktop-commands.mjs --check` (in `pnpm check`) keeps argument names and types in sync with
  the frontend.
- The native smoke runs real commands under the production permissions.

A command that grows logic moves it into a service with unit tests.

## Coverage

CI runs frontend tests with V8 coverage and uploads HTML, LCOV, and JSON summaries
for the desktop UI and every tested plugin package. Plugin package floors are
80% lines/statements/functions and 75% branches, below their measured starting
coverage. Desktop history, LLM, and command models require 85% lines/statements, 90%
functions, and 80% branches; the entire UI is
reported without a blanket 100% requirement. Raise floors intentionally as useful
behavioral tests are added, rather than excluding uncovered production code.

Rust coverage uses `cargo-llvm-cov` 0.9.1 and the pinned Rust toolchain's LLVM tools.
To run it locally, install the tools once:

```sh
cargo install cargo-llvm-cov --version 0.9.1 --locked
rustup component add llvm-tools-preview
pnpm test:cov:rust
```

With a distribution-managed Rust toolchain, matching LLVM binaries can instead be
provided through `LLVM_COV` and `LLVM_PROFDATA`.

CI runs the full Rust suite with all features on Linux and uploads a separate Rust unit LCOV report. Rust coverage is initially informational: platform adapters cannot be
fully exercised by a Linux unit runner. Reports exclude tagged integration tests,
while all platforms continue to run the full Rust test suite across CI jobs.

# Browser tests

`pnpm test:browser` builds the plugins and runs Playwright against a dedicated
production build in `apps/desktop-ui/dist-browser`. The Vite preview server serves
the application and the UI catalog; the catalog is included only in this test
build, never in the shipped application. Local `TYCO_LOCAL_AI_KIT` overrides are
ignored. There is no HMR or on-demand dependency optimization during a test.

Install the browsers once after installing dependencies:

```sh
pnpm --filter @tyco/desktop-ui exec playwright install --with-deps chromium webkit
pnpm test:browser
```

The WebKit build of Playwright needs the libraries of Ubuntu 24.04 (ICU 74,
`libxml2.so.2`); on another distribution, e.g. Arch or Manjaro, it does not
start. There, and for visual baselines anywhere, run the suite in the CI image
(Docker required); arguments go to `playwright test`:

```sh
pnpm test:browser:container
```

To run a functional subset, pass the file before the project option:

```sh
pnpm --filter @tyco/desktop-ui test:browser chat.spec.ts --project=chromium
```

`TYCO_BROWSER_PATH=/usr/bin/chromium` can select a local Chromium for debugging;
it never overrides WebKit. Use the bundled browser for visual comparisons.
CI uses the pinned Playwright Noble container. Keep its version in
`.github/workflows/ci.yml` synchronized with `@playwright/test` and the lockfile.
Generate and review visual updates in that same container environment:

```sh
pnpm test:browser:container ui-catalog.spec.ts --project=chromium --update-snapshots
```

A test stops at its first failed screenshot: after an update, run the suite
again, since a later baseline of the same test may be stale too.

The browser job runs on every PR, blocks the bundle and desktop smoke jobs, and
uploads the HTML report and failure traces/screenshots. `pnpm validate:all` also
includes the browser suite. There are no automatic retries that could conceal a
failure. For a stability check, use `--repeat-each=3`.

## Scope and test boundaries

- `ui-catalog.spec.ts` checks real browser focus, modal layering, keyboard input,
  responsive layout and accessible relationships. Chromium compares standard
  controls and navigation/menu screenshots in three themes at two widths. Other
  section and full-page screenshots are diagnostic artifacts, not assertions.
- `app-shell.spec.ts`, `editor-history.spec.ts`, and `locales.spec.ts` cover startup,
  navigation, clipboard/history, undo, desktop events and the supported locales.
- `settings.spec.ts` covers autosave, failed saves, explicit retry and reload, and creating a connection/model through the UI before sending a chat request.
- `chat.spec.ts` covers partial streaming, completion, cancellation, retry after
  a provider error restoration of a saved chat, pasted text attachments, and allow/deny approval of a profile file tool followed by the next model response.
- `editor-actions.spec.ts` covers correction review/application and enabling,
  executing and disabling a built-in plugin action, and selecting a translation language and applying the translated result.
- `voice.spec.ts` covers live and final transcription, cancellation and a broken
  speech connection, including microphone cleanup.
- `quick-window.spec.ts` uses the quick window identity and activation mode to
  cover draft recall, restoration after focus loss, correction followed by native insertion IPC, and command execution. A command configuration scenario creates a script command and assigns its launcher slot through settings before opening a separate quick webview fixture.

Both Chromium and WebKit run functional scenarios. The real clipboard test is
tagged `@chromium` because WebKit cannot grant `clipboard-write`. Visual comparisons run only in
Chromium/Linux. These are UI integration tests: native storage, system focus,
actual microphones, OS insertion and provider connectivity are replaced at the
IPC boundary. They do not prove native OS integration or production CSP behavior.
`pnpm test:desktop` uses `tauri-driver` against the actual embedded application;
additional platform checks are described in `cross-platform.md`.

### Native binary smoke

The `desktop-smoke` CI job runs on every PR to `main` on Linux and Windows.
It builds embedded assets with `pnpm tauri:build --debug --no-bundle` and builds
`tyco-ctl` separately. This uses the production CSP and real Rust commands,
with an isolated temporary `TYCO_DEV_HOME`; no development server or mocked IPC
is involved. Debug builds are required for the isolated home override.

Keep this suite small. Its scenarios cover:

1. Native startup and the main CodeMirror editor.
2. Embedded asset origin (reject a development server).
3. Main-window IPC permissions.
4. Saving settings and merging stale snapshots.
5. Saving editor history and updating its result.
6. Removing editor history.
7. Production CSP blocking direct HTTP without reaching the fixture server.
8. Rust HTTP proxy reaching that same offline fixture.
9. CLI status against the running application.
10. CLI activation delivering text to the editor.
11. D-Bus activation delivering text to the editor (Linux only).
12. Loading a preinstalled plugin package, activation and worker sandbox restrictions (the native installation dialog is not automated).
13. Lazy settings navigation and plugin removal.
14. Changing the theme through the UI, restarting the native application with the same isolated home, and restoring the theme and editor history.
15. On Linux/X11, activating quick input over a separate GTK editor and inserting text through the real UI into that editor.

Linux needs `tauri-driver`, `WebKitWebDriver`, Xvfb, Openbox, xdotool, xclip, Python with PyGObject/GTK 3 and a session D-Bus:

```sh
cargo install tauri-driver --version 2.0.5 --locked
cargo build --manifest-path src-tauri/Cargo.toml --locked -p tyco-ctl
pnpm tauri:build --debug --no-bundle
xvfb-run -a dbus-run-session -- sh -c 'openbox >/tmp/tyco-openbox.log 2>&1 & pnpm test:desktop'
```

Where these are not packaged alike, e.g. on Arch or Manjaro, build and run the
smoke in an Ubuntu 24.04 image with the packages of the CI job (Docker
required); the app is built into `src-tauri/target/container`:

```sh
pnpm test:desktop:container
```

Windows runs `pnpm test:desktop` directly after the same builds, with
`tauri-driver.exe` and a matching `msedgedriver.exe` on `PATH`. CI downloads the
Edge driver matching the installed Edge version. `TYCO_TEST_APP` and
`TYCO_TEST_DRIVER` can override the application and driver paths.
macOS is not a supported platform for now; CI only keeps its backend
compiling. Failure screenshots and driver/application
logs are uploaded separately for each smoke platform.

Keep timing combinations, queues, normalization and business-rule matrices in
unit tests. Browser scenarios should demonstrate a complete user action and its
observable result. Browser focus, scrolling, geometry and native dialog behavior
cannot be established by jsdom tests even when their assertions look similar.

## Strict fixtures and fake desktop runtime

Import `test` and `expect` from `support/fixtures.ts` for the application, or
`browserTest as test` for the catalog. Both monitor every page in the test context and reject uncaught page errors, console
errors, Vue/vue-i18n warnings and external HTTP requests. Missing translations
emit explicit errors in the browser build, including when Vue is built for
production. An expected console error must be registered with
`expectConsoleError(pattern, count)`; it cannot suppress page exceptions or
unrelated errors.

The application fixture installs `window.__TAURI_INTERNALS__` before page scripts
run. Each test owns a fresh `FakeDesktop` (a page adapter over the backend in
`src/test/fake-desktop-backend.ts`, shared with jsdom tests) and browser
context. Commands preserve
the real argument serialization and Tauri Channel envelope, including binary
stream data. Unknown commands return errors and independently fail teardown even
if application code catches the error. Unexpected `log_client_message` errors
also fail; register intentional failures with `expectDesktopError(pattern, count)`.

- Seed `desktop.userConfig`, `desktop.sessionState`, `desktop.history` or
  `desktop.chats` before `page.goto('/')`.
- Use `test.use({ startMode, windowLabel })` for non-editor/quick scenarios.
- Replace a command with `desktop.handle(command, handler)`; throw
  `FakeDesktopError` for a structured native failure.
- Assert boundary effects with `desktop.callsOf(command)` and `expect.poll`.
- Emit application events with `desktop.emit(DESKTOP_EVENTS..., payload)`;
  `desktop.setWindowFocus` controls native focus responses and events together.
- `support/llm.ts` controls provider response heads, SSE chunks and completion.
  `support/voice.ts` controls the microphone channel and speech socket separately.
  They preserve the production request, transport and provider parsing code.

The default config save handler supports single-writer saves only and rejects a
stale `baseConfig`. It does not implement Rust normalization, validation, secret
protection or concurrent merges. Test those in Rust and the native desktop smoke;
use an explicit handler when a UI scenario needs a particular backend response.
Draft recall in the quick window is in-memory across activations, not durable
across a webview reload. Persistence tests reload settings and saved chats instead.

## Choosing integration tests without virtual machines

Use Rust integration tests for real local sockets, HTTP/WebSocket fixtures,
child processes, cancellation and filesystem storage. They run on the host or
in a container: `pnpm test:integration:rust`. The CLI integration target uses a
real child CLI and a protocol server fixture; it does not replace the native
application smoke.

Use browser tests for complete UI actions with deterministic IPC responses.
Keep rule matrices, serialization edge cases and static component attributes in
unit/component tests. The catalog retains real browser focus, keyboard, dialog,
accessible-name examples, scrolling and geometry checks; it does not repeat the
full component attribute matrix.

Use native smoke for the embedded origin, production CSP, actual IPC authority,
storage across process restart and Linux/X11 insertion into a foreign process.
Use `pnpm test:platform:linux` for the separate X11/KWin/Sway adapter matrix.
Those headless compositors are not virtual machines. The KWin and Sway adapter
runs do not establish full-application Wayland insertion.

Reserve full OS sessions (a dedicated host or VM) for desktop portals, real
permission prompts, global shortcuts, tray behavior and installer verification.
Windows/macOS adapters require their own OS; a VM is one way to provide it, not
a requirement of integration testing. Real audio capture, full Wayland desktop
behavior and hardware/GPU compatibility remain outside the deterministic smoke.

## Full desktop sessions in virtual machines

The [VM testing plan](vm-testing.md) defines the Windows/Linux OS matrix, reuse of
local Left Hand Control base images, native acceptance scenarios and the planned
runner. Fedora KDE automation and initial Ubuntu GNOME checks are implemented in
`scripts/vm/`; other profiles and acceptance gaps remain explicit. See its
[README](../scripts/vm/README.md) for executable commands.

## Native desktop sessions and virtual machines

Use [vm-testing.md](vm-testing.md) for the current platform matrix and acceptance
criteria, [the runner README](../scripts/vm/README.md) for commands, and
[coverage.md](../scripts/vm/coverage.md) for implemented assertions. Dated reports
record executions of specific binaries; an implemented case is not automatically
a passed case, and a targeted run does not certify the full platform.

Keep deterministic state, configuration/history CRUD, command authorization,
quoting, plugin sandbox and text-transformation combinations in unit, browser,
desktop-smoke or platform-container tests. In each VM retain a short integration
smoke for those boundaries. Native VM coverage concentrates on compositor focus,
physical shortcuts, native permission dialogs, clipboard recipients, tray,
keychain, devices, display topology and session transitions.

VM smoke uses three insertion cycles; the full native suite defaults to five.
Use `--stress` for at least twenty physical activation/insertion cycles. Lifecycle
checks retain three actual transitions independently of this repetition setting.
Full functional acceptance and production package acceptance are separate scopes.
A real upgrade requires a genuinely older release artifact.

A defect independently reproduced without Tyco in the OS, desktop, dependency or
VM platform is an external limitation, not a Tyco acceptance blocker. Preserve the
failed evidence, verify Tyco's error/degradation behavior, and document the exact
scope. Do not change a failed execution into PASS or count an unsupported path as
a supported feature. Physical GPU, Bluetooth, microphones, monitor connections
and hardware sleep require separate hardware evidence.
