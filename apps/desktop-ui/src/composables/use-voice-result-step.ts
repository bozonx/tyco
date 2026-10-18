import { createVoiceResultStep } from '../lib/stt/voice-result-step'
import { useVoiceFinishSignal } from './use-voice-finish-signal'

export function useVoiceResultStep(activationMode: () => string | undefined) {
  const step = createVoiceResultStep()

  // past the dictation, its hotkey starts a new one, as it did before
  useVoiceFinishSignal(
    () => (step.isInsertMenuVisible.value ? activationMode() : undefined),
    step.resetResult
  )

  return step
}
