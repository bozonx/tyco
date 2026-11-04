import { createVoiceResultStep } from '../lib/stt/voice-result-step'
import { useVoiceFinishSignal } from './use-voice-finish-signal'

/** `step` is a shared one that outlives the screen; a new one by default */
export function useVoiceResultStep(
  activationMode: () => string | undefined,
  step: ReturnType<typeof createVoiceResultStep> = createVoiceResultStep()
) {
  // past the dictation, its hotkey starts a new one, as it did before
  useVoiceFinishSignal(
    () => (step.isInsertMenuVisible.value ? activationMode() : undefined),
    step.resetResult
  )

  return step
}
