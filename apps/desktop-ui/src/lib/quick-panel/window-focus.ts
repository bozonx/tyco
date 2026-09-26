export interface WindowFocusDeps {
  /** Asks the window system whether the window has focus right now. */
  isFocused: () => Promise<boolean>
  onChange: (focused: boolean) => void
  /** A blur shorter than this is not shown: the focus is coming back. */
  settleMs?: number
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (timer: unknown) => void
}

/**
 * Tracks whether the window has the keyboard, for showing it: the quick window
 * has no decorations that would tell it. A gained focus shows at once, a lost
 * one only once it lasts, so short blurs do not blink
 */
export function createWindowFocus(deps: WindowFocusDeps) {
  const setTimer = deps.setTimer ?? ((cb, ms) => setTimeout(cb, ms))
  const clearTimer =
    deps.clearTimer ??
    ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>))
  const settleMs = deps.settleMs ?? 150

  let generation = 0
  let timer: unknown = null
  let focused: boolean | null = null

  const stopTimer = () => {
    if (timer === null) return
    clearTimer(timer)
    timer = null
  }

  const apply = (value: boolean) => {
    if (focused === value) return
    focused = value
    deps.onChange(value)
  }

  const handleFocusChange = (value: boolean) => {
    generation += 1
    stopTimer()
    if (value) {
      apply(true)
      return
    }
    timer = setTimer(() => {
      timer = null
      apply(false)
    }, settleMs)
  }

  /** Reads the current state, e.g. after the window was shown again. */
  const refresh = async () => {
    const checkGeneration = ++generation
    stopTimer()
    // when the question cannot be answered, claiming focus hides nothing
    const value = await deps.isFocused().catch(() => true)
    if (checkGeneration === generation) apply(value)
  }

  const dispose = () => {
    generation += 1
    stopTimer()
  }

  return { handleFocusChange, refresh, dispose }
}
