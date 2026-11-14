import { disposePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FakeDesktopError } from '../test/fake-desktop-backend'
import { installFakeDesktop } from '../test/install-fake-desktop'
import { useOperationCatalogStore } from './operation-catalog'

const mocks = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('./operations', () => ({
  useOperationsStore: () => ({ list: () => [] }),
}))
vi.mock('../lib/i18n', () => ({ translate: (key: string) => key }))
vi.mock('../lib/logger', () => ({ clientLogger: { error: mocks.error } }))

afterEach(() => vi.useRealTimers())
describe('tool catalog IPC delivery', () => {
  it('reports and retries a structured IPC failure', async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    const desktop = installFakeDesktop()
    let isAvailable = false
    desktop.backend.handle('set_operation_catalog', () => {
      if (!isAvailable)
        throw new FakeDesktopError({
          code: 'operationFailed',
          message: 'Unavailable',
        })
      return undefined
    })
    try {
      const store = useOperationCatalogStore()
      store.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(mocks.error).toHaveBeenCalledWith(
        'Tool catalog sync failed',
        expect.objectContaining({ message: 'Unavailable' })
      )
      isAvailable = true
      await vi.advanceTimersByTimeAsync(1000)
      expect(desktop.backend.callsOf('set_operation_catalog')).toEqual([
        { tools: [] },
        { tools: [] },
      ])
      disposePinia(desktop.pinia)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      desktop.dispose()
    }
  })
})
