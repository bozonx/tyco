import {
  isCloseWindowEvent,
  isQuitEvent,
  type InputKeyEvent,
} from '../input-keys/input-keys'

/** Takes over closing the window; returns false to let the default run */
export type CloseWindowInterceptor = () => boolean

export interface CloseWindowDependencies {
  /** Cancels what is running, clears the menus and hides the window */
  closeWindow: () => void
  /** Exits the whole application */
  exitApp?: () => void
}

/** Ctrl+W closes the whole window at any step. */
export const isCloseAllEvent = isCloseWindowEvent

/**
 * The single owner of Ctrl+W and Ctrl+Q in a window. A surface that must close
 * in its own way, such as the screenshot area selector, intercepts Ctrl+W; the
 * latest interceptor goes first. Ctrl+Q exits the application.
 */
export function createCloseWindowModel(deps: CloseWindowDependencies) {
  const interceptors: CloseWindowInterceptor[] = []

  function intercept(interceptor: CloseWindowInterceptor): () => void {
    interceptors.push(interceptor)
    return () => {
      const index = interceptors.lastIndexOf(interceptor)
      if (index !== -1) interceptors.splice(index, 1)
    }
  }

  function closeAll() {
    for (const interceptor of [...interceptors].reverse()) {
      if (interceptor()) return
    }
    deps.closeWindow()
  }

  /**
   * Handles Ctrl+W (close window) and Ctrl+Q (quit app); true when the event
   * was consumed
   */
  function handleKeydown(
    event: InputKeyEvent & {
      preventDefault: () => void
      stopImmediatePropagation: () => void
    }
  ): boolean {
    if (isQuitEvent(event)) {
      event.preventDefault()
      event.stopImmediatePropagation()
      deps.exitApp?.()
      return true
    }
    if (isCloseWindowEvent(event)) {
      event.preventDefault()
      event.stopImmediatePropagation()
      closeAll()
      return true
    }
    return false
  }

  return { intercept, closeAll, handleKeydown }
}
