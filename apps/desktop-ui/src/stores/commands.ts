import useToast from '../composables/useToast'
import type { CommandRunnerDependencies } from '../lib/commands/command-runner'
import { executeWebhook } from '../lib/custom-actions/webhook-executor'
import { translate } from '../lib/i18n'
import { createTauriFetch } from '../lib/net/tauri-fetch'
import { tauriNetIpc } from '../lib/net/tauri-net'
import { useIpcStore } from './ipc'
import { MenuModals, useMenuModalsStore } from './menuModals'

/**
 * What the commands of the library run with, wherever they are invoked from:
 * the action menu or the command overlay. Call it from a store's setup
 */
export function useCommandRunnerDependencies(): CommandRunnerDependencies {
  const ipcStore = useIpcStore()
  const menuModalsStore = useMenuModalsStore()
  const { toast, toastText } = useToast()

  return {
    showToast: (message, type) => {
      toast(message, type)
    },
    closeWindow: () => {
      void ipcStore.callFunctionOrNotify('closeWindow', [])
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
    executeScriptAction: async (request) => {
      const res = await ipcStore.callFunction('executeScriptAction', [request])
      if (!res.success || !res.result) {
        throw new Error(res.error ?? 'Empty response')
      }
      return res.result
    },
    cancelScriptAction: (runId) =>
      ipcStore.callFunction('cancelScriptAction', [runId]),
    executeWebhook: (target, text, signal) =>
      executeWebhook(
        target,
        text,
        createTauriFetch(tauriNetIpc),
        async (name, type, details) => {
          await ipcStore.callFunction('logCustomAction', [name, type, details])
        },
        signal
      ),
  }
}
