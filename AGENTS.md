# Repository Guidelines

## Communication

- Communicate with the user in Russian, including plans and explanations.
- Write all code-related content in English: code, identifiers, comments, commit messages, logs, and non-i18n strings. Do not use Russian or any other language in code-related content; i18n locales are the only exception.
- Keep changes focused. Do not refactor unrelated code unless it is necessary for the task.

## Monorepo Layout and Stack

- `apps/desktop-ui/` — Vue 3 + Vite + Tailwind CSS + CodeMirror 6 frontend (`@tyco/desktop-ui`).
- `packages/shared/` — shared TypeScript contracts and data structures (`@tyco/shared`).
- `src-tauri/` — Rust backend (Tauri 2, local storage, D-Bus IPC, Whisper/LLM models management).
- `scripts/` — development, automation, and verification scripts (`check-i18n.js`, `tauri-dev.mjs`).

The root workspace uses Node.js 24+, pnpm 11, TypeScript, Turborepo, ESLint (flat config), and Prettier.
Always use `pnpm`; do not introduce npm or Yarn lockfiles.

## Working Approach & Architecture Principles

- **Thin Pinia Stores + DI Models**:
  - Keep Pinia stores minimal and focused on reactivity and dependency wiring.
  - Extract pure business and state logic into decoupled models inside `apps/desktop-ui/src/lib/` (e.g. `history/`, `ipc/`, `action-menu/`, `editor-input/`, `modals/`).
  - Accompany every DI model with focused unit tests.
  - Place state by its lifetime and audience: a Pinia store for state shared across components or that outlives a page; `provide`/`inject` for state of one component subtree (e.g. `use-markup-mode`); a composable for per-component wiring and lifecycle reactions (e.g. `use-quick-window-session`).
  - Desktop state (settings, session, activation, window) is read from `useDesktopStore`; `useIpcStore` only calls desktop commands, by their Rust names (`call('copy_text', { text })`). Change the settings with `updateUserConfig(patch)` rather than spreading the whole config.
  - Composables called from a store setup must not use lifecycle hooks or `inject`.
  - A lower-level store does not import a feature store; the feature hands itself in instead (e.g. the chat provides `core.askInChat` to the tool registry).
- **Naming Conventions**:
  - Use kebab-case for filenames across all TypeScript and utility modules (e.g., `context-menu.ts`, `editor-sync.ts`).
  - Rust module filenames use snake_case to match their module identifiers; Cargo example and integration test target filenames may use kebab-case.
  - Vue components use PascalCase (`EditorInput.vue`, `SettingsTranslationsTab.vue`).
  - Types and enums use PascalCase; constant collections use SCREAMING_SNAKE_CASE.
  - Distinguish identifiers, display labels, state, and call parameters in names (`providerId`, `providerLabel`, `desktopState`).
  - Use `can*` for capabilities and `is*` / `has*` for state predicates; include units or counts where ambiguous (`contextWindowTokens`, `pendingSaveCount`).
  - Prefer domain-specific modules over generic `helpers` collections; keep SDK and legacy serialized names at explicit compatibility boundaries.
- **I18n & Locales**:
  - Core locale messages live in `apps/desktop-ui/src/lib/i18n/locales/*.json`; plugin messages live in their own `packages/plugin-*/src/locales/*.json`.
  - **No Fallbacks**: Translation fallbacks are prohibited (`fallbackLocale: false`). Every supported locale (`ru_RU`, `en_US`, `es_AR`, `tr_TR`) must provide 100% of all keys. A missing key is an error, never a silent fallback to English.
  - **Completeness & Hygiene**: Every key referenced in application code (templates, scripts, `*Key` properties) must exist across all supported locales. Conversely, dead/unused localization keys must not remain in locale dictionaries.
  - All keys, placeholders (`{param}`), types, and structure across locales within each package must stay synchronized. Run `pnpm check:i18n` to validate.
- **IPC & System Contracts**:
  - Linux D-Bus contract uses `org.tyco.Service`, `/org/tyco/Object`, and `org.tyco.Interface`.
- **Rust Layer**:
  - Strict zero-warning policy on `cargo clippy -- -D warnings`.
  - Code must be formatted via `cargo fmt --check`.
  - Accompany core commands with unit tests in `src-tauri`.
  - Keep OS- and session-specific code in `src-tauri/src/services/platform/`; ask
    `platform::session::current()` instead of reading `XDG_SESSION_TYPE` and the
    like. Supported platforms and test setups: `dev_docs/cross-platform.md`.

## Verification Commands

- `pnpm check` — version sync, i18n validator, ESLint, TypeScript type-check, Prettier check.
- `pnpm test` — runs all Vitest test suites.
- `pnpm validate` — `pnpm check && pnpm test && pnpm build`.
- `pnpm check:rust` / `pnpm test:rust` — `cargo fmt --check` + `cargo clippy --all-targets -D warnings`, and `cargo test`.
- `pnpm validate:all` — everything above in one go.

## Offline Constraint

The app must work without network access. Do not add fonts, icons, stylesheets
or scripts loaded from a CDN. Plugin icons are bundled in their packages by `@tyco/plugin-build`. Core icons come from `@iconify-json/mdi` and are
subsetted at build time by `apps/desktop-ui/build/offline-icons-plugin.ts`,
which scans the sources for `mdi:*` names; referencing a new icon is enough.

## CSP

`src-tauri/tauri.conf.json` holds the production CSP. `scripts/tauri-dev.mjs`
overrides only `devUrl` and the CSP entries needed to reach the dev server —
keep it that way, so that anything working in dev also works in a bundle. In
particular, never rely on inline scripts: `script-src` does not allow them.

The webview does not reach the network itself: `connect-src` allows only IPC.
HTTP and WebSocket requests go through the Rust proxy
(`src-tauri/src/services/net`) via `apps/desktop-ui/src/lib/net`. Provider API
keys live in the Rust secret store (`services/secrets.rs`), bound to their
provider's origin; the webview only ever handles `tyco-secret:<id>` references.

## Versioning

The root `package.json` is the single source of truth. `pnpm sync:version`
propagates it to `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, and
`pnpm check` fails when they drift apart.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
