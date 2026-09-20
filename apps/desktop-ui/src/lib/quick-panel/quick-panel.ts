import { ref } from 'vue'

import { APP_ROUTES, type AppRoutePath } from '../navigation/routes'

/**
 * Routes whose UI is rendered by the always mounted quick panel instead of
 * `RouterView`. Mounting the input on every show costs the first keystrokes:
 * the OS hands the keyboard over before a freshly mounted field exists in the
 * DOM, and everything typed in that gap goes to the window the user came from.
 */
export const QUICK_PANEL_PATHS: readonly AppRoutePath[] = [
  APP_ROUTES.EDITOR.path,
]

export function isQuickPanelPath(path: string): boolean {
  return QUICK_PANEL_PATHS.includes(path as AppRoutePath)
}

export interface QuickPanelDeps {
  /** Puts the caret back into the quick input field. */
  focusInput: () => void
  /** Re-applies the nav panel setup the panel owns while it is visible. */
  applyNavParams: () => void
  /** Flushes the input into history; the panel itself is never unmounted. */
  persistInput: () => Promise<void> | void
}

export function createQuickPanelModel(deps: QuickPanelDeps) {
  const isActive = ref<boolean>(false)

  const enter = (): void => {
    isActive.value = true
    deps.applyNavParams()
    deps.focusInput()
  }

  const leave = (): void => {
    isActive.value = false
    void deps.persistInput()
  }

  /** Called on every route change; only the edges do any work. */
  const syncRoute = (path: string): void => {
    const nextActive = isQuickPanelPath(path)

    if (nextActive === isActive.value) return

    if (nextActive) {
      enter()
    } else {
      leave()
    }
  }

  /**
   * The OS window was shown or hidden. The field is focused in both directions:
   * while the panel is hidden the focus has to stay in it, so that by the next
   * show the DOM already has a focused element and no keystroke has to wait for
   * one.
   */
  const syncWindowVisibility = (): void => {
    if (!isActive.value) return

    deps.focusInput()
  }

  return { isActive, syncRoute, syncWindowVisibility }
}
