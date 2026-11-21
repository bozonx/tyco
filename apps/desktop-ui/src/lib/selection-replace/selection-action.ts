import type { SelectionAction } from '@tyco/shared'

import type { createHistoryModel } from '../history/history-model'
import { toolResultMessage } from '../invocation/invocation-result'
import type { OperationResult } from '../operations/operation-types'

export class SelectionActionAbortedError extends Error {}

export interface SelectionActionDependencies {
  correct: (text: string, signal: AbortSignal) => Promise<OperationResult>
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
    _action: SelectionAction,
    text: string,
    signal: AbortSignal
  ): Promise<string> => {
    const result = await deps.correct(text, signal)
    if (result.cancelled) throw new SelectionActionAbortedError()
    if (!result.ok)
      throw new Error(
        toolResultMessage(result, deps.t) || deps.t('toast.commandFailed')
      )
    return result.content ?? ''
  }
  const saveResult = async (
    _action: SelectionAction,
    text: string,
    result: string
  ) => {
    try {
      // the selection is the source of the result, it never left the app
      const sourceId = await deps.history.saveSource(text, 'correction')
      await deps.history.saveSourceResult(sourceId, result)
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
