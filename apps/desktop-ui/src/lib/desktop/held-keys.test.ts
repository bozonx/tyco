import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createHeldKeys } from './held-keys'

function keyEvent(type: string, code: string) {
  return Object.assign(new Event(type), { code, key: code })
}

describe('held-keys', () => {
  let source: EventTarget

  beforeEach(() => {
    vi.useFakeTimers()
    source = new EventTarget()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const settled = async (promise: Promise<void>) => {
    let done = false
    void promise.then(() => (done = true))
    await vi.advanceTimersByTimeAsync(0)
    return done
  }

  it('resolves at once when no key is held', async () => {
    const heldKeys = createHeldKeys(source)
    expect(await settled(heldKeys.waitForRelease(500))).toBe(true)
  })

  it('waits until every held key is released', async () => {
    const heldKeys = createHeldKeys(source)
    source.dispatchEvent(keyEvent('keydown', 'ShiftLeft'))
    source.dispatchEvent(keyEvent('keydown', 'Enter'))
    const waiting = heldKeys.waitForRelease(500)

    source.dispatchEvent(keyEvent('keyup', 'Enter'))
    expect(await settled(waiting)).toBe(false)
    source.dispatchEvent(keyEvent('keyup', 'ShiftLeft'))
    expect(await settled(waiting)).toBe(true)
  })

  it('gives up after the timeout', async () => {
    const heldKeys = createHeldKeys(source)
    source.dispatchEvent(keyEvent('keydown', 'ShiftLeft'))
    const waiting = heldKeys.waitForRelease(500)

    await vi.advanceTimersByTimeAsync(499)
    expect(await settled(waiting)).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await settled(waiting)).toBe(true)
  })

  it('forgets held keys when the window loses focus', async () => {
    const heldKeys = createHeldKeys(source)
    source.dispatchEvent(keyEvent('keydown', 'ShiftLeft'))
    const waiting = heldKeys.waitForRelease(500)

    source.dispatchEvent(new Event('blur'))
    expect(await settled(waiting)).toBe(true)
  })
})
