import { config, enableAutoUnmount } from '@vue/test-utils'
import { afterEach, vi } from 'vitest'
import { clearDismissibleLayers } from '../composables/use-dismissible-layer'

config.global.config.warnHandler = (message) => {
  throw new Error(`Unexpected Vue warning: ${message}`)
}

enableAutoUnmount(afterEach)

afterEach(() => {
  clearDismissibleLayers()
  vi.useRealTimers()
  window.localStorage.clear()
  window.sessionStorage.clear()
  document.body.innerHTML = ''
})

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi
    .fn()
    .mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
})

if (typeof window.localStorage === 'undefined' || !window.localStorage.clear) {
  let store: Record<string, string> = {}
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value
      },
      removeItem: (key: string) => {
        delete store[key]
      },
      clear: () => {
        store = {}
      },
      key: (index: number) => Object.keys(store)[index] ?? null,
      get length() {
        return Object.keys(store).length
      },
    },
    writable: true,
    configurable: true,
  })
}
