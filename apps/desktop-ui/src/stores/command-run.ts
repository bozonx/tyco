import { defineStore } from 'pinia'
import { onScopeDispose, watch } from 'vue'

import type { CommandRunRejectedEvent } from '@tyco/shared'

import { createCommandRunner } from '../lib/commands/command-runner'
import { createCommandRunSession } from '../lib/commands/command-run-session'
import { commandTakesText } from '../lib/commands/command-runtime'
import { createExternalJobAdapter } from '../lib/commands/external-job-adapter'
import { translate } from '../lib/i18n/index'
import { resultOrThrow } from '../lib/ipc/ipc-model'
import { clientLogger } from '../lib/logger'
import { useDesktopStore } from './desktop'
import { useInvocationRunnerDependencies } from './invocations'
import { useIpcStore } from './ipc'
import { useOperationsStore } from './operations'
import { useToastStore } from './toast'
import { useVisibleWorkStore } from './visible-work'

/**
 * The run of a library command in the command overlay of the quick window,
 * whoever started it: an external call, a hotkey or the action menu
 */
export const useCommandRunStore = defineStore('commandRun', () => {
  const ipcStore = useIpcStore()
  const desktopStore = useDesktopStore()
  const operationsStore = useOperationsStore()
  const { toastKey } = useToastStore()
  const runnerDeps = useInvocationRunnerDependencies()
  const reportError = (error: unknown) =>
    clientLogger.error('Command run failed', error, 'command-run')

  const jobs = createExternalJobAdapter({ call: ipcStore.call, reportError })
  const session = createCommandRunSession({
    claim: jobs.claimJob,
    answerAccess: async (jobId, decision) => {
      resultOrThrow(
        await ipcStore.call('answer_external_access', { jobId, decision })
      )
    },
    finish: jobs.finishJob,
    supplyInput: async (id, text) => {
      resultOrThrow(
        await ipcStore.call('supply_command_run_input', { id, text })
      )
    },
    cancelJob: async (id) => {
      resultOrThrow(await ipcStore.call('cancel_external_job', { id }))
    },
    run: (command, text, hooks, options) =>
      createCommandRunner({
        ...runnerDeps,
        showToast: (messageKey, type = 'info') =>
          hooks.report(type, translate(messageKey)),
        showText: (message, type = 'info') => hooks.report(type, message),
        showError: (messageKey, detail) =>
          hooks.report(
            'error',
            detail
              ? `${translate(messageKey)}: ${detail}`
              : translate(messageKey)
          ),
        // the overlay shows the result in place of the action menu
        showResultMenu: (output, sourceText) =>
          hooks.showResult(output, sourceText),
      }).run(command, text, options),
    takesText: (command) => commandTakesText(command, operationsStore),
    hide: () => {
      void ipcStore.callOrNotify('hide_window')
    },
    applyUserConfig: (userConfig) =>
      desktopStore.setExecutionConfig(userConfig),
    logRun: async (record) => {
      resultOrThrow(await ipcStore.call('log_command_run', { record }))
    },
    reportError,
    t: (key, params) => translate(key, params),
  })

  // a new `commandRun` activation shows its run; leaving it ends the run
  watch(
    () =>
      [
        desktopStore.desktopState.activationId,
        desktopStore.desktopState.mode,
        desktopStore.desktopState.isWindowShown,
        desktopStore.desktopState.commandRun,
      ] as const,
    ([, mode, isShown, request]) => {
      if (mode === 'commandRun' && isShown && request) {
        void session.open(request)
      } else if (session.isActive()) {
        void session.leave()
      }
    },
    { immediate: true }
  )

  const unregister = useVisibleWorkStore().register(session.leave)
  onScopeDispose(() => {
    unregister()
    session.dispose()
  })

  /** Another command runs: the refused one is told in its overlay */
  const reject = (event: CommandRunRejectedEvent) => {
    toastKey('commandRun.rejected', 'warn', {
      name: event.commandName,
      running: event.runningCommandName,
    })
  }

  /** Starts a command of a hotkey or the action menu in the overlay */
  const start = async (commandId: string, text: string | null) => {
    const result = await ipcStore.call('start_command_run', { commandId, text })
    // a refused run is told by `reject`; anything else is told here
    if (!result.success && result.errorCode !== 'busy')
      toastKey('commandRun.startFailed', 'error')
    return result.success
  }

  return {
    state: session.state,
    respondAccess: session.respondAccess,
    submitText: session.submitText,
    cancel: session.cancel,
    handleJobCancelled: session.handleJobCancelled,
    isActive: session.isActive,
    reject,
    start,
  }
})
