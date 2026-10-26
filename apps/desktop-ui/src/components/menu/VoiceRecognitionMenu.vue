<template>
  <component
    :is="props.variant === 'bar' ? VoiceRecordingBar : VoiceRecordingSheet"
    :transcript="transcript"
    :audio-level="audioLevel"
    :audio-peak="audioPeak"
    :recording-duration-ms="recordingDurationMs"
    :is-transcribing="isTranscribing"
    :is-finishing="isFinishing"
    :finish-behavior="props.finishBehavior"
    :finish-hotkey="finishHotkey"
    :chat="props.chat"
    :prefix="props.prefix"
    :suffix="props.suffix"
    :context="props.context"
    :finish="finish"
    :cancel="cancel"
    @remove-context="emit('removeContext')"
  />
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'

import { useDictationActions } from '../../composables/use-dictation-actions'
import { useDismissibleLayer } from '../../composables/use-dismissible-layer'
import { useI18n } from '../../composables/use-i18n'
import useToast from '../../composables/use-toast'
import { useVoiceFinishSignal } from '../../composables/use-voice-finish-signal'
import { useVoiceRecordingMeter } from '../../composables/use-voice-recording-meter'
import type { VoiceMenuParams } from '../../lib/modals/menu-modal-params'
import type { VoiceFinishIntent } from '../../lib/stt/voice-finish-intent'
import { createVoiceRecognition } from '../../lib/stt/voice-recognition'
import { createKeyPressTracker } from '../../lib/ui/key-press-tracker'
import { useDesktopStore } from '../../stores/desktop'
import { useHistoryStore } from '../../stores/history'
import { useLlmStore } from '../../stores/llm'
import { useMenuModalsStore } from '../../stores/menu-modals'
import { useQuickDismissStore } from '../../stores/quick-dismiss'
import VoiceRecordingBar from '../voice/VoiceRecordingBar.vue'
import VoiceRecordingSheet from '../voice/VoiceRecordingSheet.vue'

const props = defineProps<VoiceMenuParams>()
const emit = defineEmits<{
  (
    e: 'corrected',
    resultText: string,
    recognizedText: string,
    correctedText: string | undefined,
    intent: VoiceFinishIntent
  ): void
  (e: 'cancelled'): void
  (e: 'removeContext'): void
}>()

const {
  cancelDictation,
  finishDictation,
  shouldFormatRecognizedText,
  startDictation,
} = useDictationActions()
const { voiceCorrection } = useLlmStore().actions
const { toastKey, toastText } = useToast()
const { t } = useI18n()
const desktopStore = useDesktopStore()
let sessionActivationId = desktopStore.desktopState.activationId
const isSameActivation = () =>
  sessionActivationId === desktopStore.desktopState.activationId
const ownsActivation = () =>
  isSameActivation() && desktopStore.desktopState.isWindowShown
const historyStore = useHistoryStore()
const menuModalsStore = useMenuModalsStore()
// a click elsewhere must not cut a dictation short
const releaseDismissHold = useQuickDismissStore().hold()

function invokeCallback<Args extends unknown[]>(
  callback: ((...args: Args) => void) | ((...args: Args) => void)[] | undefined,
  ...args: Args
) {
  if (typeof callback === 'function') callback(...args)
  else if (Array.isArray(callback)) callback.forEach((fn) => fn(...args))
}
const model = createVoiceRecognition({
  startDictation,
  finishDictation,
  cancelDictation,
  shouldFormatRecognizedText,
  voiceCorrection,
  saveSource: (text, action) => historyStore.saveSource(text, action),
  saveSourceResult: (id, text) => historyStore.saveSourceResult(id, text),
  setPendingModal: (options) => menuModalsStore.setPendingModal(options),
  clearPendingModal: (owner) => menuModalsStore.clearPendingModal(owner),
  options: () => props,
  onCancelled: () => {
    if (!ownsActivation()) return
    invokeCallback(props.onCancel)
    emit('cancelled')
  },
  // the text is delivered even if the window was hidden while it was being
  // transcribed or corrected: it cannot be dictated the same way twice
  onCorrected: (result, recognized, corrected, intent) => {
    if (isSameActivation())
      emit('corrected', result, recognized, corrected, intent)
  },
  t,
  toastKey,
  toastText,
})
const {
  transcript,
  isFinishing,
  isStarted,
  isTranscribing,
  cancel,
  finish,
  startSession,
} = model
/** What Space and Enter do: send the question to the chat, or insert the text */
const primaryIntent = (): VoiceFinishIntent =>
  props.finishBehavior === 'submitToChat' ? 'submit' : 'insert'
const finishHotkey = useVoiceFinishSignal(
  () => props.activationMode,
  () => {
    if (ownsActivation()) void finish(primaryIntent())
  }
)
const { audioLevel, audioPeak, recordingDurationMs } = useVoiceRecordingMeter(
  () => isStarted.value
)

useDismissibleLayer({
  isOpen: ownsActivation,
  elements: () => [],
  canDismissOutside: false,
  dismiss: () => {
    void cancel()
  },
})

// Enter on the button that opened this input, or a hotkey with Space, ends
// with a keyup here that must not finish the dictation it just started
const keyPresses = createKeyPressTracker()
const trackKeyDown = (event: KeyboardEvent) => keyPresses.press(event.code)
const forgetKeys = () => keyPresses.clear()

function handleKeyUp(event: KeyboardEvent) {
  if (!keyPresses.release(event.code)) return
  if (event.defaultPrevented) return

  if ((event.ctrlKey || event.metaKey) && event.code === 'Enter') {
    event.preventDefault()
    void finish('submit')
    return
  }

  // as in a chat input, Shift+Enter keeps the text without sending it
  if (
    props.finishBehavior === 'submitToChat' &&
    event.shiftKey &&
    event.code === 'Enter'
  ) {
    event.preventDefault()
    void finish('insert')
    return
  }

  if (
    (props.finishBehavior === 'submitToChat' ||
      props.finishBehavior === 'insertIntoTarget') &&
    event.code === 'Tab'
  ) {
    event.preventDefault()
    void finish('next')
    return
  }

  if (event.code === 'Space' || event.code === 'Enter') {
    void finish(primaryIntent())
  }
}

function handleKeyDown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.code === 'Enter') {
    event.preventDefault()
    void finish('submit')
    return
  }

  // Tab finishes the dictation; it must not move the focus first
  if (
    (props.finishBehavior === 'submitToChat' ||
      props.finishBehavior === 'insertIntoTarget') &&
    event.code === 'Tab'
  ) {
    event.preventDefault()
  }
}

watch(
  () => desktopStore.desktopState.activationId,
  async (activationId) => {
    if (!desktopStore.desktopState.isWindowShown) return
    sessionActivationId = activationId
    await model.restartSession()
  }
)

watch(
  () => desktopStore.desktopState?.isWindowShown,
  (isShown) => {
    if (isShown) {
      sessionActivationId = desktopStore.desktopState.activationId
      void startSession()
    } else {
      if ((isStarted.value || model.isStarting()) && !isFinishing.value) {
        void cancel()
      }
    }
  }
)

onMounted(async () => {
  // on the document, so it runs before the nav panel's Esc handler on the window
  document.addEventListener('keyup', handleKeyUp)
  // capture: a handler that stops the keydown must not hide it from tracking
  document.addEventListener('keydown', trackKeyDown, true)
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('blur', forgetKeys)

  if (desktopStore.desktopState?.isWindowShown !== false) {
    await startSession()
  }
})

onUnmounted(() => {
  releaseDismissHold()
  model.dispose()

  document.removeEventListener('keyup', handleKeyUp)
  document.removeEventListener('keydown', trackKeyDown, true)
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('blur', forgetKeys)
})
</script>
