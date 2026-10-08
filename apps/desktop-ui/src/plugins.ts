import { desktopClient } from './lib/desktop/client'
import { shallowReactive } from 'vue'
import { convertFileSrc } from '@tauri-apps/api/core'
import usePluginContext from './composables/usePluginContext'
import { pluginId } from './lib/plugins/plugin-config'
import { registerPluginResources } from './lib/plugins/plugin-i18n'
import { clientLogger } from './lib/logger'
import { createPluginPackageLoader } from './lib/plugins/plugin-package-loader'
import { removePluginResources } from './lib/plugins/plugin-i18n'
import { createPluginManager } from './lib/plugins/plugin-manager'
import FastNote from '@tyco/plugin-fast-note'
import Diacritics from '@tyco/plugin-diacritics'
import TextCase from '@tyco/plugin-text-case'
import WebFormatter from '@tyco/plugin-web-formatter'
import SearchInInternet from '@tyco/plugin-search-in-internet'
import { useActionMenuStore } from './stores/actionMenu'
import { useEditMenuStore } from './stores/editMenu'
import { useIpcStore } from './stores/ipc'
import { useToolbarStore } from './stores/toolbar'
import { useToolsStore } from './stores/tools'
import type { PluginIndex } from './types/plugins'

const builtinPlugins: PluginIndex[] = [
  ...[SearchInInternet, Diacritics, TextCase, WebFormatter, FastNote].map(
    (factory): PluginIndex =>
      () => {
        const plugin = factory()
        return { ...plugin, name: plugin.id }
      }
  ),
]

export const pluginIndexes = shallowReactive<PluginIndex[]>([...builtinPlugins])
export const builtinPluginIds = builtinPlugins.map((factory) =>
  pluginId(factory())
)
const packageLoader = createPluginPackageLoader({
  importModule: (path) =>
    import(/* @vite-ignore */ convertFileSrc(path, 'tyco-plugin')),
  reportError: (id, error) =>
    clientLogger.error('Plugin package loading failed', error, id),
})
let refreshing: Promise<void> | undefined
let refreshQueued = false

let globalPluginManager: ReturnType<typeof createPluginManager> | null = null

export const usePlugins = () => {
  const { createContext } = usePluginContext()
  const actionMenuStore = useActionMenuStore()
  const editMenuStore = useEditMenuStore()
  const toolbarStore = useToolbarStore()
  const toolsStore = useToolsStore()
  const ipcStore = useIpcStore()

  if (!globalPluginManager) {
    globalPluginManager = createPluginManager({
      pluginIndexes,
      createPluginContext: createContext,
      unregisterPlugin: (id) => {
        actionMenuStore.unregisterPlugin(id)
        editMenuStore.unregisterPlugin(id)
        toolbarStore.unregisterPlugin(id)
        toolsStore.unregisterPlugin(id)
      },
      registerResources: (plugin) =>
        registerPluginResources(pluginId(plugin), plugin),
      reportError: (id, error) =>
        clientLogger.error('Plugin activation failed', error, id),
    })
  }

  const reloadPlugins = (userConfig = ipcStore.params?.userConfig) => {
    return globalPluginManager!.loadPlugins(userConfig)
  }

  const refreshInstalledPlugins = () => {
    if (refreshing) {
      refreshQueued = true
      return refreshing
    }
    refreshing = (async () => {
      if (!desktopClient.isAvailable()) return
      do {
        refreshQueued = false
        const result = await ipcStore.callFunction('listInstalledPlugins', [])
        if (!result.success) return
        const previous = new Set(
          pluginIndexes.map((factory) => pluginId(factory()))
        )
        const installed = await packageLoader.load(
          result.result ?? [],
          builtinPluginIds
        )
        pluginIndexes.splice(
          0,
          pluginIndexes.length,
          ...builtinPlugins,
          ...installed
        )
        for (const factory of pluginIndexes)
          previous.delete(pluginId(factory()))
        await reloadPlugins()
        for (const id of previous) removePluginResources(id)
      } while (refreshQueued)
    })().finally(() => {
      refreshing = undefined
    })
    return refreshing
  }
  return {
    manager: globalPluginManager,
    reloadPlugins,
    refreshInstalledPlugins,
  }
}
