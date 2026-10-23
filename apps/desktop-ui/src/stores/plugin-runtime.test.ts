import { useIpcStore } from './ipc'
import { createPinia, disposePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'

import { desktopClient } from '../lib/desktop/client'
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

it('installs packages by inspection and reports failures with a default message', async () => {
  const pinia = createPinia()
  try {
    const runtime = usePluginRuntimeStore(pinia)
    const call = vi
      .spyOn(useIpcStore(pinia), 'call')
      .mockResolvedValue({ success: true, result: undefined })
    await runtime.installPackage({ inspectionId: 'inspection' } as never)
    expect(call).toHaveBeenCalledWith('install_plugin_package', {
      inspectionId: 'inspection',
    })
    call.mockResolvedValueOnce({ success: false } as never)
    await expect(runtime.removePackage('example')).rejects.toThrow(
      'Plugin operation failed'
    )
  } finally {
    disposePinia(pinia)
  }
})

it('loads installed packages only from the desktop', async () => {
  const pinia = createPinia()
  try {
    const runtime = usePluginRuntimeStore(pinia)
    const call = vi
      .spyOn(useIpcStore(pinia), 'call')
      .mockResolvedValue({ success: true, result: [] })
    const builtinCount = runtime.pluginFactories.length

    vi.spyOn(desktopClient, 'isAvailable').mockReturnValue(false)
    await runtime.refreshInstalledPlugins()
    expect(call).not.toHaveBeenCalled()

    vi.mocked(desktopClient.isAvailable).mockReturnValue(true)
    await runtime.refreshInstalledPlugins()
    expect(call).toHaveBeenCalledWith('list_installed_plugins')
    expect(runtime.pluginFactories.length).toBe(builtinCount)

    call.mockResolvedValueOnce({ success: false } as never)
    await expect(runtime.refreshInstalledPlugins()).rejects.toThrow(
      'Plugin catalog load failed'
    )
  } finally {
    disposePinia(pinia)
  }
})
