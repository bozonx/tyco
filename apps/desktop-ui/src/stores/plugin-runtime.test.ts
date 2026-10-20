import { useIpcStore } from './ipc'
import { createPinia, disposePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'

import { usePluginRuntimeStore } from './plugin-runtime'

// Exercise the actual store wiring, not just the runtime factory.
describe('plugin runtime Pinia ownership', () => {
  it('does not reuse another Pinia manager or catalog', async () => {
    const first = createPinia()
    const second = createPinia()
    try {
      const a = usePluginRuntimeStore(first)
      const b = usePluginRuntimeStore(second)
      expect(a.manager).not.toBe(b.manager)
      expect(a.pluginFactories).not.toBe(b.pluginFactories)
      a.pluginFactories.splice(0)
      expect(b.pluginFactories.length).toBeGreaterThan(0)
      disposePinia(first)
      await b.reloadPlugins()
      expect(b.pluginFactories.length).toBeGreaterThan(0)
    } finally {
      disposePinia(first)
      disposePinia(second)
    }
  })
})

it('owns package operations and rejects failed desktop results', async () => {
  const pinia = createPinia()
  try {
    const runtime = usePluginRuntimeStore(pinia)
    const call = vi
      .spyOn(useIpcStore(pinia), 'call')
      .mockResolvedValue({ success: true, result: undefined })
    await expect(runtime.inspectPackage()).resolves.toBeNull()
    await runtime.restorePackage('example')
    await runtime.removePackage('example')
    expect(call.mock.calls).toEqual([
      ['pick_plugin_package'],
      ['restore_previous_plugin_package', { id: 'example' }],
      ['uninstall_plugin_package', { id: 'example' }],
    ])
    call.mockResolvedValueOnce({ success: false, error: 'Package unavailable' })
    await expect(runtime.restorePackage('example')).rejects.toThrow(
      'Package unavailable'
    )
  } finally {
    disposePinia(pinia)
  }
})
