import {
  type TimerDependencies,
  createSingleTimer,
} from '../timers/single-timer'

export interface QuickCorrectionDependencies extends TimerDependencies {
  correct: (text: string, signal: AbortSignal) => Promise<string>
  /** Idle time after the last edit before a speculative correction starts */
  precorrectionDelayMs?: number
}

export class CorrectionAbortedError extends Error {
  constructor() {
    super('Correction aborted')
    this.name = 'CorrectionAbortedError'
  }
}

export const isCorrectionAborted = (error: unknown): boolean =>
  error instanceof CorrectionAbortedError

interface CorrectionRun {
  text: string
  controller: AbortController
  promise: Promise<string>
}

/**
 * Corrects the text of the quick input. One text is corrected at a time: a
 * request for another text aborts the running one, while a request for the same
 * text shares it, or gets the finished result right away
 */
export function createQuickCorrection(deps: QuickCorrectionDependencies) {
  const timer = createSingleTimer(deps)
  const precorrectionDelayMs = deps.precorrectionDelayMs ?? 1000

  let isDisposed = false
  let activeRun: CorrectionRun | null = null
  let cachedCorrection: { text: string; result: string } | null = null

  const abort = () => {
    activeRun?.controller.abort()
    activeRun = null
  }

  /** Resolves to the corrected text; rejects when aborted or failed. */
  const request = (text: string): Promise<string> => {
    if (isDisposed) return Promise.reject(new CorrectionAbortedError())
    timer.stop()
    if (cachedCorrection?.text === text)
      return Promise.resolve(cachedCorrection.result)
    if (activeRun?.text === text) return activeRun.promise
    abort()

    const controller = new AbortController()
    const current: CorrectionRun = {
      text,
      controller,
      promise: deps.correct(text, controller.signal).then(
        (result) => {
          // a request layer may resolve with a partial text on abort
          if (controller.signal.aborted) throw new CorrectionAbortedError()
          if (activeRun === current) activeRun = null
          cachedCorrection = { text, result }
          return result
        },
        (error: unknown) => {
          if (activeRun === current) activeRun = null
          throw controller.signal.aborted ? new CorrectionAbortedError() : error
        }
      ),
    }
    activeRun = current

    return current.promise
  }

  /** A completed caller must never cancel a newer correction. */
  const correct = async (
    text: string,
    signal: AbortSignal
  ): Promise<string> => {
    if (signal.aborted) throw new CorrectionAbortedError()
    const promise = request(text)
    const ownedRun = activeRun
    const onAbort = () => {
      if (ownedRun && activeRun === ownedRun) cancel()
    }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      const result = await promise
      if (signal.aborted) throw new CorrectionAbortedError()
      return result
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  /** The finished correction of exactly this text, if there is one. */
  const getCachedCorrection = (text: string): string | undefined =>
    cachedCorrection?.text === text ? cachedCorrection.result : undefined

  /**
   * The text was edited: drop work for older texts and correct this one once
   * the user pauses. Pass null when the text should not be corrected
   */
  const schedulePrecorrection = (text: string | null) => {
    if (isDisposed) return
    timer.stop()
    if (activeRun && activeRun.text !== text) abort()
    if (
      text === null ||
      cachedCorrection?.text === text ||
      activeRun?.text === text
    )
      return

    timer.start(() => {
      // failures are reported by the request that needs the result
      request(text).catch(() => {})
    }, precorrectionDelayMs)
  }

  /** Aborts the running correction; a finished one stays reusable. */
  const cancel = () => {
    timer.stop()
    abort()
  }

  const invalidate = () => {
    cancel()
    cachedCorrection = null
  }

  const dispose = () => {
    isDisposed = true
    invalidate()
  }

  return {
    request,
    correct,
    getCachedCorrection,
    schedulePrecorrection,
    cancel,
    invalidate,
    dispose,
  }
}
