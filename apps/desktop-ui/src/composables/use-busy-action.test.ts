import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useBusyAction } from './use-busy-action'

describe('useBusyAction', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('is busy only while the action runs', async () => {
    const { isBusy, run } = useBusyAction(vi.fn())
    let release = () => {}
    const pending = run(() => new Promise<void>((r) => (release = r)))
    expect(isBusy.value).toBe(true)
    release()
    expect(await pending).toBe(true)
    expect(isBusy.value).toBe(false)
  })

  it('reports a failure and resolves to false', async () => {
    const onError = vi.fn()
    const error = new Error('nope')
    const { isBusy, run } = useBusyAction(onError)
    expect(await run(async () => Promise.reject(error))).toBe(false)
    expect(onError).toHaveBeenCalledWith(error)
    expect(isBusy.value).toBe(false)
  })
})
