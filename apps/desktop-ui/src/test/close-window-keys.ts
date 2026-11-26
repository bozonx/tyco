import { onTestFinished } from 'vitest'

import { useCloseWindowStore } from '../stores/close-window'

/**
 * Installs the window-wide Ctrl+W and Ctrl+Q the app runtime owns, for a test
 * that mounts a surface without the root component.
 */
export function installCloseWindowKeys() {
  const onKeydown = (event: KeyboardEvent) =>
    useCloseWindowStore().handleKeydown(event)
  window.addEventListener('keydown', onKeydown, true)
  onTestFinished(() => window.removeEventListener('keydown', onKeydown, true))
}
