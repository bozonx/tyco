/** The timer functions a model uses; tests pass their own */
export interface TimerDependencies {
  setTimer?: (run: () => void, delayMs: number) => unknown
  clearTimer?: (timer: unknown) => void
}

/** One pending timeout at most: starting another replaces it */
export function createSingleTimer(deps: TimerDependencies = {}) {
  const setTimer =
    deps.setTimer ?? ((run, delayMs) => globalThis.setTimeout(run, delayMs))
  const clearTimer =
    deps.clearTimer ??
    ((timer) => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>))
  let timer: unknown = null

  const stop = () => {
    if (timer === null) return
    clearTimer(timer)
    timer = null
  }

  const start = (run: () => void, delayMs: number) => {
    stop()
    timer = setTimer(() => {
      timer = null
      run()
    }, delayMs)
  }

  return { start, stop, isPending: () => timer !== null }
}

export type SingleTimer = ReturnType<typeof createSingleTimer>
