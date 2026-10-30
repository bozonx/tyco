import { errorMessage } from '@tyco/shared/value-guards'
import type { EditorHistoryOperation } from '@tyco/shared'

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
    operation: EditorHistoryOperation
  ) => Promise<string | null>
  saveSourceResult: (id: string | null, result: string) => Promise<void>
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
  ) => Promise<void> | void
}

export interface MenuStepRunRequest {
  /** The text the tool works on, kept in the history as the source */
  text: string
  operation: EditorHistoryOperation
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
    try {
      const sourceId = await deps.saveSource(request.text, request.operation)
      if (controller.signal.aborted) return
      const result = await request.invoke(controller.signal, updatePending)
      if (result.cancelled || controller.signal.aborted) return
      if (!result.ok) {
        deps.reportError(deps.describeResult(result))
        return
      }
      const text = request.read(result)
      if (text === null) {
        deps.consumeBufferedIntent?.()
        return
      }
      await deps.saveSourceResult(sourceId, text).catch(deps.reportHistoryError)
      // closed meanwhile: the result is in the history, not on the screen
      if (controller.signal.aborted) {
        deps.consumeBufferedIntent?.()
        return
      }
      if (stepId !== undefined && !deps.hasStep(stepId)) {
        deps.consumeBufferedIntent?.()
        return
      }

      const buffered = deps.consumeBufferedIntent?.()
      if (buffered && deps.executeBufferedIntent) {
        await deps.executeBufferedIntent(buffered, text, request.text)
        return
      }

      request.show(text, result)
    } catch (error) {
      deps.consumeBufferedIntent?.()
      if (controller.signal.aborted) return
      deps.reportError(errorMessage(error))
    } finally {
      deps.clearPending(owner)
    }
  }
}
