import { flushPromises } from '@vue/test-utils'
import { DESKTOP_EVENTS } from '@tyco/shared'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { installFakeDesktop } from '../test/install-fake-desktop'
import { browserThemeRuntime } from '../lib/theme/browser-theme-runtime'
import { disposeProfileChatStore, useProfileChatStore } from './chat'
import { useProfileChatInputStore } from './chat-input'
import { useGlobalHotkeysStore } from './global-hotkeys'
import { useNavPanelStore } from './nav-panel'
import { useThemeStore } from './theme'
import { useToastStore } from './toast'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('store lifecycle', () => {
  it('unsubscribes from system appearance changes on disposal', () => {
    const stop = vi.fn()
    vi.spyOn(browserThemeRuntime, 'onSystemAppearanceChange').mockReturnValue(
      stop
    )
    vi.spyOn(browserThemeRuntime, 'getSystemAppearance').mockReturnValue({
      prefersDark: false,
      prefersMoreContrast: false,
      prefersReducedMotion: false,
    })
    vi.spyOn(browserThemeRuntime, 'applyAppearance').mockImplementation(
      () => {}
    )
    const pinia = createPinia()
    useThemeStore(pinia)
    disposePinia(pinia)
    expect(stop).toHaveBeenCalledOnce()
  })

  it('clears toast timers on disposal', () => {
    vi.useFakeTimers()
    const pinia = createPinia()
    const store = useToastStore(pinia)
    store.addToast('message')
    expect(vi.getTimerCount()).toBe(1)
    disposePinia(pinia)
    expect(vi.getTimerCount()).toBe(0)
    expect(store.toasts).toEqual([])
  })

  it('isolates navigation defaults between applications', () => {
    const first = createPinia()
    const second = createPinia()
    const nav = useNavPanelStore(first)
    nav.navPanelState.panelVisible = false
    expect(useNavPanelStore(second).navPanelState.panelVisible).toBe(true)
    nav.resetNavPanelState()
    expect(nav.navPanelState.panelVisible).toBe(true)
    disposePinia(first)
    disposePinia(second)
  })

  it('unsubscribes global hotkeys listener on disposal', async () => {
    const desktop = installFakeDesktop()
    try {
      const store = useGlobalHotkeysStore(desktop.pinia)
      await store.load()
      await flushPromises()
      const loads = () =>
        desktop.backend.callsOf('get_hotkey_provider_info').length
      // a change of the hotkeys reloads them while the store lives
      await desktop.emit(DESKTOP_EVENTS.HOTKEYS_CHANGED, null)
      await flushPromises()
      const loadsBeforeDisposal = loads()
      expect(loadsBeforeDisposal).toBeGreaterThan(1)

      disposePinia(desktop.pinia)
      await desktop.emit(DESKTOP_EVENTS.HOTKEYS_CHANGED, null)
      await flushPromises()
      expect(loads()).toBe(loadsBeforeDisposal)
    } finally {
      desktop.dispose()
    }
  })

  it('disposes both profile chat store and profile chat input store on profile removal', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useProfileChatStore('p1', pinia)
    const inputStore = useProfileChatInputStore('p1', pinia)
    inputStore.value = 'unsent draft'

    disposeProfileChatStore('p1', pinia)

    const recreatedInput = useProfileChatInputStore('p1', pinia)
    expect(recreatedInput.value).toBe('')
    disposePinia(pinia)
  })
})
