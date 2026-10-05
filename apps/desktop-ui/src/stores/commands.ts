import { defineStore } from 'pinia'
import { watch } from 'vue'

import useToast from '../composables/useToast'
import type { CommandRunnerDependencies } from '../lib/commands/command-runner'
import { createDefaultCommandsSync } from '../lib/commands/default-commands'
import { translate } from '../lib/i18n'
import { useIpcStore } from './ipc'
import { MenuModals, useMenuModalsStore } from './menuModals'
import { useToolsStore } from './tools'

/**
 * What the commands of the library run with, wherever they are invoked from:
 * the action menu or the command overlay. Call it from a store's setup
 */
export function useCommandRunnerDependencies(): CommandRunnerDependencies {
  const ipcStore = useIpcStore()
  const menuModalsStore = useMenuModalsStore()
  const toolsStore = useToolsStore()
  const { toast, toastText } = useToast()

  return {
    tools: toolsStore,
    showToast: (message, type) => {
      toast(message, type)
    },
    showText: (text, type) => {
      toastText(text, type)
    },
    closeWindow: () => {
      void ipcStore.callFunctionOrNotify('closeWindow', [])
    },
    copyText: async (text) => {
      const result = await ipcStore.callFunction('copyText', [text])
      if (!result.success) throw new Error(result.error ?? 'copyText')
    },
    showError: (messageKey, detail) => {
      toastText(
        detail ? `${translate(messageKey)}: ${detail}` : translate(messageKey),
        'error'
      )
    },
    showResultMenu: (text, sourceText) => {
      menuModalsStore.nextModal(MenuModals.PREVIEW, { text, sourceText })
    },
  }
}

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
