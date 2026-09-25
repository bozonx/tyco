export interface QuickCorrectionDeps {
  correct: (text: string, signal: AbortSignal) => Promise<string>
  /** Idle time after the last edit before a speculative correction starts */
  speculateDelayMs?: number
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (timer: unknown) => void
}

export class CorrectionAbortedError extends Error {
  constructor() {
    super('Correction aborted')
    this.name = 'CorrectionAbortedError'
  }
}

export const isCorrectionAborted = (error: unknown): boolean =>
  error instanceof CorrectionAbortedError

interface Run {
  text: string
  controller: AbortController
  promise: Promise<string>
}

/**
 * Corrects the text of the quick input. One text is corrected at a time: a
 * request for another text aborts the running one, while a request for the same
 * text shares it, or gets the finished result right away
 */
export function createQuickCorrection(deps: QuickCorrectionDeps) {
  const setTimer = deps.setTimer ?? ((cb, ms) => setTimeout(cb, ms))
  const clearTimer =
    deps.clearTimer ??
    ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>))
  const speculateDelayMs = deps.speculateDelayMs ?? 1000

  let run: Run | null = null
  let done: { text: string; result: string } | null = null
  let timer: unknown = null

  const stopTimer = () => {
    if (timer === null) return
    clearTimer(timer)
    timer = null
  }

  const abort = () => {
    run?.controller.abort()
    run = null
  }

  /** Resolves to the corrected text; rejects when aborted or failed. */
  const request = (text: string): Promise<string> => {
    stopTimer()
    if (done?.text === text) return Promise.resolve(done.result)
    if (run?.text === text) return run.promise
    abort()

    const controller = new AbortController()
    const current: Run = {
      text,
      controller,
      promise: deps.correct(text, controller.signal).then(
        (result) => {
          // a request layer may resolve with a partial text on abort
          if (controller.signal.aborted) throw new CorrectionAbortedError()
          if (run === current) run = null
          done = { text, result }
          return result
        },
        (error: unknown) => {
          if (run === current) run = null
          throw controller.signal.aborted ? new CorrectionAbortedError() : error
        }
      ),
    }
    run = current

    return current.promise
  }

  /** The finished correction of exactly this text, if there is one. */
  const peek = (text: string): string | undefined =>
    done?.text === text ? done.result : undefined

  /**
   * The text was edited: drop work for older texts and correct this one once
   * the user pauses. Pass null when the text should not be corrected
   */
  const speculate = (text: string | null) => {
    stopTimer()
    if (run && run.text !== text) abort()
    if (text === null || done?.text === text || run?.text === text) return

    timer = setTimer(() => {
      timer = null
      // failures are reported by the request that needs the result
      request(text).catch(() => {})
    }, speculateDelayMs)
  }

  /** Aborts the running correction; a finished one stays reusable. */
  const cancel = () => {
    stopTimer()
    abort()
  }

  return { request, peek, speculate, cancel }
}
