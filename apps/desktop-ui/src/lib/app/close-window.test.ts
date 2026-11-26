import { describe, expect, it, vi } from 'vitest'

import { createCloseWindowModel, isCloseAllEvent } from './close-window'

const keydown = (init: Partial<KeyboardEvent>) => ({
  key: 'w',
  code: 'KeyW',
  ctrlKey: true,
  preventDefault: vi.fn(),
  stopImmediatePropagation: vi.fn(),
  ...init,
})

describe('close window', () => {
  it('takes only a plain Ctrl+W for close all', () => {
    expect(isCloseAllEvent({ key: 'w', ctrlKey: true })).toBe(true)
    expect(isCloseAllEvent({ key: 'Escape' })).toBe(false)
    expect(
      isCloseAllEvent({ key: 'Escape', shiftKey: true, ctrlKey: true })
    ).toBe(false)
    expect(
      isCloseAllEvent({ key: 'Escape', shiftKey: true, isComposing: true })
    ).toBe(false)
  })

  it('consumes Ctrl+W and closes the window', () => {
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

  it('consumes Ctrl+Q and calls exitApp', () => {
    const closeWindow = vi.fn()
    const exitApp = vi.fn()
    const model = createCloseWindowModel({ closeWindow, exitApp })
    const event = keydown({ key: 'q', code: 'KeyQ' })
    expect(model.handleKeydown(event)).toBe(true)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopImmediatePropagation).toHaveBeenCalled()
    expect(exitApp).toHaveBeenCalledOnce()
    expect(closeWindow).not.toHaveBeenCalled()
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
