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
    claimJob: async (id) => {
      const result = await ipcStore.callFunction('claimExternalJob', [id])
      return result.success && result.result === true
    },
    finishJob: async (id, completion) => {
      const result = await ipcStore.callFunction('finishExternalJob', [
        id,
        completion,
      ])
      if (!result.success) return { success: false, message: result.error }
      const job = result.result
      if (!job) return completion
      return {
        success: job.state === 'succeeded',
        cancelled: job.state === 'cancelled',
        output: job.output,
        message: job.error,
        code: job.code,
      }
    },
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
        closeWindow: undefined,
        showResultMenu: undefined,
      }).run(command, text, { ...options, source: 'external' }),
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
