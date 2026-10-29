/** Modes whose first step (the input, the action menu) has nothing to lose. */
const DISMISSIBLE_MODES = new Set([
  'quickInput',
  'selectionActions',
  'aiTasks',
  'commandLauncher',
  'translation',
  'styling',
  'transformation',
])

export interface QuickWindowSessionDependencies {
  mode: () => string
  isWindowShown: () => boolean
  /** The command overlay is past its list: a typed text or a running command */
  isLauncherPastList: () => boolean
  hasModal: () => boolean
  hasPendingModal: () => boolean
  /** The user lets the window hide when it loses focus */
  isHideOnBlurEnabled: () => boolean
  /** A screen holds the window open, e.g. a dictation in progress */
  isDismissHeld: () => boolean
  markInputDismissed: () => void
  cancelAndCloseModals: () => void
  dismissWindow: () => void
  dismissWindowOnBlur: () => void
}

/**
 * When the quick window goes away by itself, and what goes with it: only the
 * first step leaves on a focus loss, and a hidden window or a new activation
 * drops the work started for the last one
 */
export function createQuickWindowSession(deps: QuickWindowSessionDependencies) {
  /**
   * Everything past the first step (the step after the input or the menu, a
   * correction on its way) stays until the user closes it with Esc: a click
   * must not lose it
   */
  const keepsOnFocusLoss = (): boolean =>
    !DISMISSIBLE_MODES.has(deps.mode()) ||
    (deps.mode() === 'commandLauncher' && deps.isLauncherPastList()) ||
    deps.hasModal() ||
    deps.hasPendingModal()

  const canDismissOnFocusLoss = (): boolean =>
    deps.isWindowShown() &&
    !keepsOnFocusLoss() &&
    deps.isHideOnBlurEnabled() &&
    !deps.isDismissHeld()

  /** The user clicked elsewhere: drop what is in progress, keep the text. */
  const dismissWith = (hide: () => void): void => {
    if (deps.mode() === 'quickInput') deps.markInputDismissed()
    deps.cancelAndCloseModals()
    hide()
  }

  /**
   * The window was hidden, or a new activation began: whatever was started for
   * the last one has no one to show it to, e.g. a correction must not finish
   * into an insert nobody sees
   */
  const endActivation = (): void => deps.cancelAndCloseModals()

  return {
    keepsOnFocusLoss,
    canDismissOnFocusLoss,
    dismiss: () => dismissWith(deps.dismissWindow),
    dismissOnBlur: () => dismissWith(deps.dismissWindowOnBlur),
    endActivation,
  }
}
