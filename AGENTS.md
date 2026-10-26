# Repository Guidelines

TyCo is an offline-first desktop AI typing companion: a Tauri 2 shell with a
Rust backend and a Vue 3 frontend, organized as a pnpm + Turborepo monorepo.

## Communication

- Talk to the user in Russian, including plans and explanations.
- Everything code-related is in English: code, identifiers, comments, logs,
  commit messages, non-i18n strings. Locale files are the only exception.
- Keep changes focused; do not refactor unrelated code unless the task needs it.

## Layout

- `apps/desktop-ui/` — Vue 3 + Vite + Tailwind CSS + CodeMirror 6 frontend
  (`@tyco/desktop-ui`). `src/lib/` models, `src/stores/` Pinia stores,
  `src/composables/`, `src/components/` grouped by feature, `build/` Vite plugins.
- `packages/shared/` — wire contracts, config types, generated desktop bindings
  (`@tyco/shared`).
- `packages/plugin-sdk/` — framework-independent plugin contract;
  `packages/plugin-build/` — plugin bundler; `packages/plugin-*/` — bundled plugins.
- `src-tauri/` — Rust backend: `commands/` (IPC adapters), `models/` (wire
  types), `services/` (domain logic), `crates/`, `tyco-ctl/` (external CLI).
- `scripts/` — dev launcher, code generation, checks, container and VM tests.
- `dev_docs/` — design notes; read the relevant one before changing an area:
  `architecture.md`, `state-management.md`, `desktop-api.md`,
  `config-storage.md`, `plugin-packages.md`, `cross-platform.md`, `testing.md`,
  `ui-system.md`, `ui-components.md`. `docs/external-control.md` — CLI/D-Bus API.

Toolchain: Node.js 24 (`.node-version`), pnpm 11, Rust pinned by
`rust-toolchain.toml`. Always use `pnpm`; never add npm or Yarn lockfiles.
Run the desktop app with `pnpm tauri:dev`, not `pnpm tauri dev`.

## Frontend Architecture

- **Thin stores, injected models.** Business and state logic lives in
  `apps/desktop-ui/src/lib/<feature>/` models with injected dependencies, each
  with focused unit tests. Pinia stores only wire dependencies and expose
  reactive state. Models must not import stores, components, views,
  composables or `@tauri-apps/*` (ESLint enforces it); native APIs go through
  `lib/desktop/` and `lib/net/tauri-net.ts`.
- **Place state by lifetime and audience:** a Pinia store for state shared
  across components or outliving a page; `provide`/`inject` for one component
  subtree (e.g. `use-markup-mode`); a composable for per-component wiring and
  lifecycle (e.g. `use-quick-window-session`). See `dev_docs/state-management.md`.
- Read desktop state (settings, session, activation, window) from
  `useDesktopStore`. `useIpcStore` only calls desktop commands by their Rust
  names (`call('copy_text', { text })`). Change settings with
  `updateUserConfig(patch)`, never by spreading the whole config.
- Composables called from a store setup must not use lifecycle hooks or `inject`.
- A lower-level store never imports a feature store; the feature hands itself
  in (e.g. the chat provides `core.askInChat` to the tool registry).

## Naming

- Filenames: kebab-case for TS/JS modules, stores and composables
  (`editor-sync.ts`); PascalCase for Vue components and their adjacent tests
  (`EditorInput.vue`); snake_case for Rust modules (Cargo example and
  integration-test targets may use kebab-case).
- Types and enums are PascalCase; constant collections are SCREAMING_SNAKE_CASE.
- Separate identifiers, labels, state and parameters in names (`providerId`,
  `providerLabel`, `desktopState`).
- `can*` for capabilities, `is*` / `has*` for state predicates; include units
  or counts when ambiguous (`contextWindowTokens`, `pendingSaveCount`).
- Prefer domain modules over generic `helpers`; keep SDK and legacy serialized
  names at explicit compatibility boundaries.

## I18n

- Core messages: `apps/desktop-ui/src/lib/i18n/locales/*.json`; plugin
  messages: `packages/plugin-*/src/locales/*.json`.
- The supported locales are listed in `packages/plugin-sdk/src/locales.json`.
  Every locale must contain every key: there are no fallbacks
  (`fallbackLocale: false`), and a missing key is an error.
- When adding or renaming a key, update all locale files with real
  translations, keeping keys, `{param}` placeholders and structure in sync.
  Remove keys that are no longer used.
- `pnpm check:i18n` validates all of this.

## Rust Backend

- Zero warnings under Clippy with `-D warnings`; code formatted by `cargo fmt`.
- `#[tauri::command]` bodies hold no logic. Keep service logic testable
  without a Tauri runtime: pass state, paths or a host trait (e.g.
  `SelectionBackend`, `ActivationHost`) instead of an `AppHandle`. Commands
  and thin facades such as `history_store` resolve managed state and hand it in.
- Cover core commands and services with unit tests.
- After changing a command, an IPC type or an event, run
  `pnpm generate:desktop` (see `dev_docs/desktop-api.md`).
- OS- and session-specific code lives in `src-tauri/src/services/platform/`.
  Ask `platform::session::current()` instead of reading `XDG_SESSION_TYPE` and
  the like. Linux, Windows and macOS are all targets (`dev_docs/cross-platform.md`).
- The Linux D-Bus contract is `org.tyco.Service`, `/org/tyco/Object`,
  `org.tyco.Interface`.

## Security and Offline Constraints

- **Offline.** The app must work without network access. Never load fonts,
  icons, styles or scripts from a CDN. Core icons come from
  `@iconify-json/mdi` and are subsetted at build time by
  `apps/desktop-ui/build/offline-icons-plugin.ts`; referencing a new `mdi:*`
  name is enough. Plugin icons are bundled by `@tyco/plugin-build`.
- **CSP.** The production CSP is in `src-tauri/tauri.conf.json`.
  `scripts/tauri-dev.mjs` overrides only `devUrl` and the entries needed to
  reach the dev server — keep it that way so dev behaves like a bundle. Never
  rely on inline scripts: `script-src` forbids them.
- **Network.** The webview never reaches the network itself (`connect-src`
  allows only IPC). HTTP and WebSocket go through the Rust proxy
  (`src-tauri/src/services/net`) via `apps/desktop-ui/src/lib/net`.
- **Secrets.** Provider API keys live in the Rust secret store
  (`src-tauri/src/services/secrets`), bound to their provider's origin. The
  webview handles only `tyco-secret:<id>` references, never raw keys.

## Versioning

The root `package.json` version is the single source of truth.
`pnpm sync:version` propagates it to `src-tauri/tauri.conf.json` and
`src-tauri/Cargo.toml`; `pnpm check` fails when they drift apart.

## Verification

Run the checks that cover your change before finishing:

- `pnpm check` — version sync, i18n, plugin packages, generated contracts,
  ESLint, type-check, Prettier.
- `pnpm test` — tooling, frontend and plugin tests. A single file:
  `pnpm --filter @tyco/desktop-ui exec vitest run <path>`.
- `pnpm check:rust` — `cargo fmt --check` and Clippy.
- `pnpm test:rust` — all Rust tests; `pnpm test:unit:rust` for unit tests only.
- `pnpm validate` — `check`, `test` and `build`; `pnpm validate:all` also runs
  browser tests and the Rust checks.

Formatting fixes: `pnpm format`, `pnpm lint:fix`, `pnpm rust:fmt`.

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
