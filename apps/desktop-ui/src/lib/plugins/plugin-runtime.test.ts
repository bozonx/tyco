import { SUPPORTED_PLUGIN_LOCALES } from '@tyco/plugin-sdk'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_USER_CONFIG } from '@tyco/shared'

import type { PluginFactory } from '../../types/plugins'
import {
  createPluginRuntime,
  type PluginRuntimeDependencies,
} from './plugin-runtime'

const index =
  (id: string): PluginFactory =>
  () => ({
    id,
    name: id,
    version: '1.0.0',
    apiVersion: 2,
    capabilities: [],
    defaultLocale: 'en-US',
    locales: Object.fromEntries(SUPPORTED_PLUGIN_LOCALES.map((locale) => [locale, {}])),
    init: () => {},
  })
function setup(extra: Partial<PluginRuntimeDependencies> = {}) {
  const deps: PluginRuntimeDependencies = {
    builtinPlugins: [index('Builtin')],
    getConfig: () => DEFAULT_USER_CONFIG,
    loadInstalled: vi.fn(async () => [index('Installed')]),
    createPluginContext: vi.fn(),
    unregisterPlugin: vi.fn(),
    removeResources: vi.fn(),
    ...extra,
  }
  return { deps, runtime: createPluginRuntime(deps) }
}

describe('application plugin runtime', () => {
  it('deactivates development plugins and restores them without changing their configuration', async () => {
    const config = structuredClone(DEFAULT_USER_CONFIG)
    config.isInDevelopment = true
    config.plugins.FastNote = { isEnabled: true, settings: {} }
    const init = vi.fn()
    const { runtime, deps } = setup({
      builtinPlugins: [() => ({ ...index('FastNote')(), init })],
      getConfig: () => config,
    })
    try {
      await runtime.reloadPlugins()
      expect(init).toHaveBeenCalledOnce()
      delete config.isInDevelopment
      await runtime.reloadPlugins()
      expect(deps.unregisterPlugin).toHaveBeenCalledWith('FastNote')
      expect(runtime.pluginRuntimeStates.FastNote.status).toBe('disabled')
      expect(config.plugins.FastNote.isEnabled).toBe(true)
      config.isInDevelopment = true
      await runtime.reloadPlugins()
      expect(init).toHaveBeenCalledTimes(2)
    } finally {
      await runtime.dispose()
    }
  })

  it('isolates catalogs and managers between application instances', async () => {
    const first = setup()
    const second = setup()
    try {
      await first.runtime.refreshInstalledPlugins()
      expect(
        first.runtime.pluginFactories.map((factory) => factory().id)
      ).toEqual(['Builtin', 'Installed'])
      expect(
        second.runtime.pluginFactories.map((factory) => factory().id)
      ).toEqual(['Builtin'])
      expect(first.runtime.manager).not.toBe(second.runtime.manager)
      await first.runtime.dispose()
      await second.runtime.refreshInstalledPlugins()
      expect(second.runtime.pluginFactories).toHaveLength(2)
    } finally {
      await first.runtime.dispose()
      await second.runtime.dispose()
    }
  })

  it('coalesces refreshes and removes vanished plugin state', async () => {
    const { runtime, deps } = setup()
    const load = vi.mocked(deps.loadInstalled)
    await runtime.refreshInstalledPlugins()
    load.mockResolvedValue([])
    const first = runtime.refreshInstalledPlugins()
    const second = runtime.refreshInstalledPlugins()
    expect(second).toBe(first)
    await first
    expect(load).toHaveBeenCalledTimes(3)
    expect(deps.removeResources).toHaveBeenCalledExactlyOnceWith('Installed')
    expect(runtime.pluginRuntimeStates.Installed).toBeUndefined()
    await runtime.dispose()
  })

  it('ignores refresh completion after disposal and stays stopped', async () => {
    let resolve!: (indexes: PluginFactory[]) => void
    const { runtime, deps } = setup({
      loadInstalled: vi.fn(
        () =>
          new Promise<PluginFactory[]>((done) => {
            resolve = done
          })
      ),
    })
    const pending = runtime.refreshInstalledPlugins()
    const firstDisposal = runtime.dispose()
    expect(runtime.dispose()).toBe(firstDisposal)
    resolve([index('Late')])
    await pending
    await firstDisposal
    await runtime.refreshInstalledPlugins()
    expect(runtime.pluginFactories).toHaveLength(1)
    expect(deps.loadInstalled).toHaveBeenCalledOnce()
    expect(runtime.pluginRuntimeStates).toEqual({})
  })
})
