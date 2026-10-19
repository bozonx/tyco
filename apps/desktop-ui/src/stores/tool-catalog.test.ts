import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useToolCatalogStore } from './tool-catalog'

const mocks = vi.hoisted(() => ({ call: vi.fn(), error: vi.fn() }))
vi.mock('./ipc', () => ({ useIpcStore: () => ({ call: mocks.call }) }))
vi.mock('./tools', () => ({ useToolsStore: () => ({ list: () => [] }) }))
vi.mock('../lib/i18n', () => ({ translate: (key: string) => key }))
vi.mock('../lib/logger', () => ({ clientLogger: { error: mocks.error } }))

afterEach(() => vi.useRealTimers())
describe('tool catalog IPC delivery', () => {
  it('reports and retries a structured IPC failure', async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    const pinia = createPinia()
    setActivePinia(pinia)
    mocks.call
      .mockResolvedValueOnce({ success: false, error: 'Unavailable' })
      .mockResolvedValue({ success: true, result: undefined })
    const store = useToolCatalogStore()
    store.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.error).toHaveBeenCalledWith(
      'Tool catalog sync failed',
      expect.objectContaining({ message: 'Unavailable' })
    )
    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.call).toHaveBeenCalledTimes(2)
    expect(mocks.call).toHaveBeenLastCalledWith('set_tool_catalog', {
      tools: [],
    })
    disposePinia(pinia)
    expect(vi.getTimerCount()).toBe(0)
  })
})
