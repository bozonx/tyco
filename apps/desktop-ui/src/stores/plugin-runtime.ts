import { defineStore } from 'pinia'
import { onScopeDispose } from 'vue'

import { desktopClient } from '../lib/desktop/client'
import usePluginContext from '../composables/use-plugin-context'
import { activatePluginSandbox } from '../lib/plugins/plugin-sandbox'
import {
  builtinPlugins,
  builtinPluginIds,
} from '../lib/plugins/builtin-plugins'
import { createPluginPackageLoader } from '../lib/plugins/plugin-package-loader'
import { createPluginRuntime } from '../lib/plugins/plugin-runtime'
import {
  registerPluginResources,
  removePluginResources,
} from '../lib/plugins/plugin-i18n'
import { pluginId } from '../lib/plugins/plugin-config'
import { clientLogger } from '../lib/logger'
import { useActionMenuStore } from './action-menu'
import { useEditMenuStore } from './edit-menu'
import { useToolbarStore } from './toolbar'
import { useToolsStore } from './tools'
import { useDesktopStore } from './desktop'
import { useIpcStore } from './ipc'

export const usePluginRuntimeStore = defineStore('pluginRuntime', () => {
  const { createContext } = usePluginContext()
  const actions = useActionMenuStore()
  const edits = useEditMenuStore()
  const toolbar = useToolbarStore()
  const tools = useToolsStore()
  const ipc = useIpcStore()
  const desktopStore = useDesktopStore()
  const loader = createPluginPackageLoader({
    activate: (manifest, path, ctx) =>
      activatePluginSandbox(manifest, path, ctx, (error) => {
        void model.manager.failPlugin(manifest.id, error)
      }),
    reportError: (id, error) =>
      clientLogger.error('Plugin package loading failed', error, id),
  })
  const model = createPluginRuntime({
    builtinPlugins,
    getConfig: () => desktopStore.userConfig,
    loadInstalled: async () => {
      if (!desktopClient.isAvailable()) return []
      const result = await ipc.call('list_installed_plugins')
      if (!result.success)
        throw new Error(result.error ?? 'Plugin catalog load failed')
      return loader.load(result.result ?? [], builtinPluginIds)
    },
    createPluginContext: createContext,
    unregisterPlugin: (id) => {
      actions.unregisterPlugin(id)
      edits.unregisterPlugin(id)
      toolbar.unregisterPlugin(id)
      tools.unregisterPlugin(id)
    },
    registerResources: (plugin) =>
      registerPluginResources(pluginId(plugin), plugin),
    removeResources: removePluginResources,
    reportError: (id, error) =>
      clientLogger.error('Plugin activation failed', error, id),
  })
  onScopeDispose(() => {
    void model.dispose()
  })
  return model
})
