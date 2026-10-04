import { defineStore } from 'pinia'

import { createCommandRunner } from '../lib/commands/command-runner'
import { createExternalRun } from '../lib/commands/external-run'
import { translate } from '../lib/i18n'
import { useCommandRunnerDependencies } from './commands'
import { useHistoryStore } from './history'
import { useIpcStore } from './ipc'

/**
 * Runs the commands of external calls in the background; lives in the quick
 * window, which always exists, shown or not
 */
export const useExternalCommandsStore = defineStore('externalCommands', () => {
  const ipcStore = useIpcStore()
  const historyStore = useHistoryStore()
  const runnerDeps = useCommandRunnerDependencies()

  return createExternalRun({
    run: (command, text, report) =>
      createCommandRunner({
        ...runnerDeps,
        showToast: (messageKey, type = 'info') => {
          report(type, translate(messageKey))
        },
        showError: (messageKey, detail) => {
          report(
            'error',
            detail
              ? `${translate(messageKey)}: ${detail}`
              : translate(messageKey)
          )
        },
        // no window is shown, so there is nothing to close or show a menu in
        closeWindow: undefined,
        showResultMenu: undefined,
      }).run(command, text),
    showOverlay: (request) => {
      void ipcStore.callFunction('showStatusOverlay', [request])
    },
    notify: (summary, body) => {
      void ipcStore.callFunction('notifyDesktop', [summary, body])
    },
    applyUserConfig: (userConfig) => ipcStore.setParams({ userConfig }),
    logRun: async (record) => {
      await ipcStore.callFunction('logCommandRun', [record])
    },
    saveOutput: async (text) => {
      await historyStore.saveOutput(text)
    },
    t: (key, params) => translate(key, params),
  })
})
