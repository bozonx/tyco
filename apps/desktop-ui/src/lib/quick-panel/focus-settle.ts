export interface FocusSettleOptions {
  settleMs?: number
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (timer: unknown) => void
}

export function createFocusSettle(options: FocusSettleOptions) {
  const setTimer =
    options.setTimer ?? ((callback, ms) => setTimeout(callback, ms))
  const clearTimer =
    options.clearTimer ??
    ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>))
  let generation = 0
  let timer: unknown = null

  const cancel = () => {
    generation += 1
    if (timer !== null) clearTimer(timer)
    timer = null
    const currentGeneration = generation
    return () => currentGeneration === generation
  }

  const schedule = (run: (isCurrent: () => boolean) => void) => {
    const isCurrent = cancel()
    timer = setTimer(() => {
      timer = null
      run(isCurrent)
    }, options.settleMs ?? 150)
  }

  return { cancel, schedule }
}
