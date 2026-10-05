import useToast from '../composables/useToast'
import type { CommandRunnerDependencies } from '../lib/commands/command-runner'
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
