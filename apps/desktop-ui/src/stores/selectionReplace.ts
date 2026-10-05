import { defineStore } from 'pinia'

import { useCallAi } from '../composables/useCallAi'
import { translate } from '../lib/i18n'
import { LlmError } from '../lib/llm/llm-client'
import { formatLlmError } from '../lib/llm/llm-errors'
import { commandLabel, normalizeCommands } from '../lib/commands/command-config'
import { createCommandRunner } from '../lib/commands/command-runner'
import { createSelectionReplace } from '../lib/selection-replace/selection-replace'
import type { ToolResult } from '../lib/tools/tool-types'
import { useCommandRunnerDependencies } from './commands'
import { useHistoryStore } from './history'
import { useIpcStore } from './ipc'
import {
  type CommandRunRecord,
  type EditorHistoryOperation,
  type SelectionAction,
  type SelectionFinishStatus,
} from '@tyco/shared'

const HISTORY_OPERATIONS: Partial<
  Record<SelectionAction['kind'], EditorHistoryOperation>
> = { correction: 'correction', translate: 'translate', aiTask: 'ai-task' }

/** A command run cancelled from within its tool */
class SelectionAbort extends Error {}

/** The text of a failed tool result, translated */
function resultMessage(result: ToolResult): string {
  const key = result.messageKey ? translate(result.messageKey) : ''
  if (key && result.message) return `${key}: ${result.message}`
  return key || result.message || ''
}

function describeError(error: unknown): string {
  if (error instanceof LlmError) return formatLlmError(error, translate)
  return error instanceof Error ? error.message : String(error)
}

/** Replaces the selection in another window; lives in the quick window. */
export const useSelectionReplaceStore = defineStore('selectionReplace', () => {
  const ipcStore = useIpcStore()
  const historyStore = useHistoryStore()
  const { correctText, translateText, aiTasks } = useCallAi()
  const runner = createCommandRunner(useCommandRunnerDependencies())

  /** Runs a command of the library for the output that replaces the text */
  const runCommand = async (
    commandId: string,
    text: string,
    signal: AbortSignal
  ): Promise<string> => {
    const command = normalizeCommands(ipcStore.params.userConfig.commands).find(
      (item) => item.id === commandId
    )
    if (!command) {
      throw new Error(
        translate('commandLauncher.commandMissing', { id: commandId })
      )
    }
    const result = await runner.transform(command, text, {
      signal,
      source: 'selection',
    })
    const record: CommandRunRecord = {
      commandId: command.id,
      name: commandLabel(command),
      source: 'selection',
      text,
      success: result.ok,
    }
    const message = resultMessage(result)
    if (message) record.message = message
    void ipcStore.callFunction('logCommandRun', [record])
    if (result.cancelled) throw new SelectionAbort()
    if (!result.ok) throw new Error(message || translate('toast.commandFailed'))
    return result.content ?? ''
  }

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
      case 'command':
        return runCommand(action.commandId, text, signal)
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
        const operation = HISTORY_OPERATIONS[action.kind]
        if (operation) {
          const sourceId = await historyStore.saveSource(text, operation)
          await historyStore.saveSourceResult(sourceId, result)
        } else {
          // a command: its text left the app as well
          await historyStore.saveOutput(text)
        }
        // pasted over the selection or left in the clipboard: sent either way
        await historyStore.saveOutput(result)
      } catch {
        // the text is already in place; history is a convenience
      }
    },
    applyUserConfig: (userConfig) => ipcStore.setParams({ userConfig }),
    t: (key) => translate(key),
    describeError,
    isAborted: (error) => error instanceof SelectionAbort,
  })

  return model
})
