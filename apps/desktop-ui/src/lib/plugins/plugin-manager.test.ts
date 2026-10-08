import type { PluginContext } from '@tyco/plugin-sdk'
import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import type { PluginIndex } from '../../types/plugins'
import { createPluginManager, type PluginLifecycle } from './plugin-manager'

function setup(indexes: PluginIndex[]) {
  const contexts = new Map<
    string,
    { config: () => Record<string, unknown>; lifecycle: PluginLifecycle }
  >()
  const deps = {
    pluginIndexes: indexes,
    createPluginContext: vi.fn(
      (
        id: string,
        config: () => Record<string, unknown>,
        lifecycle: PluginLifecycle
      ) => {
        contexts.set(id, { config, lifecycle })
        return {
          signal: lifecycle.signal,
          onDispose: lifecycle.onDispose,
          getMyConfig: config,
        } as PluginContext
      }
    ),
    unregisterPlugin: vi.fn(),
    registerResources: vi.fn(),
    reportError: vi.fn(),
  }
  return { manager: createPluginManager(deps), contexts, deps }
}
const plugin =
  (
    name: string,
    init: ReturnType<PluginIndex>['init'] = vi.fn()
  ): PluginIndex =>
  () => ({
    id: name,
    name,
    version: '1.0.0',
    apiVersion: 2,
    capabilities: [],
    defaultLocale: 'en_US',
    locales: { en_US: {} },
    defaultConfig: {
      fields: [{ name: 'value', type: 'text', defaultValue: 0 }],
    },
    init,
  })

describe('plugin manager', () => {
  it('loads enabled plugins and keeps resources available for disabled ones', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const { manager, deps } = setup([
      plugin('First', first),
      plugin('Second', second),
    ])
    await manager.loadPlugins({ plugins: { Second: { enabled: false } } })
    expect(first).toHaveBeenCalledOnce()
    expect(second).not.toHaveBeenCalled()
    expect(deps.registerResources).toHaveBeenCalledTimes(2)
    expect(manager.getActivePluginNames()).toEqual(['First'])
  })
  it('restarts only the plugin whose effective config changes', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const { manager, contexts } = setup([
      plugin('First', first),
      plugin('Second', second),
    ])
    await manager.loadPlugins({ plugins: { First: { value: 1 } } })
    const previous = contexts.get('First')!.lifecycle.signal
    await manager.loadPlugins({ plugins: { First: { value: 2 } } })
    expect(first).toHaveBeenCalledTimes(2)
    expect(second).toHaveBeenCalledOnce()
    expect(previous.aborted).toBe(true)
    expect(contexts.get('First')!.config()).toEqual({ value: 2 })
  })
  it('reads reactive saved settings with defaults and returns detached copies', async () => {
    const index: PluginIndex = () => ({
      ...plugin('Example')(),
      defaultConfig: {
        fields: [{ name: 'value', type: 'text', defaultValue: 'default' }],
      },
      init: vi.fn(),
    })
    const { manager, contexts } = setup([index])
    const saved = reactive({ plugins: { Example: {} } })
    await manager.loadPlugins(saved)
    const context = contexts.get('Example')!
    const config = context.config()
    config.value = 'mutated'
    expect(context.config()).toEqual({ value: 'default' })
    expect(saved.plugins.Example).toEqual({})
  })
  it('cleans partially registered plugins and continues after an activation failure', async () => {
    const cleanup = vi.fn()
    const next = vi.fn()
    const broken = plugin('Broken', (ctx) => {
      ctx.onDispose(cleanup)
      throw new Error('broken')
    })
    const { manager, deps } = setup([broken, plugin('Next', next)])
    await manager.loadPlugins()
    expect(cleanup).toHaveBeenCalledOnce()
    expect(deps.unregisterPlugin).toHaveBeenCalledWith('Broken')
    expect(deps.reportError).toHaveBeenCalledWith('Broken', expect.any(Error))
    expect(next).toHaveBeenCalledOnce()
    expect(manager.getActivePluginNames()).toEqual(['Next'])
  })
  it('disposes subscriptions and aborts running work on disable', async () => {
    const cleanup = vi.fn()
    const { manager, contexts } = setup([
      plugin('Example', (ctx) => {
        ctx.onDispose(cleanup)
      }),
    ])
    await manager.loadPlugins()
    const signal = contexts.get('Example')!.lifecycle.signal
    await manager.loadPlugins({ plugins: { Example: { enabled: false } } })
    expect(signal.aborted).toBe(true)
    expect(cleanup).toHaveBeenCalledOnce()
    expect(manager.getActivePluginNames()).toEqual([])
  })
  it('does not block shutdown on an unfinished activation and cleans its late result', async () => {
    let finish!: (cleanup: () => void) => void
    const cleanup = vi.fn()
    const activation = new Promise<() => void>((resolve) => {
      finish = resolve
    })
    const { manager, contexts } = setup([plugin('Example', () => activation)])
    const loading = manager.loadPlugins()
    await vi.waitFor(() => expect(contexts.has('Example')).toBe(true))
    await manager.dispose()
    await loading
    finish(cleanup)
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce())
    expect(manager.getActivePluginNames()).toEqual([])
  })
  it('rejects duplicate identities and incompatible APIs without affecting other plugins', async () => {
    const init = vi.fn()
    const { manager, deps } = setup([
      plugin('Duplicate', init),
      plugin('Duplicate', init),
      () => ({ ...plugin('Future', init)(), apiVersion: 99 }),
      plugin('Good'),
    ])
    await manager.loadPlugins()
    expect(init).not.toHaveBeenCalled()
    expect(manager.getActivePluginNames()).toEqual(['Good'])
    expect(deps.reportError).toHaveBeenCalledTimes(2)
  })
  it('reloads an updated package even when its config and version are unchanged', async () => {
    const init = vi.fn()
    let revision = 'first'
    const { manager } = setup([
      () => ({ ...plugin('Example', init)(), _revision: revision }),
    ])
    await manager.loadPlugins()
    revision = 'second'
    await manager.loadPlugins()
    expect(init).toHaveBeenCalledTimes(2)
  })
})
