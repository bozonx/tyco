import { clonePluginValue } from '@tyco/plugin-sdk'
import {
  PLUGIN_API_VERSION,
  type PluginCapability,
  type PluginContext,
} from '@tyco/plugin-sdk'

import type { PluginIndex } from '../../types/plugins'
import { getPluginState, pluginId, resolvePluginConfig } from './plugin-config'

export interface PluginLifecycle {
  signal: AbortSignal
  capabilities: readonly PluginCapability[]
  iconPrefix?: string
  onDispose(cleanup: () => void | Promise<void>): void
}
export interface PluginManagerDependencies {
  pluginIndexes: PluginIndex[]
  createPluginContext(
    id: string,
    config: () => Record<string, unknown>,
    lifecycle: PluginLifecycle
  ): PluginContext
  unregisterPlugin(id: string): void
  registerResources?(plugin: ReturnType<PluginIndex>): void
  reportError?(id: string, error: unknown): void
}
interface ActivePlugin {
  signature: string
  initializing: boolean
  controller: AbortController
  cleanups: Array<() => void | Promise<void>>
}

export function createPluginManager(deps: PluginManagerDependencies) {
  const active = new Map<string, ActivePlugin>()
  let revision = 0
  let pending = Promise.resolve()
  let disposed = false
  const report = (id: string, error: unknown) => deps.reportError?.(id, error)
  const isPluginEnabled = (
    id: string,
    userConfig?: { plugins?: Record<string, unknown> }
  ) => {
    const state = userConfig?.plugins?.[id]
    return !(
      state &&
      typeof state === 'object' &&
      'enabled' in state &&
      state.enabled === false
    )
  }
  async function deactivate(id: string) {
    const instance = active.get(id)
    if (!instance) return
    active.delete(id)
    instance.controller.abort()
    deps.unregisterPlugin(id)
    for (const cleanup of instance.cleanups.reverse()) {
      try {
        await cleanup()
      } catch (error) {
        report(id, error)
      }
    }
  }
  function loadPlugins(userConfig?: { plugins?: Record<string, unknown> }) {
    if (disposed) return Promise.resolve()
    for (const instance of active.values())
      if (instance.initializing) instance.controller.abort()
    const requested = ++revision
    const states = clonePluginValue(userConfig?.plugins ?? {})
    pending = pending
      .then(async () => {
        if (requested !== revision || disposed) return
        const definitions = new Map<string, ReturnType<PluginIndex>>()
        const duplicates = new Set<string>()
        for (const factory of deps.pluginIndexes) {
          try {
            const plugin = factory()
            const id = pluginId(plugin)
            if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,127}$/.test(id) || id === 'core')
              throw new Error(`Invalid plugin ID: ${id}`)
            if (definitions.has(id) || duplicates.has(id)) {
              definitions.delete(id)
              duplicates.add(id)
              throw new Error(`Duplicate plugin ID: ${id}`)
            }
            if (
              plugin.apiVersion !== undefined &&
              plugin.apiVersion !== PLUGIN_API_VERSION
            )
              throw new Error(`Unsupported plugin API: ${plugin.apiVersion}`)
            definitions.set(id, plugin)
            deps.registerResources?.(plugin)
          } catch (error) {
            report('manifest', error)
          }
        }
        for (const id of active.keys()) {
          const plugin = definitions.get(id)
          if (
            !plugin ||
            plugin._loadError ||
            getPluginState(plugin, states).enabled === false
          )
            await deactivate(id)
        }
        for (const [id, plugin] of definitions) {
          if (requested !== revision || disposed) return
          try {
            const state = getPluginState(plugin, states)
            if (state.enabled === false || plugin._loadError) continue
            const config = resolvePluginConfig(plugin, state)
            const signature = JSON.stringify([
              plugin.version,
              plugin._revision,
              config,
            ])
            if (active.get(id)?.signature === signature) continue
            await deactivate(id)
            const instance: ActivePlugin = {
              signature,
              initializing: true,
              controller: new AbortController(),
              cleanups: [],
            }
            active.set(id, instance)
            const lifecycle: PluginLifecycle = {
              signal: instance.controller.signal,
              capabilities: plugin.capabilities ?? [],
              iconPrefix: plugin.icons?.prefix,
              onDispose: (cleanup) => {
                if (instance.controller.signal.aborted)
                  throw new Error('Plugin is disposed')
                instance.cleanups.push(cleanup)
              },
            }
            const ctx = deps.createPluginContext(
              id,
              () => clonePluginValue(config),
              lifecycle
            )
            const activation = Promise.resolve(plugin.init(ctx))
            // Late completion cannot resurrect a cancelled activation.
            void activation
              .then(async (cleanup) => {
                if (instance.controller.signal.aborted && cleanup) {
                  try {
                    await cleanup()
                  } catch (error) {
                    report(id, error)
                  }
                }
              })
              .catch(() => {})
            const cleanup = await Promise.race([
              activation,
              new Promise<never>((_, reject) => {
                const abort = () =>
                  reject(new Error('Plugin activation cancelled'))
                if (instance.controller.signal.aborted) abort()
                else
                  instance.controller.signal.addEventListener('abort', abort, {
                    once: true,
                  })
              }),
            ])
            instance.initializing = false
            if (cleanup && !instance.controller.signal.aborted)
              instance.cleanups.push(cleanup)
            if (requested !== revision || disposed) await deactivate(id)
          } catch (error) {
            const cancelled = active.get(id)?.controller.signal.aborted
            await deactivate(id)
            if (!cancelled) report(id, error)
          }
        }
      })
      .catch((error) => report('manager', error))
    return pending
  }
  function dispose() {
    disposed = true
    revision++
    // Abort immediately, including an activation that is still awaiting work.
    for (const instance of active.values()) instance.controller.abort()
    pending = pending.then(async () => {
      for (const id of active.keys()) await deactivate(id)
    })
    return pending
  }
  return {
    isPluginEnabled,
    loadPlugins,
    dispose,
    getActivePluginNames: () =>
      [...active]
        .filter(([, instance]) => !instance.initializing)
        .map(([id]) => id),
  }
}
