import { createPinia, disposePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'

import { useMarkupModeStore } from '../../stores/markup-mode'
import { createMarkupMode } from './markup-mode'

describe('markup mode', () => {
  it('focuses only when the view mode changes and resets without focus', () => {
    const focus = vi.fn()
    const mode = createMarkupMode(focus)
    mode.setShowMarkup(false)
    expect(focus).not.toHaveBeenCalled()
    mode.toggleShowMarkup()
    expect(mode.showMarkup.value).toBe(true)
    mode.setShowMarkup(true)
    expect(focus).toHaveBeenCalledOnce()
    mode.resetShowMarkup()
    expect(mode.showMarkup.value).toBe(false)
    expect(focus).toHaveBeenCalledOnce()
  })

  it('shares mode within one Pinia and isolates separate applications', () => {
    const firstPinia = createPinia()
    const secondPinia = createPinia()
    try {
      const first = useMarkupModeStore(firstPinia)
      first.setShowMarkup(true)
      expect(useMarkupModeStore(firstPinia).showMarkup).toBe(true)
      expect(useMarkupModeStore(secondPinia).showMarkup).toBe(false)
      expect(first.showMarkup).toBe(true)
    } finally {
      disposePinia(firstPinia)
      disposePinia(secondPinia)
    }
  })
})
