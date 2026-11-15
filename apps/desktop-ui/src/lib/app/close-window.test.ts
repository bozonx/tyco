import { describe, expect, it, vi } from 'vitest'

import { createCloseWindowModel, isCloseAllEvent } from './close-window'

const keydown = (init: Partial<KeyboardEvent>) => ({
  key: 'q',
  code: 'KeyQ',
  ctrlKey: true,
  preventDefault: vi.fn(),
  stopImmediatePropagation: vi.fn(),
  ...init,
})

describe('close window', () => {
  it('takes only a plain Ctrl+Q', () => {
    expect(isCloseAllEvent({ key: 'q', ctrlKey: true })).toBe(true)
    expect(isCloseAllEvent({ key: 'Escape' })).toBe(false)
    expect(
      isCloseAllEvent({ key: 'Escape', shiftKey: true, ctrlKey: true })
    ).toBe(false)
    expect(
      isCloseAllEvent({ key: 'Escape', shiftKey: true, isComposing: true })
    ).toBe(false)
  })

  it('consumes Ctrl+Q and closes the window', () => {
    const closeWindow = vi.fn()
    const model = createCloseWindowModel({ closeWindow })
    const event = keydown({})
    expect(model.handleKeydown(event)).toBe(true)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopImmediatePropagation).toHaveBeenCalled()
    expect(closeWindow).toHaveBeenCalledOnce()
    expect(model.handleKeydown(keydown({ ctrlKey: false }))).toBe(false)
    expect(closeWindow).toHaveBeenCalledOnce()
  })

  it('lets the latest interceptor close in its own way', () => {
    const closeWindow = vi.fn()
    const model = createCloseWindowModel({ closeWindow })
    const outer = vi.fn(() => true)
    const inner = vi.fn(() => false)
    const stopOuter = model.intercept(outer)
    model.intercept(inner)
    model.closeAll()
    expect(inner).toHaveBeenCalledOnce()
    expect(outer).toHaveBeenCalledOnce()
    expect(closeWindow).not.toHaveBeenCalled()
    stopOuter()
    model.closeAll()
    expect(closeWindow).toHaveBeenCalledOnce()
  })
})
