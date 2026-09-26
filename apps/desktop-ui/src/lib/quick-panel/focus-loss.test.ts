import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createFocusLossWatcher } from './focus-loss'

function setup(overrides: { focused?: boolean; canDismiss?: boolean } = {}) {
  const state = {
    focused: overrides.focused ?? false,
    canDismiss: overrides.canDismiss ?? true,
  }
  const onLost = vi.fn()
  const watcher = createFocusLossWatcher({
    isFocused: async () => state.focused,
    canDismiss: () => state.canDismiss,
    onLost,
    settleMs: 100,
  })
  return { watcher, onLost, state }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createFocusLossWatcher', () => {
  it('reports a blur that lasts', async () => {
    const { watcher, onLost } = setup()

    watcher.handleFocusChange(false)
    await vi.advanceTimersByTimeAsync(99)
    expect(onLost).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(onLost).toHaveBeenCalledTimes(1)
  })

  it('ignores a blur followed by focus', async () => {
    const { watcher, onLost } = setup()

    watcher.handleFocusChange(false)
    await vi.advanceTimersByTimeAsync(50)
    watcher.handleFocusChange(true)
    await vi.advanceTimersByTimeAsync(500)

    expect(onLost).not.toHaveBeenCalled()
  })

  it('trusts the window system when it says the window is focused', async () => {
    const { watcher, onLost } = setup({ focused: true })

    watcher.handleFocusChange(false)
    await vi.advanceTimersByTimeAsync(200)

    expect(onLost).not.toHaveBeenCalled()
  })

  it('keeps the window when dismissing is not allowed', async () => {
    const { watcher, onLost } = setup({ canDismiss: false })

    watcher.handleFocusChange(false)
    await vi.advanceTimersByTimeAsync(200)

    expect(onLost).not.toHaveBeenCalled()
  })

  it('does nothing after dispose', async () => {
    const { watcher, onLost } = setup()

    watcher.handleFocusChange(false)
    watcher.dispose()
    await vi.advanceTimersByTimeAsync(200)

    expect(onLost).not.toHaveBeenCalled()
  })
})
