import { markRaw, shallowReactive } from 'vue'
import type { UserConfig } from '@tyco/shared'

import type { PluginFactory } from '../../types/plugins'
import {
  createPluginManager,
  type PluginManagerDependencies,
  type PluginRuntimeState,
} from './plugin-manager'
import { pluginId } from './plugin-config'

export interface PluginRuntimeDependencies extends Omit<
  PluginManagerDependencies,
  'pluginFactories' | 'onStateChange'
> {
  builtinPlugins: readonly PluginFactory[]
  getConfig: () => UserConfig
  loadInstalled: () => Promise<PluginFactory[]>
  removeResources: (id: string) => void
}

/** Owns the catalog, manager, and refresh queue for one application instance. */
export function createPluginRuntime(deps: PluginRuntimeDependencies) {
  const pluginFactories = shallowReactive<PluginFactory[]>([
    ...deps.builtinPlugins,
  ])
  const pluginRuntimeStates = shallowReactive<
    Record<string, PluginRuntimeState>
  >({})
  let disposed = false
  let refreshing: Promise<void> | undefined
  let refreshQueued = false
  let disposal: Promise<void> | undefined
  const manager = markRaw(
    createPluginManager({
      ...deps,
      pluginFactories,
      onStateChange: (id, state) => {
        if (!disposed) pluginRuntimeStates[id] = state
      },
    })
  )
  const reloadPlugins = (config = deps.getConfig()) =>
    disposed ? Promise.resolve() : manager.loadPlugins(config)

  const refreshInstalledPlugins = (): Promise<void> => {
    if (disposed) return Promise.resolve()
    if (refreshing) {
      refreshQueued = true
      return refreshing
    }
    refreshing = (async () => {
      do {
        refreshQueued = false
        const installed = await deps.loadInstalled()
        if (disposed) return
        const removed = new Set(
          pluginFactories.map((factory) => pluginId(factory()))
        )
        pluginFactories.splice(
          0,
          pluginFactories.length,
          ...deps.builtinPlugins,
          ...installed
        )
        for (const factory of pluginFactories)
          removed.delete(pluginId(factory()))
        await reloadPlugins()
        if (disposed) return
        for (const id of removed) {
          deps.removeResources(id)
          delete pluginRuntimeStates[id]
        }
      } while (refreshQueued && !disposed)
    })().finally(() => {
      refreshing = undefined
    })
    return refreshing
  }
  const dispose = () => {
    disposed = true
    refreshQueued = false
    disposal ??= manager.dispose()
    return disposal
  }
  return {
    pluginFactories,
    pluginRuntimeStates,
    manager,
    reloadPlugins,
    refreshInstalledPlugins,
    dispose,
  }
}
