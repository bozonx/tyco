import { createFocusSettle, type FocusSettleOptions } from './focus-settle'

export interface FocusLossDependencies extends FocusSettleOptions {
  /** Asks the window system whether the window has focus right now. */
  isFocused: () => Promise<boolean>
  /** Whether losing focus may dismiss the window at this moment. */
  canDismiss: () => boolean
  onLost: () => void
}

/**
 * Tells a real focus loss (the user clicked another window) from the short
 * blurs the window system causes by itself
 */
export function createFocusLossWatcher(deps: FocusLossDependencies) {
  const settle = createFocusSettle(deps)

  const check = async (current: () => boolean) => {
    if (!current() || !deps.canDismiss()) return
    // when the question cannot be answered, keeping the window is safer
    const focused = await deps.isFocused().catch(() => true)
    if (focused || !current() || !deps.canDismiss()) return
    deps.onLost()
  }

  const handleFocusChange = (focused: boolean) => {
    if (focused) settle.cancel()
    else settle.schedule((isCurrent) => void check(isCurrent))
  }

  return { handleFocusChange, dispose: settle.cancel }
}
