import type { ToolResult } from '../tools/tool-types'
import type { BufferedPendingAction } from './menu-modal-params'

export interface BufferedIntentDependencies {
  isEditorPage: () => boolean
  /** Replaces `sourceText` in the editor; false when it could not */
  applyEditorTransfer: (text: string, sourceText: string) => boolean | void
  focusEditor: () => void
  canInsertIntoWindow: () => boolean
  closeAll: () => void
  saveOutput: (text: string) => Promise<unknown>
  insert: (text: string) => Promise<ToolResult>
  copy: (text: string) => Promise<ToolResult>
  isQuickWindow: () => boolean
  hideWindow: () => Promise<unknown>
  notifyNoTarget: () => void
  notifyCopied: () => void
  reportHistoryError: () => void
  reportFailure: (result: ToolResult) => void
}

/**
 * Runs the action the user pressed while a result was still on its way.
 * Resolves to false when the action could not run and the result should be
 * shown instead
 */
export function createBufferedIntentRunner(deps: BufferedIntentDependencies) {
  /** The history is a convenience: a failed write must not stop the action */
  const saveOutput = async (text: string) => {
    try {
      await deps.saveOutput(text)
    } catch {
      deps.reportHistoryError()
    }
  }

  return async (
    intent: BufferedPendingAction,
    text: string,
    sourceText: string
  ): Promise<boolean> => {
    if (intent === 'insert' && deps.isEditorPage()) {
      if (deps.applyEditorTransfer(text, sourceText) === false) return true
      deps.closeAll()
      deps.focusEditor()
      return true
    }
    if (intent === 'insert') {
      if (!deps.canInsertIntoWindow()) {
        deps.notifyNoTarget()
        return false
      }
      deps.closeAll()
      await saveOutput(text)
      const outcome = await deps.insert(text)
      if (!outcome.ok) deps.reportFailure(outcome)
      return true
    }
    deps.closeAll()
    await saveOutput(text)
    const outcome = await deps.copy(text)
    if (!outcome.ok) {
      deps.reportFailure(outcome)
      return true
    }
    deps.notifyCopied()
    if (deps.isQuickWindow()) await deps.hideWindow()
    return true
  }
}
