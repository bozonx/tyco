import { defineStore } from 'pinia'

import { useCallAi } from '../composables/useCallAi'
import { translate } from '../lib/i18n'
import { LlmError } from '../lib/llm/llm-client'
import { formatLlmError } from '../lib/llm/llm-errors'
import { createSelectionReplace } from '../lib/selection-replace/selection-replace'
import { useHistoryStore } from './history'
import { useIpcStore } from './ipc'
import {
  type EditorHistoryOperation,
  type SelectionAction,
  type SelectionFinishStatus,
} from '@tyco/shared'

const HISTORY_OPERATIONS: Record<
  SelectionAction['kind'],
  EditorHistoryOperation
> = { correction: 'correction', translate: 'translate', aiTask: 'ai-task' }

function describeError(error: unknown): string {
  if (error instanceof LlmError) return formatLlmError(error, translate)
  return error instanceof Error ? error.message : String(error)
}

/** Replaces the selection in another window; lives in the quick window. */
export const useSelectionReplaceStore = defineStore('selectionReplace', () => {
  const ipcStore = useIpcStore()
  const historyStore = useHistoryStore()
  const { correctText, translateText, aiTasks } = useCallAi()

  const run = async (
    action: SelectionAction,
    text: string,
    signal: AbortSignal
  ): Promise<string> => {
    const userConfig = ipcStore.params.userConfig
    switch (action.kind) {
      case 'correction':
        return correctText(text, { signal, notifyError: false })
      case 'translate':
        if (!userConfig.toTranslateLanguages[action.slot]) {
          throw new Error(translate('selection.missingLanguage'))
        }
        return translateText(action.slot, text, {
          signal,
          notifyError: false,
        }).then((result) => (result ? result.text : ''))
      case 'aiTask':
        if (!userConfig.aiTasks[action.slot]) {
          throw new Error(translate('selection.missingAiTask'))
        }
        return aiTasks(action.slot, text, { signal, notifyError: false })
    }
  }

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
    run,
    finish,
    showOverlay: (request) => {
      void ipcStore.callFunction('showStatusOverlay', [request])
    },
    notify: (summary, body) => {
      void ipcStore.callFunction('notifyDesktop', [summary, body])
    },
    saveResult: async (action, text, result) => {
      try {
        const sourceId = await historyStore.saveSource(
          text,
          HISTORY_OPERATIONS[action.kind]
        )
        await historyStore.saveSourceResult(sourceId, result)
        // pasted over the selection or left in the clipboard: sent either way
        await historyStore.saveOutput(result)
      } catch {
        // the text is already in place; history is a convenience
      }
    },
    applyUserConfig: (userConfig) => ipcStore.setParams({ userConfig }),
    t: (key) => translate(key),
    describeError,
  })

  return model
})
