export interface FocusLossDeps {
  /** Asks the window system whether the window has focus right now. */
  isFocused: () => Promise<boolean>
  /** Whether losing focus may dismiss the window at this moment. */
  canDismiss: () => boolean
  onLost: () => void
  /** A blur shorter than this is not a loss: the focus is coming back. */
  settleMs?: number
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (timer: unknown) => void
}

/**
 * Tells a real focus loss (the user clicked another window) from the short
 * blurs the app causes itself, such as remapping the window to resize it
 */
export function createFocusLossWatcher(deps: FocusLossDeps) {
  const setTimer = deps.setTimer ?? ((cb, ms) => setTimeout(cb, ms))
  const clearTimer =
    deps.clearTimer ??
    ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>))
  const settleMs = deps.settleMs ?? 150

  let generation = 0
  let timer: unknown = null
  let suppressions = 0

  const stopTimer = () => {
    if (timer === null) return
    clearTimer(timer)
    timer = null
  }

  const check = async (checkGeneration: number) => {
    const current = () => checkGeneration === generation && suppressions === 0
    if (!current() || !deps.canDismiss()) return
    // when the question cannot be answered, keeping the window is safer
    const focused = await deps.isFocused().catch(() => true)
    if (focused || !current() || !deps.canDismiss()) return
    deps.onLost()
  }

  const handleFocusChange = (focused: boolean) => {
    generation += 1
    stopTimer()
    if (focused) return

    const checkGeneration = generation
    timer = setTimer(() => {
      timer = null
      void check(checkGeneration)
    }, settleMs)
  }

  /**
   * Runs a task that makes the window blur by itself; blurs during it and
   * shortly after it are not losses
   */
  const suppress = async <T>(task: () => Promise<T>): Promise<T> => {
    suppressions += 1
    try {
      return await task()
    } finally {
      setTimer(() => {
        suppressions -= 1
      }, settleMs * 2)
    }
  }

  const dispose = () => {
    generation += 1
    stopTimer()
  }

  return { handleFocusChange, suppress, dispose }
}
