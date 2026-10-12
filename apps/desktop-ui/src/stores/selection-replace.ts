import { defineStore } from 'pinia'

import { translate } from '../lib/i18n/index'
import { describeError } from '../lib/llm/llm-errors'
import { createCommandRunner } from '../lib/commands/command-runner'
import { createSelectionReplace } from '../lib/selection-replace/selection-replace'
import {
  useInvocationRunnerDependencies,
  useInvocationsStore,
} from './invocations'
import { useHistoryStore } from './history'
import { useIpcStore } from './ipc'
import type { SelectionFinishStatus } from '@tyco/shared'
import { createSelectionAction } from '../lib/selection-replace/selection-action'
import { clientLogger } from '../lib/logger'

/** Replaces the selection in another window; lives in the quick window. */
export const useSelectionReplaceStore = defineStore('selectionReplace', () => {
  const ipcStore = useIpcStore()
  const historyStore = useHistoryStore()
  const runner = createCommandRunner(useInvocationRunnerDependencies())
  const invocations = useInvocationsStore()

  const action = createSelectionAction({
    commands: () => ipcStore.params.userConfig.commands,
    correct: (text, signal) =>
      invocations.call('core.correct', text, { signal, source: 'selection' }),
    transform: (command, text, signal) =>
      runner.transform(command, text, { signal, source: 'selection' }),
    logRun: async (record) => {
      const result = await ipcStore.callFunction('logCommandRun', [record])
      if (!result.success) throw new Error(result.error ?? 'Command log failed')
    },
    history: historyStore,
    t: translate,
    reportError: (error) =>
      clientLogger.error('Selection history failed', error),
  })

  const finish = async (
    runId: number,
    text: string | null
  ): Promise<SelectionFinishStatus> => {
    const result = await ipcStore.callFunction('finishSelectionRun', [
      runId,
      text,
    ])
    if (!result.success || !result.result) {
      throw new Error(result.error || 'finishSelectionRun')
    }
    return result.result
  }

  const model = createSelectionReplace({
    run: action.run,
    finish,
    showOverlay: (request) => {
      void ipcStore.callFunction('showStatusOverlay', [request])
    },
    notify: (summary, body) => {
      void ipcStore.callFunction('notifyDesktop', [summary, body])
    },
    saveResult: action.saveResult,
    applyUserConfig: (userConfig) => ipcStore.setExecutionConfig(userConfig),
    t: (key) => translate(key),
    describeError: (error) => describeError(error, translate),
    isAborted: action.isAborted,
  })

  return model
})
