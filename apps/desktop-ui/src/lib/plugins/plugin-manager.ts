import type { UserConfig } from '@tyco/shared'

import type { PluginContext, PluginIndex } from '../../types/plugins'

export interface PluginManagerDependencies {
  pluginIndexes: PluginIndex[]
  createPluginContext: (pluginName: string) => PluginContext
  clearActionItems: () => void
  clearEditItems: () => void
  clearToolbarItems: () => void
}

export function createPluginManager(deps: PluginManagerDependencies) {
  let activePluginNames: string[] = []

  const isPluginEnabled = (
    pluginName: string,
    userConfig?: Partial<UserConfig>
  ): boolean => {
    const pluginState = userConfig?.plugins?.[pluginName] as
      { enabled?: boolean } | undefined

    return pluginState?.enabled !== false
  }

  const loadPlugins = (userConfig?: Partial<UserConfig>) => {
    deps.clearActionItems()
    deps.clearEditItems()
    deps.clearToolbarItems()
    activePluginNames = []

    for (const pluginFactory of deps.pluginIndexes) {
      const plugin = pluginFactory()

      if (isPluginEnabled(plugin.name, userConfig)) {
        const ctx = deps.createPluginContext(plugin.name)
        plugin.init(ctx)
        activePluginNames.push(plugin.name)
      }
    }
  }

  const getActivePluginNames = () => [...activePluginNames]

  return { isPluginEnabled, loadPlugins, getActivePluginNames }
}
