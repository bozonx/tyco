import { defineStore } from 'pinia'
import { onScopeDispose, watch } from 'vue'

import { createDefaultCommandsSync } from '../lib/commands/default-commands'
import { translate } from '../lib/i18n'
import { clientLogger } from '../lib/logger'
import { useDesktopStore } from './desktop'
import { useIpcStore } from './ipc'
import { useToolsStore } from './tools'

/**
 * Adds the default commands of the tools to the library; started in the quick
 * window once the app params are loaded, then again whenever the tools change
 */
export const useDefaultCommandsStore = defineStore('defaultCommands', () => {
  const ipcStore = useIpcStore()
  const desktopStore = useDesktopStore()
  const toolsStore = useToolsStore()
  let stop: (() => void) | null = null
  let disposed = false

  const sync = createDefaultCommandsSync({
    tools: () => toolsStore.list(),
    loadUserConfig: async () => {
      const result = await ipcStore.callFunction('getUserConfig', [])
      if (!result.success) throw new Error(result.error ?? 'Config load failed')
      return result.result ?? null
    },
    saveUserConfig: async (userConfig, baseConfig) => {
      const result = await desktopStore.saveUserConfig(userConfig, baseConfig)
      if (!result.success) throw new Error(result.error ?? 'Config save failed')
      return true
    },
    reportError: (error) =>
      clientLogger.error('Default command sync failed', error),
    t: (key, params) =>
      translate(key, params as Record<string, string | number> | undefined),
  })

  const start = () => {
    if (disposed || stop) return
    stop = watch(
      () => toolsStore.tools,
      () => {
        void sync.check()
      },
      { immediate: true }
    )
  }

  const dispose = () => {
    disposed = true
    sync.dispose()
    stop?.()
    stop = null
  }
  onScopeDispose(dispose)

  return { start, dispose }
})
