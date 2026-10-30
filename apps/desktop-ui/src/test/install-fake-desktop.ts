import { emit } from '@tauri-apps/api/event'
import { clearMocks, mockIPC, mockWindows } from '@tauri-apps/api/mocks'
import type { DesktopEventPayloads } from '@tyco/shared'
import { createPinia, setActivePinia, type Pinia } from 'pinia'

import { useDesktopStore } from '../stores/desktop'
import {
  FakeDesktopBackend,
  type FakeDesktopOptions,
} from './fake-desktop-backend'

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
      const args: unknown =
        payload instanceof Uint8Array
          ? { bytes: payload, meta: undefined }
          : payload
      const response = await backend.dispatch(command, args)
      if (response.ok) return response.value
      throw response.error
    },
    { shouldMockEvents: true }
  )

  return {
    backend,
    pinia,
    /** Loads the desktop state the way the app does at startup. */
    load: () => useDesktopStore().loadDesktopState(),
    emit: <K extends keyof DesktopEventPayloads>(
      event: K,
      payload: DesktopEventPayloads[K]
    ) => emit(event, payload),
    dispose() {
      clearMocks()
      delete (globalThis as Globals).isTauri
      const unhandled = [...backend.unhandledCommands]
      if (unhandled.length > 0) {
        throw new Error(`Unhandled desktop commands: ${unhandled.join(', ')}`)
      }
    },
  }
}

export type TestDesktop = ReturnType<typeof installFakeDesktop>
