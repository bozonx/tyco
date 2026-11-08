import { errorMessage } from '@tyco/shared/value-guards'
import type {
  EditorHistoryFailure,
  EditorHistoryInstruction,
  EditorHistoryOperation,
  EditorHistoryOrigin,
} from '@tyco/shared'

import { historyFailureOf } from '../history/history-failure'
import type { ToolResult } from '../tools/tool-types'
import type {
  BufferedPendingAction,
  PendingModalParams,
} from './menu-modal-params'

export interface MenuStepRunDependencies {
  /** The top step of the menu; undefined when the menu has no steps */
  currentStepId: () => number | undefined
  hasStep: (id: number) => boolean
  setPending: (params: PendingModalParams, owner?: number) => number
  clearPending: (owner: number) => void
  saveSource: (
    text: string,
    operation: EditorHistoryOperation,
    origin?: EditorHistoryOrigin,
    instruction?: EditorHistoryInstruction
  ) => Promise<string | null>
  saveSourceResult: (id: string | null, result: string) => Promise<void>
  /** Why the tool produced nothing for the source `id` */
  saveSourceFailure?: (
    id: string | null,
    failure: EditorHistoryFailure
  ) => Promise<void>
  /** The result was made but could not be kept in the history */
  reportHistoryError: () => void
  /** The text of a failed result, as the tool tells it */
  describeResult: (result: ToolResult) => string
  reportError: (message: string) => void
  consumeBufferedIntent?: () => BufferedPendingAction | null
  executeBufferedIntent?: (
    intent: BufferedPendingAction,
    text: string,
    sourceText: string
  ) => Promise<boolean | void> | boolean | void
}

export interface MenuStepRunRequest {
  /** The text the tool works on, kept in the history as the source */
  text: string
  /**
   * The untrimmed selection `text` came from, when it differs from `text`: used
   * to replace the exact selection in the editor
   */
  sourceText?: string
  operation: EditorHistoryOperation
  origin?: EditorHistoryOrigin
  instruction?: EditorHistoryInstruction
  /** What the pending screen shows while the tool runs */
  pending: Omit<PendingModalParams, 'onCancel'>
  /**
   * Runs the tool; `updatePending` changes what the pending screen shows, e.g.
   * the stage of a long run
   */
  invoke: (
    signal: AbortSignal,
    updatePending: (params: Omit<PendingModalParams, 'onCancel'>) => void
  ) => Promise<ToolResult>
  /**
   * The text of a successful result to show; null when there is nothing to
   * show, and the caller has said why
   */
  read: (result: ToolResult) => string | null
  /** Opens the step with the result */
  show: (text: string, result: ToolResult) => void
}

/**
 * Runs a tool from a menu step behind the pending screen: the source and the
 * result go to the history, and the result opens the next step unless the user
 * cancelled the run or closed the step meanwhile
 */
export function createMenuStepRun(deps: MenuStepRunDependencies) {
  return async (request: MenuStepRunRequest): Promise<void> => {
    // the menu step, when the menu is one: closing it hides the result
    const stepId = deps.currentStepId()
    const controller = new AbortController()
    const onCancel = () => controller.abort()
    const owner = deps.setPending({
      allowBufferedIntent: true,
      ...request.pending,
      onCancel,
    })
    const updatePending = (params: Omit<PendingModalParams, 'onCancel'>) => {
      if (!controller.signal.aborted)
        deps.setPending(
          { allowBufferedIntent: true, ...params, onCancel },
          owner
        )
    }
    let sourceId: string | null = null
    // the history is a convenience: a failed write is only reported
    const saveFailure = (failure: EditorHistoryFailure) =>
      deps.saveSourceFailure?.(sourceId, failure).catch(deps.reportHistoryError)
    try {
      const saveSourceArgs = [
        request.text,
        request.operation,
        ...(request.origin || request.instruction
          ? [request.origin, request.instruction]
          : []),
      ] as const
      sourceId = await (
        deps.saveSource as (...args: unknown[]) => Promise<string | null>
      )(...saveSourceArgs).catch(() => {
        deps.reportHistoryError()
        return null
      })
      if (controller.signal.aborted) {
        await saveFailure({ kind: 'cancelled' })
        return
      }
      const result = await request.invoke(controller.signal, updatePending)
      if (result.cancelled || controller.signal.aborted) {
        await saveFailure({ kind: 'cancelled' })
        return
      }
      if (!result.ok) {
        const message = deps.describeResult(result)
        deps.reportError(message)
        await saveFailure(historyFailureOf(undefined, message))
        return
      }
      const text = request.read(result)
      if (text === null) return
      await deps.saveSourceResult(sourceId, text).catch(deps.reportHistoryError)
      // closed meanwhile: the result is in the history, not on the screen
      if (controller.signal.aborted) return
      if (stepId !== undefined && !deps.hasStep(stepId)) return

      const buffered = deps.consumeBufferedIntent?.()
      if (buffered && deps.executeBufferedIntent) {
        if (typeof buffered === 'object' && buffered !== null) {
          request.show(text, result)
          await deps.executeBufferedIntent(
            buffered,
            text,
            request.sourceText ?? request.text
          )
          return
        }
        const handled = await deps.executeBufferedIntent(
          buffered,
          text,
          request.sourceText ?? request.text
        )
        if (handled !== false) return
      }

      request.show(text, result)
    } catch (error) {
      if (controller.signal.aborted) {
        await saveFailure({ kind: 'cancelled' })
        return
      }
      const message = errorMessage(error)
      deps.reportError(message)
      await saveFailure(historyFailureOf(error, message))
    } finally {
      deps.clearPending(owner)
    }
  }
}
