import type {
  InsertMenuParams,
  PendingModalParams,
} from '../modals/menu-modal-params'

export type CorrectionStepExtra = InsertMenuParams & PendingModalParams

/** Params of the actions step that shows a correction, see `InsertMenu`. */
export interface CorrectionStepParams {
  /** Marks the step as a correction: Esc goes back to the text before it */
  correction: true
  text: string
  /** The text before correction; empty while there is no diff to show */
  oldText: string
  /** The text before correction, still insertable with Shift+Space */
  originalText: string
  /** The correction is on its way and will replace `text` */
  isCorrecting: boolean
  /** Why the correction failed; `text` is then the uncorrected one */
  correctionError?: string
  /** The correction came back without changes */
  isCorrectionUnchanged?: boolean
  onLeave?: () => void
}

export interface CorrectionStepDependencies {
  correct: (text: string, signal: AbortSignal) => Promise<string>
  /** A finished correction of exactly this text, if there is one */
  getCachedCorrection?: (text: string) => string | undefined
  /** Opens the step on top of the others; returns its id */
  openStep: (params: CorrectionStepParams & CorrectionStepExtra) => number
  /** Changes the params of the step; false when it is gone */
  updateStep?: (id: number, params: Partial<CorrectionStepParams>) => boolean
  /** Shows an in-progress overlay while waiting for correction */
  setPending?: (params: PendingModalParams) => number | void
  /** Clears the in-progress overlay */
  clearPending?: (owner?: number | void) => void
  isPending?: (owner: number | void) => boolean
  saveResult: (text: string, result: string) => Promise<void>
  /** Reports a failure; returns the message to show on the step */
  reportError: (error: unknown) => string
  /** Whether the error means the correction was aborted elsewhere */
  isAborted?: (error: unknown) => boolean
}

const resultParams = (text: string, result: string) => ({
  text: result,
  oldText: result === text ? '' : text,
  isCorrecting: false,
  isCorrectionUnchanged: result === text,
  onLeave: undefined,
})

/**
 * Corrects a text on its own actions step, stacked over the step it came from:
 * the actions then run on the corrected text, and going back returns to the
 * text as it was. Leaving the step aborts the correction
 */
export function createCorrectionStep(deps: CorrectionStepDependencies) {
  let disposed = false
  const controllers = new Map<AbortController, number | void>()
  /** Resolves once the correction is shown, failed, or abandoned. */
  const perform = async (
    text: string,
    extra: CorrectionStepExtra,
    controller: AbortController
  ): Promise<void> => {
    const base = { ...extra, correction: true as const, originalText: text }

    const ready = deps.getCachedCorrection?.(text)
    if (ready !== undefined) {
      deps.openStep({ ...base, ...resultParams(text, ready) })
      await deps.saveResult(text, ready)
      return
    }

    if (deps.setPending) {
      const onCancel = () => {
        controller.abort()
        if (typeof extra.onCancel === 'function') {
          extra.onCancel()
        }
      }
      const owner = deps.setPending({ ...extra, correction: true, onCancel })
      controllers.set(controller, owner)

      let result: string
      let showResult: boolean
      try {
        result = await deps.correct(text, controller.signal)
      } catch (error) {
        deps.clearPending?.(owner)
        if (controller.signal.aborted) return
        if (deps.isAborted?.(error)) return
        deps.reportError(error)
        return
      } finally {
        showResult = deps.isPending?.(owner) ?? true
        deps.clearPending?.(owner)
      }

      if (controller.signal.aborted) return
      if (showResult) deps.openStep({ ...base, ...resultParams(text, result) })
      await deps.saveResult(text, result)
      return
    }

    const id = deps.openStep({
      ...base,
      text,
      oldText: '',
      isCorrecting: true,
      onLeave: () => {
        controller.abort()
        if (typeof extra.onCancel === 'function') {
          extra.onCancel()
        }
      },
    })

    let result: string
    try {
      result = await deps.correct(text, controller.signal)
    } catch (error) {
      if (controller.signal.aborted) return
      if (deps.isAborted?.(error)) {
        // the text stays as it was, the actions work on it
        deps.updateStep?.(id, { isCorrecting: false, onLeave: undefined })
        return
      }
      const message = deps.reportError(error)
      deps.updateStep?.(id, {
        isCorrecting: false,
        correctionError: message,
        onLeave: undefined,
      })
      return
    }
    // a request layer may resolve with a partial text on abort
    if (controller.signal.aborted) return
    if (!deps.updateStep?.(id, resultParams(text, result))) return
    await deps.saveResult(text, result)
  }

  const start = async (text: string, extra: CorrectionStepExtra = {}) => {
    if (disposed) return
    const controller = new AbortController()
    controllers.set(controller, undefined)
    try {
      await perform(text, extra, controller)
    } finally {
      controllers.delete(controller)
    }
  }
  const dispose = () => {
    if (disposed) return
    disposed = true
    for (const [controller, owner] of controllers) {
      controller.abort()
      if (owner !== undefined) deps.clearPending?.(owner)
    }
    controllers.clear()
  }
  return { start, dispose }
}
