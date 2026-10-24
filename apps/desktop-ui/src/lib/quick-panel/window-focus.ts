import { createFocusSettle, type FocusSettleOptions } from './focus-settle'

export interface WindowFocusDependencies extends FocusSettleOptions {
  /** Asks the window system whether the window has focus right now. */
  isFocused: () => Promise<boolean>
  onChange: (focused: boolean) => void
}

/**
 * Tracks whether the window has the keyboard, for showing it: the quick window
 * has no decorations that would tell it. A gained focus shows at once, a lost
 * one only once it lasts, so short blurs do not blink
 */
export function createWindowFocus(deps: WindowFocusDependencies) {
  const settle = createFocusSettle(deps)
  let focused: boolean | null = null

  const apply = (value: boolean) => {
    if (focused === value) return
    focused = value
    deps.onChange(value)
  }

  const handleFocusChange = (value: boolean) => {
    if (value) {
      settle.cancel()
      apply(true)
    } else settle.schedule(() => apply(false))
  }

  /** Reads the current state, e.g. after the window was shown again. */
  const refresh = async () => {
    const isCurrent = settle.cancel()
    // when the question cannot be answered, claiming focus hides nothing
    const value = await deps.isFocused().catch(() => true)
    if (isCurrent()) apply(value)
  }

  return { handleFocusChange, refresh, dispose: settle.cancel }
}
