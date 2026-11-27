import { onMounted, onUnmounted } from 'vue'

import type { ModeStep } from '../lib/diff/diff-model'
import { isTextEntryTarget } from '../lib/ui/text-entry-target'

const ARROW_STEPS: Record<string, ModeStep> = { ArrowLeft: -1, ArrowRight: 1 }

/**
 * Shift+←/→ pick the previous or the next view mode of a result; the plain
 * arrows are left to the action pages.
 */
export function useViewModeArrowKeys(
  step: (step: ModeStep) => void,
  isAvailable: () => boolean = () => true
) {
  function handleKeyDown(event: KeyboardEvent) {
    const modeStep = ARROW_STEPS[event.key]
    if (
      !modeStep ||
      event.defaultPrevented ||
      event.isComposing ||
      !isAvailable()
    )
      return
    if (!event.shiftKey || event.ctrlKey || event.altKey || event.metaKey)
      return
    if (isTextEntryTarget(event.target)) return
    event.preventDefault()
    step(modeStep)
  }
  onMounted(() => window.addEventListener('keydown', handleKeyDown))
  onUnmounted(() => window.removeEventListener('keydown', handleKeyDown))
}
