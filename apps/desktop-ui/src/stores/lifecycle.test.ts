import { createPinia, disposePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { browserThemeRuntime } from '../lib/theme/browser-theme-runtime'
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
    nav.params.panelVisible = false
    expect(useNavPanelStore(second).params.panelVisible).toBe(true)
    nav.resetNavParams()
    expect(nav.params.panelVisible).toBe(true)
    disposePinia(first)
    disposePinia(second)
  })
})
