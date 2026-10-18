import { createExternalJobAdapter } from '../lib/commands/external-job-adapter'
import { defineStore } from 'pinia'
import { onScopeDispose } from 'vue'

import { createCommandRunner } from '../lib/commands/command-runner'
import { createExternalRun } from '../lib/commands/external-run'
import { translate } from '../lib/i18n/index'
import { useInvocationRunnerDependencies } from './invocations'
import { useHistoryStore } from './history'
import { useDesktopStore } from './desktop'
import { useIpcStore } from './ipc'

/**
 * Runs the commands of external calls in the background; lives in the quick
 * window, which always exists, shown or not
 */
export const useExternalCommandsStore = defineStore('externalCommands', () => {
  const ipcStore = useIpcStore()
  const desktopStore = useDesktopStore()
  const historyStore = useHistoryStore()
  const runnerDeps = useInvocationRunnerDependencies()

  const model = createExternalRun({
    ...createExternalJobAdapter({ callFunction: ipcStore.callFunction }),
    run: (command, text, report, options) =>
      createCommandRunner({
        ...runnerDeps,
        showToast: (messageKey, type = 'info') => {
          report(type, translate(messageKey))
        },
        showText: (text, type = 'info') => {
          report(type, text)
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
        hideWindow: undefined,
        showResultMenu: undefined,
      }).run(command, text, { ...options, source: 'external' }),
    showOverlay: (request) => {
      void ipcStore.callFunction('showStatusOverlay', [request])
    },
    notify: (summary, body) => {
      void ipcStore.callFunction('notifyDesktop', [summary, body])
    },
    applyUserConfig: (userConfig) =>
      desktopStore.setExecutionConfig(userConfig),
    logRun: async (record) => {
      await ipcStore.callFunction('logCommandRun', [record])
    },
    saveOutput: async (text) => {
      await historyStore.saveOutput(text)
    },
    t: (key, params) => translate(key, params),
  })
  onScopeDispose(model.dispose)
  return model
})
