import { describe, expect, it, vi } from 'vitest'

import { createMarkupMode } from './markup-mode'

describe('markup mode', () => {
  it('focuses only when the view mode changes', () => {
    const focus = vi.fn()
    const mode = createMarkupMode(focus)
    mode.setShowMarkup(false)
    expect(focus).not.toHaveBeenCalled()
    mode.toggleShowMarkup()
    expect(mode.showMarkup.value).toBe(true)
    mode.setShowMarkup(true)
    expect(focus).toHaveBeenCalledOnce()
  })
})
