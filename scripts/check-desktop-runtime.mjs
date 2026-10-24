#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const runFile = promisify(execFile)
const isWindows = process.platform === 'win32'
const root = resolve(import.meta.dirname, '..')
const home = await mkdtemp(resolve(tmpdir(), 'tyco-desktop-smoke-'))
const binary = resolve(
  root,
  process.env.TYCO_TEST_APP ??
    `src-tauri/target/debug/tyco${isWindows ? '.exe' : ''}`
)
const runtimeDir = resolve(home, 'runtime')
await mkdir(runtimeDir, { mode: 0o700 })
const endpoint = 'http://127.0.0.1:4444'
const appEnv = {
  ...process.env,
  TYCO_DEV_HOME: home,
  ...(!isWindows
    ? {
        XDG_RUNTIME_DIR: runtimeDir,
        XDG_SESSION_TYPE: 'x11',
        XDG_CURRENT_DESKTOP: 'Openbox',
        XDG_SESSION_DESKTOP: 'openbox',
        WAYLAND_DISPLAY: '',
        GDK_BACKEND: 'x11',
        WEBKIT_DISABLE_DMABUF_RENDERER: '1',
      }
    : {}),
}
let proxyRequestCount = 0
const server = createServer((_request, response) => {
  proxyRequestCount += 1
  response.writeHead(204)
  response.end()
})
const driver = spawn(process.env.TYCO_TEST_DRIVER ?? 'tauri-driver', [], {
  env: appEnv,
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
        .then(value => done({ ok: true, value }), error => done({ ok: false, error: typeof error === 'object' ? JSON.stringify(error) : String(error) }));`,
    args: [command, args],
  })
  assert.equal(result.ok, true, `${command}: ${result.error}`)
  console.log(`Desktop IPC verified: ${command}`)
  return result.value
}
const startSession = async () => {
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
  await startSession()

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

  const initial = (await invoke('get_desktop_state')).settings.userConfig
  const first = await invoke('save_user_config', {
    baseConfig: initial,
    userConfig: {
      ...initial,
      appearance: { ...initial.appearance, theme: 'dark' },
    },
  })
  assert.equal(first.settings.userConfig.appearance.theme, 'dark')
  const second = await invoke('save_user_config', {
    baseConfig: initial,
    userConfig: { ...initial, language: { ui: 'en-US', user: 'en-US' } },
  })
  assert.equal(
    second.settings.userConfig.appearance.theme,
    'dark',
    "Stale snapshots must preserve another window's changes"
  )
  assert.equal(second.settings.userConfig.language.user, 'en-US')

  const historyId = await invoke('add_editor_history_item', {
    entry: {
      text: 'Desktop smoke source',
      kind: 'source',
      operation: 'aiTask',
    },
  })
  assert.equal(typeof historyId, 'string')
  await invoke('set_editor_history_item_result', {
    id: historyId,
    result: 'Smoke result',
  })
  const history = await invoke('get_editor_history')
  assert.equal(
    history.find((/** @type {{ id: string }} */ item) => item.id === historyId)
      ?.result,
    'Smoke result'
  )
  // The offline fixture must be unreachable from the webview, but reachable via Rust.
  await new Promise((done) =>
    server.listen(0, '127.0.0.1', () => done(undefined))
  )
  const address = /** @type {import('node:net').AddressInfo} */ (
    server.address()
  )
  const proxyUrl = `http://127.0.0.1:${address.port}/smoke`
  const cspBlocked = await request(
    'POST',
    `/session/${session}/execute/async`,
    {
      script: `const done = arguments[arguments.length - 1];
      fetch(arguments[0]).then(() => done(false), () => done(true));`,
      args: [proxyUrl],
    }
  )
  assert.equal(cspBlocked, true, 'Production CSP must block direct HTTP')
  assert.equal(proxyRequestCount, 0)
  const networkConfig = (await invoke('get_desktop_state')).settings.userConfig
  await invoke('save_user_config', {
    baseConfig: networkConfig,
    userConfig: {
      ...networkConfig,
      llm: {
        ...networkConfig.llm,
        providers: [
          ...(networkConfig.llm?.providers ?? []),
          { id: 'desktop-smoke', type: 'openaiCompatible', baseUrl: proxyUrl },
        ],
      },
    },
  })
  const proxyResult = await request(
    'POST',
    `/session/${session}/execute/async`,
    {
      script: `const done = arguments[arguments.length - 1];
      const ipc = window.__TAURI_INTERNALS__;
      let status;
      const callback = ipc.transformCallback(({ message }) => {
        if (message?.type === 'head') status = message.status;
        if (message?.type === 'end') done({ status });
        if (message?.type === 'error') done({ error: message.message });
      });
      ipc.invoke('start_fetch', { request: { method: 'GET', url: arguments[0] }, onEvent: '__CHANNEL__:' + callback })
        .catch(error => done({ error: String(error) }));`,
      args: [proxyUrl],
    }
  )
  assert.deepEqual(proxyResult, { status: 204 })
  assert.equal(proxyRequestCount, 1)

  const ctl = resolve(binary, '..', `tyco-ctl${isWindows ? '.exe' : ''}`)
  const status = await runFile(ctl, ['status'], { env: appEnv, timeout: 20000 })
  assert.equal(JSON.parse(status.stdout).running, true)
  await runFile(ctl, ['open', 'editor', '--text', 'CLI smoke input'], {
    env: appEnv,
    timeout: 20000,
  })
  await waitFor(
    () =>
      execute(
        "return document.querySelector('.cm-content')?.textContent.includes('CLI smoke input')"
      ),
    'CLI editor input'
  )
  if (!isWindows) {
    await runFile(
      'gdbus',
      [
        'call',
        '--session',
        '--dest',
        'org.tyco.Service',
        '--object-path',
        '/org/tyco/Object',
        '--method',
        'org.tyco.Interface.OpenWithText',
        'editor',
        'D-Bus smoke input',
      ],
      { env: appEnv, timeout: 20000 }
    )
    await waitFor(
      () =>
        execute(
          "return document.querySelector('.cm-content')?.textContent.includes('D-Bus smoke input')"
        ),
      'D-Bus editor input'
    )
  }

  const manifest = {
    id: 'DesktopSmoke',
    version: '1.0.0',
    apiVersion: 2,
    capabilities: [],
    label: 'Desktop smoke',
    defaultLocale: 'en-US',
    locales: Object.fromEntries(
      [
        'en-US',
        'ru-RU',
        'de-DE',
        'fr-FR',
        'es',
        'it-IT',
        'pt-BR',
        'pl-PL',
        'tr-TR',
        'uk-UA',
        'cs-CZ',
        'hu-HU',
        'ro-RO',
        'el-GR',
        'hr-HR',
        'ka-GE',
        'kk-KZ',
        'zh-CN',
        'zh-TW',
        'ja-JP',
        'ko-KR',
      ].map((locale) => [locale, {}])
    ),
  }
  const module = `export default () => ({ ...${JSON.stringify(manifest)}, async init(ctx) {
    if (typeof window !== 'undefined' || typeof document !== 'undefined' || typeof globalThis.__TAURI_INTERNALS__ !== 'undefined') throw new Error('Host globals exposed');
    let blocked = false; try { globalThis.eval('1'); } catch { blocked = true; }
    if (!blocked) throw new Error('Worker eval exposed');
    blocked = false; try { await fetch('https://example.com/'); } catch { blocked = true; }
    if (!blocked) throw new Error('Worker network exposed');
    await ctx.toastText('Desktop sandbox verified', 'success');
  } })`
  // Installation goes through the file dialog; the store of installed
  // packages is filled the way an installation leaves it instead.
  /** @type {{ locations: { kinds: string[]; path: string }[] }} */
  const storage = await invoke('get_storage_info')
  const dataDir = storage.locations.find(({ kinds }) =>
    kinds.includes('data')
  )?.path
  assert.ok(dataDir, 'The app has no data directory')
  const pluginsDir = resolve(dataDir, 'plugins')
  await mkdir(pluginsDir, { recursive: true })
  await writeFile(
    resolve(pluginsDir, `${Buffer.from(manifest.id).toString('hex')}.json`),
    JSON.stringify({
      package: { formatVersion: 1, manifest, module },
      revision: '1',
    })
  )
  await execute('location.reload()')
  await waitFor(
    () =>
      execute(
        'return document.readyState === "complete" && Boolean(window.__TAURI_INTERNALS__)'
      ),
    'reloaded webview'
  )
  const current = (await invoke('get_desktop_state')).settings.userConfig
  await invoke('save_user_config', {
    baseConfig: current,
    userConfig: {
      ...current,
      plugins: {
        ...current.plugins,
        DesktopSmoke: { isEnabled: true, settings: {} },
      },
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
  // Change a setting through the actual UI, then restart the native process.
  await waitFor(
    () =>
      execute(
        `return Boolean(document.querySelector('.settings-panel input[type="radio"][value="eInk"]'))`
      ),
    'theme control'
  )
  await execute(
    `document.querySelector('.settings-panel input[type="radio"][value="eInk"]').click()`
  )
  await waitFor(
    async () =>
      (await invoke('get_desktop_state')).settings.userConfig.appearance
        .theme === 'eInk',
    'UI setting persisted by Rust'
  )
  await request('DELETE', `/session/${session}`)
  session = undefined
  await startSession()
  assert.equal(
    (await invoke('get_desktop_state')).settings.userConfig.appearance.theme,
    'eInk'
  )
  await waitFor(
    () => execute("return document.documentElement.dataset.theme === 'eInk'"),
    'restored theme'
  )
  assert.equal(
    (await invoke('get_editor_history')).find(
      (/** @type {{ id: string }} */ item) => item.id === historyId
    )?.result,
    'Smoke result'
  )
  await invoke('delete_editor_history_item', { id: historyId })
  assert.equal(
    (await invoke('get_editor_history')).some(
      (/** @type {{ id: string }} */ item) => item.id === historyId
    ),
    false
  )
  await waitFor(
    () =>
      execute(
        "return document.body.textContent.includes('Desktop sandbox verified')"
      ),
    'plugin activation after restart'
  )
  await invoke('uninstall_plugin_package', { id: manifest.id })
  if (!isWindows) {
    const mainHandle = await request('GET', `/session/${session}/window`)
    const foreign = spawn(
      'python3',
      [
        resolve(root, 'scripts/linux-platform/editor.py'),
        home,
        'TycoSmokeTarget',
      ],
      { env: appEnv, stdio: ['ignore', 'ignore', 'pipe'] }
    )
    let foreignOutput = ''
    /** @type {Error | undefined} */
    let foreignError
    foreign.on('error', (error) => {
      foreignError = error
    })
    foreign.stderr.on('data', (chunk) => {
      foreignOutput = (foreignOutput + chunk).slice(-20000)
    })
    try {
      await waitFor(async () => {
        if (foreignError) throw foreignError
        if (foreign.exitCode !== null)
          throw new Error(`Foreign editor exited: ${foreignOutput}`)
        try {
          await readFile(resolve(home, 'TycoSmokeTarget.text'))
          return true
        } catch {
          return false
        }
      }, 'foreign GTK editor')
      const { stdout: target } = await runFile(
        'xdotool',
        ['search', '--onlyvisible', '--sync', '--name', '^TycoSmokeTarget$'],
        { env: appEnv, timeout: 10000 }
      )
      await runFile('xdotool', ['windowactivate', '--sync', target.trim()], {
        env: appEnv,
        timeout: 10000,
      })
      await waitFor(
        async () =>
          (await readFile(resolve(home, 'TycoSmokeTarget.focused'), 'utf8')) ===
          'True',
        'focused foreign editor'
      )
      await runFile(ctl, ['open', 'quick-input'], {
        env: appEnv,
        timeout: 20000,
      })
      await waitFor(async () => {
        for (const handle of await request(
          'GET',
          `/session/${session}/window/handles`
        )) {
          // Switching to main would blur and dismiss the quick input.
          if (handle === mainHandle) continue
          await request('POST', `/session/${session}/window`, { handle })
          if (
            await execute(
              "return document.documentElement.dataset.window === 'quick' && Boolean(document.querySelector('textarea'))"
            )
          )
            return true
        }
        return false
      }, 'quick input window')
      const input = await request('POST', `/session/${session}/element`, {
        using: 'css selector',
        value: 'textarea',
      })
      const inputId = input['element-6066-11e4-a52e-4f735466cecf']
      await request('POST', `/session/${session}/element/${inputId}/value`, {
        text: 'Native quick insertion',
      })
      // Tab opens the actions for the original text; this path needs no provider.
      await request('POST', `/session/${session}/element/${inputId}/value`, {
        text: '\uE004',
      })
      await waitFor(
        () =>
          execute(
            `return [...document.querySelectorAll('button')].some(button => button.textContent.includes('Insert into window'))`
          ),
        'insert action'
      )
      await execute(
        `const button = [...document.querySelectorAll('button')].find(button => button.textContent.includes('Insert into window')); button.click()`
      )
      await waitFor(
        async () =>
          (await readFile(resolve(home, 'TycoSmokeTarget.text'), 'utf8')) ===
          'Native quick insertion',
        'text received by foreign editor'
      )
    } finally {
      foreign.kill('SIGTERM')
      await Promise.race([
        new Promise((done) => foreign.once('exit', done)),
        delay(3000),
      ])
      if (foreign.exitCode === null && !foreignError) foreign.kill('SIGKILL')
      await writeFile(resolve(home, 'foreign-editor.log'), foreignOutput)
    }
  }
  console.log(
    'Desktop smoke passed: embedded startup, IPC permissions, config updates, history lifecycle, production CSP, Rust HTTP proxy, CLI, D-Bus (Linux), plugin sandbox, lazy routes, native restart persistence and X11 quick insertion (Linux)'
  )
} catch (error) {
  let failureLog = `${String(error)}\n${driverOutput}\n`
  for (const file of await readdir(home, { recursive: true })) {
    if (file.endsWith('.log')) {
      const log = (await readFile(resolve(home, file), 'utf8')).slice(-20000)
      failureLog += `\n${file}\n${log}`
      console.error(log)
    }
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
  await writeFile(resolve(root, 'desktop-smoke-failure.log'), failureLog)
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
  await new Promise((done) => server.close(() => done(undefined)))
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
