<template>
  <component
    :is="props.variant === 'bar' ? VoiceRecordingBar : VoiceRecordingSheet"
    :transcript="transcript"
    :audio-level="audioLevel"
    :audio-peak="audioPeak"
    :recording-duration-ms="recordingDurationMs"
    :is-transcribing="isTranscribing"
    :is-finishing="isFinishing"
    :quick-send="props.quickSend"
    :with-next="props.withNext"
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
import {
  GlobalEvents,
  useGlobalEvents,
} from '../../composables/use-global-events'
import { useI18n } from '../../composables/use-i18n'
import { useLlmActions } from '../../composables/use-llm-actions'
import useToast from '../../composables/use-toast'
import { desktopClient } from '../../lib/desktop/client'
import type { VoiceMenuParams } from '../../lib/modals/menu-modal-params'
import type { VoiceFinishIntent } from '../../lib/stt/voice-finish-intent'
import { createVoiceRecognition } from '../../lib/stt/voice-recognition'
import { useHistoryStore } from '../../stores/history'
import { useIpcStore } from '../../stores/ipc'
import { useMenuModalsStore } from '../../stores/menu-modals'
import { useQuickDismissStore } from '../../stores/quick-dismiss'
import VoiceRecordingBar from '../voice/VoiceRecordingBar.vue'
import VoiceRecordingSheet from '../voice/VoiceRecordingSheet.vue'
import { DESKTOP_EVENTS } from '@tyco/shared'

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
const { voiceCorrection } = useLlmActions()
const { globalEvents } = useGlobalEvents()
const { toast, toastText } = useToast()
const { t } = useI18n()
const ipcStore = useIpcStore()
let sessionActivationId = ipcStore.desktopState.activationId
const ownsActivation = () =>
  sessionActivationId === ipcStore.desktopState.activationId &&
  ipcStore.desktopState.isWindowShown
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
  onCorrected: (result, recognized, corrected, intent) => {
    if (ownsActivation())
      emit('corrected', result, recognized, corrected, intent)
  },
  t,
  toast,
  toastText,
})
const {
  transcript,
  isFinishing,
  isStarted,
  isTranscribing,
  audioLevel,
  audioPeak,
  recordingDurationMs,
  cancel,
  finish,
  startSession,
} = model
let unlistenAudioLevel: (() => void) | undefined
let keyUpHandlerIndex = -1
let submitHandlerIndex = -1
let unmounted = false

function handleKeyUp(event: KeyboardEvent) {
  if (event.defaultPrevented) return

  // Esc cancels the whole dictation and closes the quick window, never a step back
  if (event.code === 'Escape') {
    event.preventDefault()
    void cancel()
    return
  }

  if ((event.ctrlKey || event.metaKey) && event.code === 'Enter') {
    event.preventDefault()
    void finish('submit')
    return
  }

  // as in a chat input, Shift+Enter keeps the text without sending it
  if (props.quickSend && event.shiftKey && event.code === 'Enter') {
    event.preventDefault()
    void finish('insert')
    return
  }

  if ((props.quickSend || props.withNext) && event.code === 'Tab') {
    event.preventDefault()
    void finish('next')
    return
  }

  if (event.code === 'Space' || event.code === 'Enter') {
    void finish(props.quickSend ? 'submit' : 'insert')
  }
}

function handleKeyDown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.code === 'Enter') {
    event.preventDefault()
    void finish('submit')
    return
  }

  // Tab finishes the dictation; it must not move the focus first
  if ((props.quickSend || props.withNext) && event.code === 'Tab') {
    event.preventDefault()
  }
}

watch(
  () => ipcStore.desktopState.activationId,
  async (activationId) => {
    if (!ipcStore.desktopState.isWindowShown) return
    sessionActivationId = activationId
    await model.restartSession()
  }
)

watch(
  () => ipcStore.desktopState?.isWindowShown,
  (isShown) => {
    if (isShown) {
      sessionActivationId = ipcStore.desktopState.activationId
      void startSession()
    } else {
      if ((isStarted.value || model.isStarting()) && !isFinishing.value) {
        void cancel()
      }
    }
  }
)

onMounted(async () => {
  keyUpHandlerIndex = globalEvents.addListener(GlobalEvents.KEY_UP, handleKeyUp)
  submitHandlerIndex = globalEvents.addListener(
    GlobalEvents.VOICE_SUBMIT,
    () => {
      void finish('submit')
    }
  )
  window.addEventListener('keydown', handleKeyDown)

  // the level meter is decoration: the dictation must not wait for it, nor
  // fail with it
  void desktopClient
    .listen(DESKTOP_EVENTS.VOICE_AUDIO_LEVEL, (payload) => {
      audioLevel.value = payload.level
      audioPeak.value = payload.peak
    })
    .then((unlisten) => {
      if (unmounted) unlisten()
      else unlistenAudioLevel = unlisten
    })
    .catch(() => undefined)

  if (ipcStore.desktopState?.isWindowShown !== false) {
    await startSession()
  }
})

onUnmounted(() => {
  unmounted = true
  releaseDismissHold()
  model.dispose()

  unlistenAudioLevel?.()

  if (keyUpHandlerIndex >= 0) {
    globalEvents.removeListener(keyUpHandlerIndex)
    keyUpHandlerIndex = -1
  }
  if (submitHandlerIndex >= 0) {
    globalEvents.removeListener(submitHandlerIndex)
    submitHandlerIndex = -1
  }
  window.removeEventListener('keydown', handleKeyDown)
})
</script>
