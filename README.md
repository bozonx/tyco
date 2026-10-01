# TyCo - typing companion

TyCo - typing AI companion for writers and professionals who work with texts a lot.

## Structure

- `apps/desktop-ui` — Vue 3 + Vite frontend (`@tyco/desktop-ui`)
- `packages/shared` — shared config, domain types, desktop contracts (`@tyco/shared`)
- `src-tauri` — Rust backend and Tauri shell
- `scripts` — development and verification scripts
- `prototypes` — throwaway experiments, not part of the workspace

## Requirements

- Node.js 24+ and pnpm 11 (`corepack enable`)
- Rust toolchain pinned by `src-tauri/rust-toolchain.toml`
- Linux system packages for Tauri, including `gtk-layer-shell`: see the
  `bundle` job in `.github/workflows/ci.yml`
- `xdotool` (X11) or `ydotool` (Wayland) for typing into other windows.
  On Wayland only KDE Plasma 6 is supported: a KWin script finds and focuses
  the target window, and `wl-clipboard` handles the clipboard. `ydotoold`
  must be running; it writes to `/dev/uinput`, so it can send any input to
  any window, and access to it should be granted with that in mind

Development is supported on Linux and macOS. Windows development is not
supported, but production builds are expected to run on Windows.

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
| `pnpm tauri:build` | Production bundle (AppImage + deb)                |

`pnpm tauri:dev` goes through `scripts/tauri-dev.sh`, which overrides only the
dev server URL and the CSP entries that allow talking to it. Running
`pnpm tauri dev` directly points the app at the production `devUrl` instead.

## Verification

| Command             | What it covers                                   |
| ------------------- | ------------------------------------------------ |
| `pnpm check`        | version sync, i18n, lint, type-check, formatting |
| `pnpm test`         | Vitest suites                                    |
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

## Linux integration

Build the lightweight activation client and use it from a desktop environment
or window-manager hotkey:

```bash
cargo build --release --manifest-path src-tauri/Cargo.toml -p tyco-ctl
./src-tauri/target/release/tyco-ctl activate editor
```

The app also keeps the Linux D-Bus compatibility interface
(`org.tyco.Service`, `/org/tyco/Object`, `org.tyco.Interface`).

### Replacing the selection

Correction, a translation or an AI task can be applied to the text selected
in any application without opening Tyco: the text is copied out with the copy
keys, transformed, and pasted back over the selection. Correction is bound to
`Ctrl+Alt+F` by default; translations and AI tasks get their shortcuts in
Settings → Global actions. Pressing the shortcut again cancels a running
action. The same actions are available as

```bash
tyco-ctl replace correction    # or translate.<slot>, aiTask.<slot>
```

and as the D-Bus method `ReplaceSelection` of `org.tyco.Interface`. On KDE
Plasma under Wayland this needs `ydotoold` and the KWin window tracker; a
status bubble appears only when the action takes longer than a moment, and
failures also go to desktop notifications.
