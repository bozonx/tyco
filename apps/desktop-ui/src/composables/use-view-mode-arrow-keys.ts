import { onMounted, onUnmounted } from 'vue'

import type { ModeStep } from '../lib/diff/diff-model'

const ARROW_STEPS: Record<string, ModeStep> = { ArrowLeft: -1, ArrowRight: 1 }

/** A field keeps the arrows for moving its caret. */
function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  )
}

/** ←/→ pick the previous or the next view mode of a result. */
export function useViewModeArrowKeys(step: (step: ModeStep) => void) {
  function handleKeyDown(event: KeyboardEvent) {
    const modeStep = ARROW_STEPS[event.key]
    if (!modeStep || event.defaultPrevented) return
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return
    if (isTextInput(event.target)) return
    event.preventDefault()
    step(modeStep)
  }
  onMounted(() => window.addEventListener('keydown', handleKeyDown))
  onUnmounted(() => window.removeEventListener('keydown', handleKeyDown))
}
