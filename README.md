# TyCo - typing companion

TyCo - typing AI companion for writers and professionals who work with texts a lot.

## Structure

- `apps/desktop-ui` — Vue 3 + Vite frontend (`@tyco/desktop-ui`)
- `packages/shared` — shared config, domain types, desktop contracts (`@tyco/shared`)
- `src-tauri` — Rust backend and Tauri shell
- `scripts` — development and verification scripts

## Requirements

- Node.js 24+ and pnpm 11 (`corepack enable`)
- Rust toolchain pinned by `rust-toolchain.toml`
- Linux system packages for Tauri, including `gtk-layer-shell`: see the
  `bundle` job in `.github/workflows/ci.yml`
- `xdotool` (X11) or `ydotool` (Wayland) for typing into other windows.
  On Wayland only KDE Plasma 6 is supported: a KWin script finds and focuses
  the target window, and `wl-clipboard` handles the clipboard. `ydotoold`
  must be running; it writes to `/dev/uinput`, so it can send any input to
  any window, and access to it should be granted with that in mind

The development launcher supports Linux, macOS, and Windows. Desktop runtime
smoke tests currently run on Linux; Rust checks run on all three platforms.

## Setup

```bash
pnpm install
cp .env.example .env
```

## Running

| Command            | What it does                                      |
| ------------------ | ------------------------------------------------- |
| `pnpm tauri:dev`   | Full desktop app (use this, not `pnpm tauri dev`) |
| `pnpm dev`         | Frontend only, in a browser                       |
| `pnpm tauri:build` | Platform bundle: AppImage/deb, NSIS, or app/DMG   |

`pnpm tauri:dev` goes through `scripts/tauri-dev.mjs`, which overrides only the
dev server URL and the CSP entries that allow talking to it. Running
`pnpm tauri dev` directly points the app at the production `devUrl` instead.

The repository root is the only environment directory. `TYCO_DEV_HOME` can
override the default development storage directory. UI tests bypass Turbo
caching because `TYCO_LOCAL_AI_KIT` can point to changing external sources.

Tauri automatically merges the Windows/macOS configuration for the target OS.
The macOS bundle requires macOS 11 or newer and declares microphone access.
Release signing and notarization still require platform credentials.

## Verification

| Command             | What it covers                                   |
| ------------------- | ------------------------------------------------ |
| `pnpm check`        | version sync, i18n, lint, type-check, formatting |
| `pnpm test`         | Tooling tests + Vitest suites                    |
| `pnpm validate`     | `check` + `test` + `build`                       |
| `pnpm check:rust`   | `cargo fmt --check` + `cargo clippy -D warnings` |
| `pnpm test:rust`    | `cargo test`                                     |
| `pnpm validate:all` | everything above                                 |

## Conventions

- The app must work offline: no fonts, icons or stylesheets loaded from a CDN.
  Icons are bundled at build time from `@iconify-json/mdi` by
  `apps/desktop-ui/build/offline-icons-plugin.ts`, which scans the sources for
  `mdi:*` names — just use a new icon and it gets included.
- The version lives in the root `package.json`; `pnpm sync:version` propagates it
  to `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, and `pnpm check`
  fails when they drift apart.
- Locale files must stay key-synchronized; `pnpm check:i18n` verifies that.

## External control

Build the client for Linux, Windows, or macOS:

```sh
cargo build --release --manifest-path src-tauri/Cargo.toml -p tyco-ctl
tyco-ctl open editor
tyco-ctl commands list --json
tyco-ctl run my-command --stdin --wait < input.txt > output.txt
```

Tyco must already be running. Linux/macOS use a protected Unix socket; Windows
uses a named pipe restricted to the current logon session. Linux additionally
supports interactive `Open` and `ReplaceSelection` actions over D-Bus
(`org.tyco.Service`, `/org/tyco/Object`, `org.tyco.Interface`). Use `tyco-ctl`
for command discovery, execution results, and job management.

Settings → Commands controls external execution and selection
capture/replacement. Every executable command needs an individual external
grant. New core/plugin commands are not automatically exposed. Non-interactive
calls require explicit input; `--interactive` permits input/confirmation UI.
Use `--wait` to obtain actual command completion, or manage the returned job ID
through `tyco-ctl jobs`. Selection replacement is explicit:

```sh
tyco-ctl run default:core.correct:fix --selection --replace --interactive --wait
```

The command and selection grants must both be enabled. Internal selection
hotkeys retain their own behavior; they are independent of external access.

See [External control API](docs/external-control.md) for the complete CLI,
D-Bus contract, permissions, exit codes, platform behavior, and migration guide.
