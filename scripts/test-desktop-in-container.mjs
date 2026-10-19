#!/usr/bin/env node
// Builds the embedded debug app and runs the native desktop smoke
// (`pnpm test:desktop`) in an Ubuntu 24.04 image with the packages of the CI
// job `desktop-smoke`: WebKitWebDriver, Xvfb and Openbox are not packaged
// alike on every distribution. The app is built into its own target
// directory, so a host build is left alone.
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { userInfo } from 'node:os'

const root = resolve(import.meta.dirname, '..')
/** @param {string} path */
const read = async (path) => readFile(resolve(root, path), 'utf8')
const playwrightVersion = JSON.parse(await read('apps/desktop-ui/package.json'))
  .devDependencies['@playwright/test']
const rustToolchain = (await read('rust-toolchain.toml')).match(
  /channel = "([^"]+)"/
)?.[1]
if (!rustToolchain) throw new Error('rust-toolchain.toml names no channel')
const image = `tyco-desktop-smoke:${playwrightVersion}-${rustToolchain}`
const targetDir = 'src-tauri/target/container'

/** @param {string[]} args */
function docker(args) {
  const result = spawnSync('docker', args, { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

docker([
  'build',
  '--file',
  resolve(root, 'scripts/containers/desktop-smoke.Dockerfile'),
  '--build-arg',
  `PLAYWRIGHT_VERSION=${playwrightVersion}`,
  '--build-arg',
  `RUST_TOOLCHAIN=${rustToolchain}`,
  '--tag',
  image,
  resolve(root, 'scripts/containers'),
])

const script = [
  'mkdir -p "$HOME/bin"',
  'corepack enable --install-directory "$HOME/bin"',
  'export PATH="$HOME/bin:$PATH"',
  'cargo build --manifest-path src-tauri/Cargo.toml --locked -p tyco-ctl',
  'pnpm tauri:build --debug --no-bundle',
  `xvfb-run -a dbus-run-session -- sh -c 'openbox >/tmp/tyco-openbox.log 2>&1 & pnpm test:desktop'`,
].join(' && ')

const { uid, gid } = userInfo()
docker([
  'run',
  '--rm',
  // xvfb-run as process 1 never hears that Xvfb is ready
  '--init',
  '--ipc=host',
  // files written into the checkout stay the user's
  '--user',
  `${uid}:${gid}`,
  '--env',
  'HOME=/tmp/home',
  // the toolchain is in the image; the crates are fetched into the home
  '--env',
  'CARGO_HOME=/tmp/home/.cargo',
  '--env',
  `CARGO_TARGET_DIR=${resolve(root, targetDir)}`,
  '--env',
  `TYCO_TEST_APP=${targetDir}/debug/tyco`,
  '--env',
  'COREPACK_ENABLE_DOWNLOAD_PROMPT=0',
  '--volume',
  `${root}:${root}`,
  '--workdir',
  root,
  image,
  'bash',
  '-c',
  script,
])
