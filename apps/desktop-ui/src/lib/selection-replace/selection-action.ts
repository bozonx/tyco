import type {
  CommandConfig,
  CommandRunRecord,
  SelectionAction,
} from '@tyco/shared'

import { normalizeCommands } from '../commands/command-config'
import { commandRunRecord, logCommandRun } from '../commands/command-run-record'
import type { createHistoryModel } from '../history/history-model'
import { toolResultMessage } from '../invocation/invocation-result'
import type { ToolResult } from '../tools/tool-types'

export class SelectionActionAbortedError extends Error {}

export interface SelectionActionDependencies {
  commands: () => unknown
  correct: (text: string, signal: AbortSignal) => Promise<ToolResult>
  transform: (
    command: CommandConfig,
    text: string,
    signal: AbortSignal
  ) => Promise<ToolResult>
  logRun: (record: CommandRunRecord) => Promise<void>
  history: Pick<
    ReturnType<typeof createHistoryModel>,
    'saveSource' | 'saveSourceResult' | 'saveOutput'
  >
  t: (key: string, params?: Record<string, string>) => string
  reportError: (error: unknown) => void
}

/** Runs a selection action and records text that leaves the application. */
export function createSelectionAction(deps: SelectionActionDependencies) {
  const run = async (
    action: SelectionAction,
    text: string,
    signal: AbortSignal
  ): Promise<string> => {
    let result: ToolResult
    if (action.kind === 'correction') {
      result = await deps.correct(text, signal)
    } else {
      const command = normalizeCommands(deps.commands()).find(
        (item) => item.id === action.commandId
      )
      if (!command)
        throw new Error(
          deps.t('commandLauncher.commandMissing', { id: action.commandId })
        )
      result = await deps.transform(command, text, signal)
      logCommandRun(
        deps,
        commandRunRecord(command, 'selection', text, {
          success: result.ok,
          message: toolResultMessage(result, deps.t),
        })
      )
    }
    if (result.cancelled) throw new SelectionActionAbortedError()
    if (!result.ok)
      throw new Error(
        toolResultMessage(result, deps.t) || deps.t('toast.commandFailed')
      )
    return result.content ?? ''
  }
  const saveResult = async (
    action: SelectionAction,
    text: string,
    result: string
  ) => {
    try {
      if (action.kind === 'correction') {
        const sourceId = await deps.history.saveSource(text, 'correction')
        await deps.history.saveSourceResult(sourceId, result)
      } else {
        await deps.history.saveOutput(text)
      }
      await deps.history.saveOutput(result)
    } catch (error) {
      // Insertion already succeeded; a history failure must not undo it.
      deps.reportError(error)
    }
  }
  return {
    run,
    saveResult,
    isAborted: (error: unknown) => error instanceof SelectionActionAbortedError,
  }
}
