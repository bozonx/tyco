import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createWindowFocus } from './window-focus'

function setup(focused = true) {
  const state = { focused }
  const onChange = vi.fn()
  const tracker = createWindowFocus({
    isFocused: async () => state.focused,
    onChange,
    settleMs: 100,
  })
  return { tracker, onChange, state }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createWindowFocus', () => {
  it('shows a gained focus at once', () => {
    const { tracker, onChange } = setup()

    tracker.handleFocusChange(true)

    expect(onChange).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('shows a lost focus once it lasts', async () => {
    const { tracker, onChange } = setup()
    tracker.handleFocusChange(true)
    onChange.mockClear()

    tracker.handleFocusChange(false)
    await vi.advanceTimersByTimeAsync(99)
    expect(onChange).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(onChange).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('ignores a blur followed by focus', async () => {
    const { tracker, onChange } = setup()
    tracker.handleFocusChange(true)
    onChange.mockClear()

    tracker.handleFocusChange(false)
    tracker.handleFocusChange(true)
    await vi.advanceTimersByTimeAsync(200)

    expect(onChange).not.toHaveBeenCalled()
  })

  it('reads the window state on refresh', async () => {
    const { tracker, onChange, state } = setup(false)

    await tracker.refresh()
    expect(onChange).toHaveBeenLastCalledWith(false)

    state.focused = true
    await tracker.refresh()
    expect(onChange).toHaveBeenLastCalledWith(true)
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('lets a focus event win over a refresh still waiting', async () => {
    const { tracker, onChange } = setup(false)

    const pending = tracker.refresh()
    tracker.handleFocusChange(true)
    await pending

    expect(onChange).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('assumes focus when the window system does not answer', async () => {
    const onChange = vi.fn()
    const tracker = createWindowFocus({
      isFocused: async () => {
        throw new Error('no answer')
      },
      onChange,
    })

    await tracker.refresh()

    expect(onChange).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('reports nothing after dispose', async () => {
    const { tracker, onChange } = setup()
    tracker.handleFocusChange(true)
    onChange.mockClear()

    tracker.handleFocusChange(false)
    tracker.dispose()
    await vi.advanceTimersByTimeAsync(200)

    expect(onChange).not.toHaveBeenCalled()
  })
})
