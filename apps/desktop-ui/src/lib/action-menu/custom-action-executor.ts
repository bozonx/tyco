import type { MainActionConfig } from '@tyco/shared'

const QUICK_WINDOW_MODE_SWITCHING_STANDARD_ACTIONS = new Set([
  'voiceInput',
  'screenshotQuickAiRequest',
  'voiceScreenshotQuickAiRequest',
])

const QUICK_WINDOW_MODE_SWITCHING_PROFILE_ACTIONS = new Set([
  'screenshotQuickAiRequest',
  'voiceScreenshotQuickAiRequest',
])

/**
 * Whether the action switches to another quick window mode (e.g. voice,
 * screenshot) or changes the page, so the quick window must NOT be hidden after
 * executing it.
 */
export function isQuickWindowModeSwitchingAction(
  action: MainActionConfig | null | undefined
): boolean {
  if (!action) return false
  if (action.type === 'actionPage') return true
  if (
    action.type === 'standard' &&
    QUICK_WINDOW_MODE_SWITCHING_STANDARD_ACTIONS.has(action.actionId)
  ) {
    return true
  }
  if (
    action.type === 'profile' &&
    QUICK_WINDOW_MODE_SWITCHING_PROFILE_ACTIONS.has(action.action)
  ) {
    return true
  }
  return false
}

export interface WaitForSelectionDependencies {
  getSelectedText: () => string | null | undefined
  getRevision: () => number
  getActivationId: () => number
  watchState: (
    callback: (params: {
      selectedText: string | null | undefined
      revision: number
      activationId: number
    }) => void
  ) => () => void
}

/**
 * Waits for the asynchronously captured foreground selection to arrive.
 * Resolves when `selectedText` is received, when the revision increments
 * (meaning capture finished with or without text), or when the timeout
 * expires.
 */
export function waitForCapturedSelection(
  deps: WaitForSelectionDependencies,
  activationId: number,
  initialRevision: number,
  timeoutMs = 600
): Promise<string> {
  const currentText = deps.getSelectedText()
  if (currentText && currentText.trim()) {
    return Promise.resolve(currentText)
  }

  return new Promise<string>((resolve) => {
    let unwatch: (() => void) | undefined

    const timer = setTimeout(() => {
      cleanup()
      resolve(deps.getSelectedText() ?? '')
    }, timeoutMs)

    const cleanup = () => {
      clearTimeout(timer)
      if (unwatch) {
        unwatch()
        unwatch = undefined
      }
    }

    unwatch = deps.watchState(
      ({ selectedText, revision, activationId: currentActivationId }) => {
        if (currentActivationId !== activationId) {
          cleanup()
          resolve('')
          return
        }
        if (selectedText && selectedText.trim()) {
          cleanup()
          resolve(selectedText)
          return
        }
        if (revision > initialRevision) {
          cleanup()
          resolve(deps.getSelectedText() ?? '')
        }
      }
    )
  })
}
