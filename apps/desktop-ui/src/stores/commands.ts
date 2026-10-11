import { defineStore } from 'pinia'
import { watch } from 'vue'

import { createDefaultCommandsSync } from '../lib/commands/default-commands'
import { translate } from '../lib/i18n'
import { useIpcStore } from './ipc'
import { useToolsStore } from './tools'

/**
 * Adds the default commands of the tools to the library; started in the quick
 * window once the app params are loaded, then again whenever the tools change
 */
export const useDefaultCommandsStore = defineStore('defaultCommands', () => {
  const ipcStore = useIpcStore()
  const toolsStore = useToolsStore()
  let stop: (() => void) | null = null

  const sync = createDefaultCommandsSync({
    tools: () => toolsStore.list(),
    loadUserConfig: async () => {
      const result = await ipcStore.callFunction('getUserConfig', [])
      return result.success ? (result.result ?? null) : null
    },
    saveUserConfig: async (userConfig) =>
      (await ipcStore.saveUserConfig(userConfig)).success,
    t: (key, params) =>
      translate(key, params as Record<string, string | number> | undefined),
  })

  const start = () => {
    if (stop) return
    stop = watch(
      () =>
        toolsStore
          .list()
          .map((tool) => tool.id)
          .join(),
      () => {
        void sync.check()
      },
      { immediate: true }
    )
  }

  return { start, check: sync.check }
})
