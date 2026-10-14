#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const root = resolve(import.meta.dirname, '..')
const home = await mkdtemp(resolve(tmpdir(), 'tyco-desktop-smoke-'))
const binary = resolve(
  root,
  process.env.TYCO_TEST_APP ?? 'src-tauri/target/debug/tyco'
)
const runtimeDir = resolve(home, 'runtime')
await mkdir(runtimeDir, { mode: 0o700 })
const endpoint = 'http://127.0.0.1:4444'
const driver = spawn(process.env.TYCO_TEST_DRIVER ?? 'tauri-driver', [], {
  env: {
    ...process.env,
    TYCO_DEV_HOME: home,
    XDG_RUNTIME_DIR: runtimeDir,
    XDG_SESSION_TYPE: 'x11',
    XDG_CURRENT_DESKTOP: 'Openbox',
    XDG_SESSION_DESKTOP: 'openbox',
    WAYLAND_DISPLAY: '',
    GDK_BACKEND: 'x11',
    WEBKIT_DISABLE_DMABUF_RENDERER: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let driverOutput = ''
/** @type {Error | undefined} */
let driverError
for (const stream of [driver.stdout, driver.stderr])
  stream.on('data', (chunk) => {
    driverOutput = (driverOutput + chunk).slice(-20000)
  })
driver.on('error', (error) => {
  driverError = error
})
/** @type {string | undefined} */
let session
/**
 * @param {string} method
 * @param {string} path
 * @param {unknown} [body]
 * @returns {Promise<any>} WebDriver JSON values depend on the requested
 *   endpoint.
 */
const request = async (method, path, body) => {
  const response = await fetch(`${endpoint}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  })
  /** @type {{ value: any }} */
  const result = /** @type {{ value: any }} */ (await response.json())
  if (!response.ok || result.value?.error)
    throw new Error(JSON.stringify(result.value))
  return result.value
}
/**
 * @param {() => Promise<boolean>} check
 * @param {string} label
 */
const waitFor = async (check, label, timeout = 20000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (driverError) throw driverError
    if (driver.exitCode !== null)
      throw new Error(`Driver exited: ${driverOutput}`)
    if (await check()) return
    await delay(100)
  }
  throw new Error(`Timed out waiting for ${label}`)
}
/**
 * @param {string} script
 * @param {unknown[]} [args]
 */
const execute = (script, args = []) =>
  request('POST', `/session/${session}/execute/sync`, { script, args })
/**
 * @param {string} command
 * @param {Record<string, unknown>} [args]
 */
const invoke = async (command, args = {}) => {
  const result = await request('POST', `/session/${session}/execute/async`, {
    script: `const done = arguments[arguments.length - 1];
      window.__TAURI_INTERNALS__.invoke(arguments[0], arguments[1])
        .then(value => done({ ok: true, value }), error => done({ ok: false, error: String(error) }));`,
    args: [command, args],
  })
  assert.equal(result.ok, true, `${command}: ${result.error}`)
  console.log(`Desktop IPC verified: ${command}`)
  return result.value
}
try {
  await readFile(binary)
  await waitFor(async () => {
    try {
      return Boolean(await request('GET', '/status'))
    } catch {
      return false
    }
  }, 'WebDriver')
  const created = await request('POST', '/session', {
    capabilities: {
      alwaysMatch: {
        'tauri:options': { application: binary, args: ['editor'] },
      },
    },
  })
  session = created.sessionId
  await request('POST', `/session/${session}/timeouts`, {
    script: 20000,
    implicit: 0,
  })
  await waitFor(async () => {
    const handles = await request('GET', `/session/${session}/window/handles`)
    for (const handle of handles) {
      await request('POST', `/session/${session}/window`, { handle })
      if (
        await execute(
          "return document.documentElement.dataset.window === 'main' && Boolean(document.querySelector('.cm-editor'))"
        )
      )
        return true
    }
    return false
  }, 'main editor')

  const origin = await execute('return location.origin')
  assert.match(
    origin,
    /^(tauri:\/\/localhost|https?:\/\/tauri\.localhost)$/,
    'Smoke tests require embedded assets, not a dev-server binary'
  )

  // Permission checks exercise the actual Tauri authority in a system webview.
  const denied = await request('POST', `/session/${session}/execute/async`, {
    script: `const done = arguments[arguments.length - 1];
      window.__TAURI_INTERNALS__.invoke('claim_external_job', { id: 'smoke-denied' })
        .then(() => done(false), () => done(true));`,
    args: [],
  })
  assert.equal(denied, true, 'Main window must not claim quick-window jobs')

  const initial = await invoke('get_user_config')
  const first = await invoke('save_user_config', {
    baseConfig: initial,
    userConfig: { ...initial, appearance: { theme: 'dark' } },
  })
  assert.equal(first.settings.userConfig.appearance.theme, 'dark')
  const second = await invoke('save_user_config', {
    baseConfig: initial,
    userConfig: { ...initial, userLanguage: 'en_US', appLanguage: 'en_US' },
  })
  assert.equal(
    second.settings.userConfig.appearance.theme,
    'dark',
    "Stale snapshots must preserve another window's changes"
  )
  assert.equal(second.settings.userConfig.userLanguage, 'en_US')

  const manifest = {
    id: 'DesktopSmoke',
    version: '1.0.0',
    apiVersion: 2,
    capabilities: [],
    label: 'Desktop smoke',
    defaultLocale: 'en_US',
    locales: { en_US: {}, ru_RU: {}, es_AR: {}, tr_TR: {} },
  }
  const module = `export default () => ({ ...${JSON.stringify(manifest)}, async init(ctx) {
    if (typeof window !== 'undefined' || typeof document !== 'undefined' || typeof globalThis.__TAURI_INTERNALS__ !== 'undefined') throw new Error('Host globals exposed');
    let blocked = false; try { globalThis.eval('1'); } catch { blocked = true; }
    if (!blocked) throw new Error('Worker eval exposed');
    blocked = false; try { await fetch('https://example.com/'); } catch { blocked = true; }
    if (!blocked) throw new Error('Worker network exposed');
    await ctx.toastText('Desktop sandbox verified', 'success');
  } })`
  const path = resolve(home, 'smoke.tyco-plugin')
  const raw = JSON.stringify({ formatVersion: 1, manifest, module })
  await writeFile(path, raw)
  await invoke('install_plugin_package', {
    path,
    manifest,
    digest: createHash('sha256').update(raw).digest('hex'),
  })
  const current = await invoke('get_user_config')
  await invoke('save_user_config', {
    baseConfig: current,
    userConfig: {
      ...current,
      plugins: { ...current.plugins, DesktopSmoke: { enabled: true } },
    },
  })
  await waitFor(
    () =>
      execute(
        "return document.body.textContent.includes('Desktop sandbox verified')"
      ),
    'isolated plugin activation'
  )

  await execute(
    'document.querySelector(\'.app-topbar button[title="Settings"]\').click()'
  )
  await waitFor(
    () => execute("return Boolean(document.querySelector('.settings-panel'))"),
    'lazy settings route'
  )
  await invoke('remove_plugin_package', { id: manifest.id })
  console.log(
    'Desktop smoke passed: startup, IPC permissions, concurrent config updates, plugin CSP and lazy routes'
  )
} catch (error) {
  for (const file of await readdir(home, { recursive: true })) {
    if (file.endsWith('.log'))
      console.error((await readFile(resolve(home, file), 'utf8')).slice(-20000))
  }
  if (session) {
    try {
      console.error(await execute('return document.body.textContent'))
      const screenshot = await request('GET', `/session/${session}/screenshot`)
      await writeFile(
        resolve(root, 'desktop-smoke-failure.png'),
        Buffer.from(screenshot, 'base64')
      )
    } catch {
      /* Preserve the original failure if the webview has exited. */
    }
  }
  console.error(driverOutput)
  throw error
} finally {
  if (session) {
    try {
      await request('DELETE', `/session/${session}`)
    } catch {
      /* The driver may have already exited. */
    }
  }
  const stopped = new Promise((done) => driver.once('exit', done))
  driver.kill('SIGTERM')
  if (driver.exitCode === null && !driverError) {
    await Promise.race([stopped, delay(3000)])
    if (driver.exitCode === null) driver.kill('SIGKILL')
  }
  await rm(home, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  })
}
