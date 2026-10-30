import { emit } from '@tauri-apps/api/event'
import { clearMocks, mockIPC, mockWindows } from '@tauri-apps/api/mocks'
import {
  desktopSnapshotToView,
  desktopViewToSnapshot,
  type DesktopEventPayloads,
  type DesktopViewState,
  type UserConfig,
} from '@tyco/shared'
import { createPinia, setActivePinia, type Pinia } from 'pinia'

import { useDesktopStore } from '../stores/desktop'
import {
  FakeDesktopBackend,
  type FakeDesktopOptions,
} from './fake-desktop-backend'

const toWire = (value: unknown): unknown =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value))

interface TauriInternals {
  __TAURI_INTERNALS__?: { invoke?: (command: string) => Promise<unknown> }
  __TAURI_EVENT_PLUGIN_INTERNALS__?: { unregisterListener?: () => void }
}

/**
 * A component still mounted when the test ends stops listening on unmount,
 * after `dispose`: that is let through, any other late call fails.
 */
function allowLateUnlisten() {
  const tauri = window as unknown as TauriInternals
  if (tauri.__TAURI_EVENT_PLUGIN_INTERNALS__)
    tauri.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener = () => {}
  if (tauri.__TAURI_INTERNALS__)
    tauri.__TAURI_INTERNALS__.invoke = async (command) => {
      if (command === 'plugin:event|unlisten') return
      throw new Error(`The fake desktop is disposed: ${command}`)
    }
}

interface Globals {
  isTauri?: boolean
}

/**
 * Puts the shared fake backend behind `@tauri-apps/api` in jsdom, so a
 * component test runs the real stores, models and IPC client and replaces only
 * the native side, like the Playwright tests do. Mount with `global: { plugins:
 * [desktop.pinia] }`, call `load()` when the component reads the desktop state,
 * and `dispose()` after the test: it fails when a command had no handler.
 */
export function installFakeDesktop(
  options: FakeDesktopOptions = {},
  windowLabel = 'main'
) {
  const backend = new FakeDesktopBackend(options)
  const pinia: Pinia = createPinia()
  setActivePinia(pinia)
  mockWindows(windowLabel)
  ;(globalThis as Globals).isTauri = true
  mockIPC(
    async (command, payload) => {
      // `mockIPC` drops request headers, so the `meta` of a binary command
      // (sent in a header) does not reach the backend here; the browser
      // tests cover binary commands end to end.
      // Other arguments and results cross as JSON, as over real IPC: reactive
      // proxies and `undefined` fields do not reach the other side.
      const args: unknown =
        payload instanceof Uint8Array
          ? { bytes: payload, meta: undefined }
          : toWire(payload)
      const response = await backend.dispatch(command, args)
      if (response.ok) return toWire(response.value)
      throw response.error
    },
    { shouldMockEvents: true }
  )

  const desktop = {
    backend,
    pinia,
    /** Loads the desktop state the way the app does at startup. */
    load: () => useDesktopStore().loadDesktopState(),
    /**
     * Changes the desktop state and delivers it to the store the way the app
     * does on `STATE_CHANGED`: a new activation, a shown window, a config saved
     * elsewhere.
     */
    setState(patch: Partial<DesktopViewState>) {
      const current = desktopSnapshotToView(backend.snapshot())
      const next = desktopViewToSnapshot({ ...current, ...patch })
      backend.activation = next.activation
      backend.window = next.window
      backend.userConfig = next.settings.userConfig
      backend.sessionState = next.settings.sessionState
      backend.touch()
      useDesktopStore().applyViewState(
        desktopSnapshotToView(backend.snapshot())
      )
    },
    /** `setState` for a config saved elsewhere, e.g. in another window. */
    setUserConfig(patch: Partial<UserConfig>) {
      desktop.setState({ userConfig: { ...backend.userConfig, ...patch } })
    },
    emit: <K extends keyof DesktopEventPayloads>(
      event: K,
      payload: DesktopEventPayloads[K]
    ) => emit(event, payload),
    dispose() {
      clearMocks()
      delete (globalThis as Globals).isTauri
      allowLateUnlisten()
      const unhandled = [...backend.unhandledCommands]
      if (unhandled.length > 0) {
        throw new Error(`Unhandled desktop commands: ${unhandled.join(', ')}`)
      }
    },
  }
  return desktop
}

/**
 * `installFakeDesktop` with the desktop state already loaded. The calls of the
 * load are cleared, so `backend.calls` holds what the test causes.
 */
export async function loadFakeDesktop(
  options: FakeDesktopOptions = {},
  windowLabel = 'main'
) {
  const desktop = installFakeDesktop(options, windowLabel)
  await desktop.load()
  desktop.backend.calls.length = 0
  return desktop
}

export type TestDesktop = ReturnType<typeof installFakeDesktop>
