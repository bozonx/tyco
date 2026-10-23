import type { PluginContext } from '@tyco/plugin-sdk'
import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import type { PluginFactory } from '../../types/plugins'
import { createPluginManager, type PluginLifecycle } from './plugin-manager'

function setup(indexes: PluginFactory[]) {
  const contexts = new Map<
    string,
    { config: () => Record<string, unknown>; lifecycle: PluginLifecycle }
  >()
  const deps = {
    pluginFactories: indexes,
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
    init: ReturnType<PluginFactory>['init'] = vi.fn()
  ): PluginFactory =>
  () => ({
    id: name,
    name,
    version: '1.0.0',
    apiVersion: 2,
    capabilities: [],
    defaultLocale: 'en-US',
    locales: { 'en-US': {}, 'ru-RU': {}, 'es-AR': {}, 'tr-TR': {} },
    defaultConfig: {
      fields: [{ name: 'value', type: 'text', defaultValue: 0 }],
    },
    init,
  })

describe('plugin manager', () => {
  it('does not activate plugins without explicit enablement', async () => {
    const init = vi.fn()
    const { manager } = setup([plugin('Example', init)])
    await manager.loadPlugins()
    await manager.loadPlugins({ plugins: { Example: { value: 1 } } })
    expect(init).not.toHaveBeenCalled()
    expect(manager.getActivePluginNames()).toEqual([])
  })
  it('loads enabled plugins and keeps resources available for disabled ones', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const { manager, deps } = setup([
      plugin('First', first),
      plugin('Second', second),
    ])
    await manager.loadPlugins({
      plugins: {
        First: { isEnabled: true, settings: {} },
        Second: { isEnabled: false, settings: {} },
      },
    })
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
    await manager.loadPlugins({
      plugins: {
        First: { isEnabled: true, settings: { value: 1 } },
        Second: { isEnabled: true, settings: {} },
      },
    })
    const previous = contexts.get('First')!.lifecycle.signal
    await manager.loadPlugins({
      plugins: {
        First: { isEnabled: true, settings: { value: 2 } },
        Second: { isEnabled: true, settings: {} },
      },
    })
    expect(first).toHaveBeenCalledTimes(2)
    expect(second).toHaveBeenCalledOnce()
    expect(previous.aborted).toBe(true)
    expect(contexts.get('First')!.config()).toEqual({ value: 2 })
  })
  it('reads reactive saved settings with defaults and returns detached copies', async () => {
    const index: PluginFactory = () => ({
      ...plugin('Example')(),
      defaultConfig: {
        fields: [{ name: 'value', type: 'text', defaultValue: 'default' }],
      },
      init: vi.fn(),
    })
    const { manager, contexts } = setup([index])
    const saved = reactive({
      plugins: { Example: { isEnabled: true, settings: {} } },
    })
    await manager.loadPlugins(saved)
    const context = contexts.get('Example')!
    const config = context.config()
    config.value = 'mutated'
    expect(context.config()).toEqual({ value: 'default' })
    expect(saved.plugins.Example).toEqual({ isEnabled: true, settings: {} })
  })
  it('cleans partially registered plugins and continues after an activation failure', async () => {
    const cleanup = vi.fn()
    const next = vi.fn()
    const broken = plugin('Broken', (ctx) => {
      ctx.onDispose(cleanup)
      throw new Error('broken')
    })
    const { manager, deps } = setup([broken, plugin('Next', next)])
    await manager.loadPlugins({
      plugins: {
        Broken: { isEnabled: true, settings: {} },
        Next: { isEnabled: true, settings: {} },
      },
    })
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
    await manager.loadPlugins({
      plugins: { Example: { isEnabled: true, settings: {} } },
    })
    const signal = contexts.get('Example')!.lifecycle.signal
    await manager.loadPlugins({
      plugins: { Example: { isEnabled: false, settings: {} } },
    })
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
    const loading = manager.loadPlugins({
      plugins: { Example: { isEnabled: true, settings: {} } },
    })
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
    await manager.loadPlugins({
      plugins: { Good: { isEnabled: true, settings: {} } },
    })
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
    await manager.loadPlugins({
      plugins: { Example: { isEnabled: true, settings: {} } },
    })
    revision = 'second'
    await manager.loadPlugins({
      plugins: { Example: { isEnabled: true, settings: {} } },
    })
    expect(init).toHaveBeenCalledTimes(2)
  })
})

it('continues reverse cleanup after a handler never settles', async () => {
  const completed = vi.fn()
  const reportError = vi.fn()
  const manager = createPluginManager({
    cleanupTimeoutMs: 5,
    pluginFactories: [
      plugin('Example', (ctx) => {
        ctx.onDispose(completed)
        ctx.onDispose(() => new Promise(() => {}))
      }),
    ],
    createPluginContext: (_id, _config, lifecycle) =>
      ({ onDispose: lifecycle.onDispose }) as PluginContext,
    unregisterPlugin: vi.fn(),
    reportError,
  })
  await manager.loadPlugins({ plugins: { Example: { isEnabled: true } } })
  await manager.dispose()
  expect(completed).toHaveBeenCalledOnce()
  expect(reportError).toHaveBeenCalledWith(
    'Example',
    expect.objectContaining({ message: 'Plugin cleanup timed out' })
  )
})
