import usePluginContext from './composables/usePluginContext'
import { createPluginManager } from './lib/plugins/plugin-manager'
import FastNote from './plugins/FastNote'
import RussianStress from './plugins/RussianStress'
import SearchInInternet from './plugins/SearchInInternet'
import { useActionMenuStore } from './stores/actionMenu'
import { useEditMenuStore } from './stores/editMenu'
import { useIpcStore } from './stores/ipc'
import { useToolbarStore } from './stores/toolbar'
import type { PluginIndex } from './types/plugins'

export const pluginIndexes: PluginIndex[] = [
  SearchInInternet,
  RussianStress,
  FastNote,
]

let globalPluginManager: ReturnType<typeof createPluginManager> | null = null

export const usePlugins = () => {
  const { createContext } = usePluginContext()
  const actionMenuStore = useActionMenuStore()
  const editMenuStore = useEditMenuStore()
  const toolbarStore = useToolbarStore()
  const ipcStore = useIpcStore()

  if (!globalPluginManager) {
    globalPluginManager = createPluginManager({
      pluginIndexes,
      createPluginContext: createContext,
      clearActionItems: () => actionMenuStore.clearRegisteredActions(),
      clearEditItems: () => editMenuStore.clearRegisteredItems(),
      clearToolbarItems: () => toolbarStore.clearToolbarItems(),
    })
  }

  const reloadPlugins = (userConfig = ipcStore.params?.userConfig) => {
    globalPluginManager?.loadPlugins(userConfig)
  }

  return { manager: globalPluginManager, reloadPlugins }
}
