# Unit tests

## Commands

Use Node.js and pnpm versions declared by the repository and the Rust toolchain
pinned in `rust-toolchain.toml`.

| Command                      | Scope                                                                       |
| ---------------------------- | --------------------------------------------------------------------------- |
| `pnpm test:unit`             | Tooling, frontend, plugins, and Rust unit tests                             |
| `pnpm test:unit:ui`          | All desktop UI unit and component tests                                     |
| `pnpm test:unit:models`      | The DOM-independent desktop UI project                                      |
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

- `unit-node` runs explicitly selected DOM-independent models and build tooling.
- `unit-dom` runs components and modules requiring browser APIs in jsdom.

Add a file to the Node patterns only after confirming that neither it nor its
imports require DOM APIs. Vue reactivity alone does not require jsdom. Both
projects use the same application transforms and aliases. File isolation remains
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
them. Pure tests of protocol encoding, validation, queues, and process control
state remain in the unit suite. Local transport tests use ephemeral ports.

The real system keychain test remains ignored and is only run explicitly with
`cargo test --manifest-path src-tauri/Cargo.toml keychain -- --ignored`. It requires
a working, unlocked session keychain; unit tests use the in-memory vault instead.

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

CI runs the full Rust suite and uploads a separate Rust unit LCOV report. Rust coverage is initially informational: platform adapters cannot be
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
pnpm --filter @tyco/desktop-ui test:browser ui-catalog.spec.ts --project=chromium --update-snapshots
```

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
- `settings.spec.ts` covers autosave, failed saves, explicit retry and reload.
- `chat.spec.ts` covers partial streaming, completion, cancellation, retry after
  a provider error and restoration of a saved chat.
- `editor-actions.spec.ts` covers correction review/application and enabling,
  executing and disabling a built-in plugin action.
- `voice.spec.ts` covers live and final transcription, cancellation and a broken
  speech connection, including microphone cleanup.
- `quick-window.spec.ts` uses the quick window identity and activation mode to
  cover draft recall, restoration after focus loss and command execution.

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
7. Saving a note and checking the file on disk.
8. Production CSP blocking direct HTTP without reaching the fixture server.
9. Rust HTTP proxy reaching that same offline fixture.
10. CLI status against the running application.
11. CLI activation delivering text to the editor.
12. D-Bus activation delivering text to the editor (Linux only).
13. Plugin installation, activation and worker sandbox restrictions.
14. Lazy settings navigation and plugin removal.

Linux needs `tauri-driver`, `WebKitWebDriver`, Xvfb, Openbox and a session D-Bus:

```sh
cargo install tauri-driver --version 2.0.5 --locked
cargo build --manifest-path src-tauri/Cargo.toml --locked -p tyco-ctl
pnpm tauri:build --debug --no-bundle
xvfb-run -a dbus-run-session -- sh -c 'openbox >/tmp/tyco-openbox.log 2>&1 & pnpm test:desktop'
```

Windows runs `pnpm test:desktop` directly after the same builds, with
`tauri-driver.exe` and a matching `msedgedriver.exe` on `PATH`. CI downloads the
Edge driver matching the installed Edge version. `TYCO_TEST_APP` and
`TYCO_TEST_DRIVER` can override the application and driver paths.
The standard Tauri driver does not support WKWebView on macOS; keep unit tests
and manual native verification there. Failure screenshots and driver/application
logs are uploaded separately for each smoke platform.

Keep timing combinations, queues, normalization and business-rule matrices in
unit tests. Browser scenarios should demonstrate a complete user action and its
observable result. Browser focus, scrolling, geometry and native dialog behavior
cannot be established by jsdom tests even when their assertions look similar.

## Strict fixtures and fake desktop runtime

Import `test` and `expect` from `support/fixtures.ts` for the application, or
`browserTest as test` for the catalog. Both reject uncaught page errors, console
errors, Vue/vue-i18n warnings and external HTTP requests. Missing translations
emit explicit errors in the browser build, including when Vue is built for
production. An expected console error must be registered with
`expectConsoleError(pattern, count)`; it cannot suppress page exceptions or
unrelated errors.

The application fixture installs `window.__TAURI_INTERNALS__` before page scripts
run. Each test owns a fresh `FakeDesktop` and browser context. Commands preserve
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
