import {
  isCloseWindowEvent,
  type InputKeyEvent,
} from '../input-keys/input-keys'

/** Takes over closing the window; returns false to let the default run */
export type CloseWindowInterceptor = () => boolean

export interface CloseWindowDependencies {
  /** Cancels what is running, clears the menus and hides the window */
  closeWindow: () => void
}

/** Shift+Esc: closes the whole window at any step */
export function isCloseAllEvent(event: InputKeyEvent): boolean {
  return (
    (event.key === 'Escape' || event.code === 'Escape') &&
    Boolean(event.shiftKey) &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.isComposing
  )
}

/**
 * The single owner of Shift+Esc and its alias Ctrl+Q in a window. A surface
 * that must close in its own way, such as the screenshot area selector,
 * intercepts it; the latest interceptor goes first.
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

  /** Handles Shift+Esc and Ctrl+Q; true when the event was consumed */
  function handleKeydown(
    event: InputKeyEvent & {
      preventDefault: () => void
      stopImmediatePropagation: () => void
    }
  ): boolean {
    if (!isCloseAllEvent(event) && !isCloseWindowEvent(event)) return false
    event.preventDefault()
    event.stopImmediatePropagation()
    closeAll()
    return true
  }

  return { intercept, closeAll, handleKeydown }
}
