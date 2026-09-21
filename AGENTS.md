# Repository Guidelines

## Communication

- Communicate with the user in Russian, including plans and explanations.
- Write all code-related content in English: code, identifiers, comments, commit messages, logs, and non-i18n strings. Do not use Russian or any other language in code-related content; i18n locales are the only exception.
- Keep changes focused. Do not refactor unrelated code unless it is necessary for the task.

## Monorepo Layout and Stack

- `apps/desktop-ui/` — Vue 3 + Vite + Tailwind CSS + CodeMirror 6 frontend (`@tyco/desktop-ui`).
- `packages/shared/` — shared TypeScript contracts and data structures (`@tyco/shared`).
- `src-tauri/` — Rust backend (Tauri 2, local storage, D-Bus IPC, Whisper/LLM models management).
- `scripts/` — development, automation, and verification scripts (`check-i18n.js`, `tauri-dev.sh`).

The root workspace uses Node.js 24+, pnpm 11, TypeScript, Turborepo, ESLint (flat config), and Prettier.
Always use `pnpm`; do not introduce npm or Yarn lockfiles.

## Working Approach & Architecture Principles

- **Thin Pinia Stores + DI Models**:
  - Keep Pinia stores minimal and focused on reactivity and dependency wiring.
  - Extract pure business and state logic into decoupled models inside `apps/desktop-ui/src/lib/` (e.g. `history/`, `ipc/`, `action-menu/`, `editor-input/`, `modals/`).
  - Accompany every DI model with focused unit tests.
- **Naming Conventions**:
  - Use kebab-case for filenames across all TypeScript and utility modules (e.g., `context-menu.ts`, `editor-sync.ts`).
  - Vue components use PascalCase (`EditorInput.vue`, `SettingsTranslationsTab.vue`).
- **I18n & Locales**:
  - Locale messages are isolated in `apps/desktop-ui/src/lib/i18n/locales/*.json`.
  - All keys across all locales must stay synchronized. Run `pnpm check:i18n` to validate.
- **IPC & System Contracts**:
  - Linux D-Bus contract uses `org.tyco.Service`, `/org/tyco/Object`, and `org.tyco.Interface`.
- **Rust Layer**:
  - Strict zero-warning policy on `cargo clippy -- -D warnings`.
  - Code must be formatted via `cargo fmt --check`.
  - Accompany core commands with unit tests in `src-tauri`.

## Verification Commands

- `pnpm check` — version sync, i18n validator, ESLint, TypeScript type-check, Prettier check.
- `pnpm test` — runs all Vitest test suites.
- `pnpm validate` — `pnpm check && pnpm test && pnpm build`.
- `pnpm check:rust` / `pnpm test:rust` — `cargo fmt --check` + `cargo clippy --all-targets -D warnings`, and `cargo test`.
- `pnpm validate:all` — everything above in one go.

## Offline Constraint

The app must work without network access. Do not add fonts, icons, stylesheets
or scripts loaded from a CDN. Icons come from `@iconify-json/mdi` and are
subsetted at build time by `apps/desktop-ui/build/offline-icons-plugin.ts`,
which scans the sources for `mdi:*` names; referencing a new icon is enough.

## CSP

`src-tauri/tauri.conf.json` holds the production CSP. `scripts/tauri-dev.sh`
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
