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
  correcting: boolean
  /** Why the correction failed; `text` is then the uncorrected one */
  correctionError?: string
  /** The correction came back without changes */
  correctionUnchanged?: boolean
  onLeave?: () => void
}

export interface CorrectionStepDeps {
  correct: (text: string, signal: AbortSignal) => Promise<string>
  /** A finished correction of exactly this text, if there is one */
  peek?: (text: string) => string | undefined
  /** Opens the step on top of the others; returns its id */
  openStep: (params: CorrectionStepParams & Record<string, unknown>) => number
  /** Changes the params of the step; false when it is gone */
  updateStep: (id: number, params: Partial<CorrectionStepParams>) => boolean
  saveResult: (text: string, result: string) => Promise<void>
  /** Reports a failure; returns the message to show on the step */
  reportError: (error: unknown) => string
  /** Whether the error means the correction was aborted elsewhere */
  isAborted?: (error: unknown) => boolean
}

const resultParams = (text: string, result: string) => ({
  text: result,
  oldText: result === text ? '' : text,
  correcting: false,
  correctionUnchanged: result === text,
  onLeave: undefined,
})

/**
 * Corrects a text on its own actions step, stacked over the step it came from:
 * the actions then run on the corrected text, and going back returns to the
 * text as it was. Leaving the step aborts the correction
 */
export function createCorrectionStep(deps: CorrectionStepDeps) {
  /** Resolves once the correction is shown, failed, or abandoned. */
  const start = async (
    text: string,
    extra: Record<string, unknown> = {}
  ): Promise<void> => {
    const base = { ...extra, correction: true as const, originalText: text }

    const ready = deps.peek?.(text)
    if (ready !== undefined) {
      deps.openStep({ ...base, ...resultParams(text, ready) })
      await deps.saveResult(text, ready)
      return
    }

    const controller = new AbortController()
    const id = deps.openStep({
      ...base,
      text,
      oldText: '',
      correcting: true,
      onLeave: () => controller.abort(),
    })

    let result: string
    try {
      result = await deps.correct(text, controller.signal)
    } catch (error) {
      if (controller.signal.aborted) return
      if (deps.isAborted?.(error)) {
        // the text stays as it was, the actions work on it
        deps.updateStep(id, { correcting: false, onLeave: undefined })
        return
      }
      const message = deps.reportError(error)
      deps.updateStep(id, {
        correcting: false,
        correctionError: message,
        onLeave: undefined,
      })
      return
    }
    // a request layer may resolve with a partial text on abort
    if (controller.signal.aborted) return
    if (!deps.updateStep(id, resultParams(text, result))) return
    await deps.saveResult(text, result)
  }

  return { start }
}
