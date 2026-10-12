import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDefaultCommandsStore } from './commands'
import { useIpcStore } from './ipc'

vi.mock('../lib/logger', () => ({ clientLogger: { error: vi.fn() } }))
let pinia: ReturnType<typeof createPinia>
beforeEach(() => {
  vi.useFakeTimers()
  pinia = createPinia()
  setActivePinia(pinia)
})
afterEach(() => {
  disposePinia(pinia)
  vi.useRealTimers()
})

describe('default command synchronization ownership', () => {
  it('retries a failed IPC load and stops retrying when disposed', async () => {
    const load = vi
      .spyOn(useIpcStore(), 'callFunction')
      .mockResolvedValue({ success: false, error: 'Backend unavailable' })
    const store = useDefaultCommandsStore()
    store.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledExactlyOnceWith('getUserConfig', [])
    await vi.advanceTimersByTimeAsync(1000)
    expect(load).toHaveBeenCalledTimes(2)
    store.dispose()
    store.start()
    await vi.advanceTimersByTimeAsync(10000)
    expect(load).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })
})
