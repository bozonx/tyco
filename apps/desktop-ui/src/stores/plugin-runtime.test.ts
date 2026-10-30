import { createPinia, disposePinia } from 'pinia'
import { describe, expect, it } from 'vitest'

import { FakeDesktopError } from '../test/fake-desktop-backend'
import { installFakeDesktop } from '../test/install-fake-desktop'
import { usePluginRuntimeStore } from './plugin-runtime'

const failure = (message: string) =>
  new FakeDesktopError({ code: 'operationFailed', message })

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
  const desktop = installFakeDesktop()
  try {
    const runtime = usePluginRuntimeStore(desktop.pinia)
    let isUnavailable = false
    desktop.backend.handle('pick_plugin_package', () => null)
    desktop.backend.handle('restore_previous_plugin_package', () => {
      if (isUnavailable) throw failure('Package unavailable')
    })
    desktop.backend.handle('uninstall_plugin_package', () => undefined)
    await expect(runtime.inspectPackage()).resolves.toBeNull()
    await runtime.restorePackage('example')
    await runtime.removePackage('example')
    expect(desktop.backend.calls.map(({ command }) => command)).toEqual([
      'pick_plugin_package',
      'restore_previous_plugin_package',
      'uninstall_plugin_package',
    ])
    expect(desktop.backend.callsOf('uninstall_plugin_package')).toEqual([
      { id: 'example' },
    ])
    isUnavailable = true
    await expect(runtime.restorePackage('example')).rejects.toThrow(
      'Package unavailable'
    )
  } finally {
    disposePinia(desktop.pinia)
    desktop.dispose()
  }
})

it('installs packages by inspection and reports failures', async () => {
  const desktop = installFakeDesktop()
  try {
    const runtime = usePluginRuntimeStore(desktop.pinia)
    desktop.backend.handle('install_plugin_package', () => undefined as never)
    desktop.backend.handle('uninstall_plugin_package', () => {
      throw failure('Plugin is in use')
    })
    await runtime.installPackage({ inspectionId: 'inspection' } as never)
    expect(desktop.backend.callsOf('install_plugin_package')).toEqual([
      { inspectionId: 'inspection' },
    ])
    await expect(runtime.removePackage('example')).rejects.toThrow(
      'Plugin is in use'
    )
  } finally {
    disposePinia(desktop.pinia)
    desktop.dispose()
  }
})

it('loads installed packages only from the desktop', async () => {
  // a browser build: no desktop to ask
  const browser = createPinia()
  try {
    await usePluginRuntimeStore(browser).refreshInstalledPlugins()
  } finally {
    disposePinia(browser)
  }

  const desktop = installFakeDesktop()
  try {
    const runtime = usePluginRuntimeStore(desktop.pinia)
    const builtinCount = runtime.pluginFactories.length
    let isBroken = false
    desktop.backend.handle('list_installed_plugins', () => {
      if (isBroken) throw failure('Catalog is broken')
      return []
    })
    await runtime.refreshInstalledPlugins()
    expect(desktop.backend.callsOf('list_installed_plugins')).toHaveLength(1)
    expect(runtime.pluginFactories.length).toBe(builtinCount)

    isBroken = true
    await expect(runtime.refreshInstalledPlugins()).rejects.toThrow(
      'Catalog is broken'
    )
  } finally {
    disposePinia(desktop.pinia)
    desktop.dispose()
  }
})
