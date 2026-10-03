<template>
  <ActionOverlayLayout
    :title="quickSend ? t('menu.voiceChat') : t('menu.voiceInput')"
    :onEsc="cancel"
  >
    <template #preview>
      <AudioWaveform
        :level="audioLevel"
        :peak="audioPeak"
        :duration-ms="recordingDurationMs"
        :is-transcribing="isTranscribing"
      />
      <LiveTranscript
        :committed="transcript.committed"
        :draft="transcript.draft"
      />
    </template>

    <template #actions>
      <div class="voice-shortcuts">
        <ShortcutButton
          v-if="quickSend"
          :keys="submitKeys"
          icon="mdi:send"
          primary
          :disabled="isFinishing"
          @click="() => finish('submit')"
        >
          {{ isFinishing ? t('common.inProgress') : t('menu.voiceSend') }}
        </ShortcutButton>
        <ShortcutButton
          v-if="quickSend"
          :keys="['Tab']"
          icon="mdi:form-textbox"
          :disabled="isFinishing"
          @click="() => finish('insert')"
        >
          {{ t('menu.voiceToInput') }}
        </ShortcutButton>
        <ShortcutButton
          v-else
          :keys="['Space', 'Enter']"
          icon="mdi:check"
          primary
          :disabled="isFinishing"
          @click="() => finish('insert')"
        >
          {{ isFinishing ? t('common.inProgress') : t('menu.finish') }}
        </ShortcutButton>
      </div>
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { useCallAi } from '../../composables/useCallAi'
import {
  GlobalEvents,
  useGlobalEvents,
} from '../../composables/useGlobalEvents'
import { useI18n } from '../../composables/useI18n'
import useToast from '../../composables/useToast'
import { desktopClient } from '../../lib/desktop/client'
import {
  createLiveTranscriptState,
  liveTranscriptText,
} from '../../lib/stt/live-transcript'
import type { VoiceFinishIntent } from '../../lib/stt/voice-finish-intent'
import { createVoiceSession } from '../../lib/stt/voice-session'
import { useHistoryStore } from '../../stores/history'
import { useIpcStore } from '../../stores/ipc'
import { useMenuModalsStore } from '../../stores/menuModals'
import { useQuickDismissStore } from '../../stores/quickDismiss'
import ActionOverlayLayout from '../common/ActionOverlayLayout.vue'
import AudioWaveform from '../voice/AudioWaveform.vue'
import LiveTranscript from '../voice/LiveTranscript.vue'
import { DESKTOP_EVENTS } from '@tyco/shared'

type CorrectedHandler = (
  resultText: string,
  recognizedText: string,
  correctedText: string | undefined,
  intent: VoiceFinishIntent
) => void

const props = defineProps<{
  onCorrected?: CorrectedHandler | CorrectedHandler[]
  onCancel?: (() => void) | (() => void)[]
  /**
   * The result is sent right away: Enter, Space and the voice chat hotkey
   * submit it, Tab only inserts it
   */
  quickSend?: boolean
}>()

const emit = defineEmits<{
  (
    e: 'corrected',
    resultText: string,
    recognizedText: string,
    correctedText: string | undefined,
    intent: VoiceFinishIntent
  ): void
  (e: 'cancelled'): void
}>()

const {
  cancelDictation,
  finishDictation,
  shouldFormatRecognizedText,
  startDictation,
  voiceCorrection,
} = useCallAi()
const { globalEvents } = useGlobalEvents()
const { toast, toastText } = useToast()
const { t } = useI18n()
const ipcStore = useIpcStore()
const historyStore = useHistoryStore()
const menuModalsStore = useMenuModalsStore()
// a click elsewhere must not cut a dictation short
const releaseDismissHold = useQuickDismissStore().hold()

const transcript = ref(createLiveTranscriptState())
const hasText = computed(() => Boolean(liveTranscriptText(transcript.value)))
const isFinishing = ref(false)
const isCancelling = ref(false)
const isStarted = ref(false)
const isTranscribing = ref(false)
const audioLevel = ref(0)
const audioPeak = ref(0)
const recordingDurationMs = ref(0)
const submitKeys = computed(() => {
  const hotkey = ipcStore.params?.userConfig?.hotkeys?.voiceChat
  return hotkey ? ['Enter', 'Space', hotkey] : ['Enter', 'Space']
})

let recordingTimer: ReturnType<typeof setInterval> | undefined
let unlistenAudioLevel: (() => void) | undefined
let keyUpHandlerIndex = -1
let submitHandlerIndex = -1
let sessionGeneration = 0
let starting: Promise<void> | undefined
/** Set once a dictation started; it stays finishable after a failure */
let hasSession = false
// Silence is billed too: a forgotten dictation must not run all day
const MAX_RECORDING_MS = 3_600_000

function startRecordingTimer() {
  recordingDurationMs.value = 0
  const startTime = Date.now()
  if (recordingTimer !== undefined) {
    clearInterval(recordingTimer)
  }
  recordingTimer = setInterval(() => {
    recordingDurationMs.value = Date.now() - startTime
  }, 100)
}

function stopRecordingTimer() {
  if (recordingTimer !== undefined) {
    clearInterval(recordingTimer)
    recordingTimer = undefined
  }
  audioLevel.value = 0
  audioPeak.value = 0
}

const voiceSession = createVoiceSession({
  maxRecordingMs: MAX_RECORDING_MS,
  onLimit: () => {
    toast(t('toast.recordingLimitReached'), 'warn')
    void finish()
  },
})

function invokeCallback<Args extends unknown[]>(
  callback: ((...args: Args) => void) | ((...args: Args) => void)[] | undefined,
  ...args: Args
) {
  if (typeof callback === 'function') {
    callback(...args)
  } else if (Array.isArray(callback)) {
    for (const fn of callback) {
      if (typeof fn === 'function') {
        fn(...args)
      }
    }
  }
}

function notifyCancelled() {
  invokeCallback(props.onCancel)
  emit('cancelled')
}

const cancel = async () => {
  if (isCancelling.value) return
  isCancelling.value = true
  sessionGeneration += 1
  hasSession = false
  stopRecordingTimer()
  voiceSession.abort()

  try {
    await starting
    await cancelDictation()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    toast(message || t('toast.voiceRecognitionFailed'), 'error')
  } finally {
    isStarted.value = false
    isTranscribing.value = false
    isFinishing.value = false
    isCancelling.value = false
    notifyCancelled()
  }
}

const finish = async (intent: VoiceFinishIntent = 'insert') => {
  if (isFinishing.value || isCancelling.value) {
    return
  }

  isFinishing.value = true
  stopRecordingTimer()
  voiceSession.stopTimer()

  try {
    await starting
    if (!hasSession || voiceSession.signal?.aborted) return
    hasSession = false
    isTranscribing.value = true
    // the provider's last words arrive after the microphone is off
    const recognizedText = await finishDictation()
    isStarted.value = false
    isTranscribing.value = false

    if (!recognizedText.trim()) {
      toast(t('toast.nothingRecognized'), 'warn')
      notifyCancelled()
      return
    }

    let resultText = recognizedText
    let correctedText: string | undefined

    if (shouldFormatRecognizedText()) {
      // the raw transcript is the only copy of what was said: the LLM may
      // distort it, and it cannot be dictated the same way twice
      const sourceId = await historyStore.saveSource(
        recognizedText,
        'voice-correction'
      )
      menuModalsStore.setPendingModal({ correction: true })

      try {
        const formattedText = await voiceCorrection(
          recognizedText,
          voiceSession.signal
        )

        if (formattedText.trim()) {
          resultText = formattedText
          correctedText = formattedText
          await historyStore
            .saveSourceResult(sourceId, formattedText)
            .catch(() => {
              toast(t('history.operationFailed'), 'error')
            })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        toast(message || t('menu.correction'), 'error')
      } finally {
        menuModalsStore.clearPendingModal()
      }
    }

    if (!voiceSession.signal?.aborted) {
      emit('corrected', resultText, recognizedText, correctedText, intent)
    }
  } catch (error) {
    if (!voiceSession.signal?.aborted) {
      const message = error instanceof Error ? error.message : String(error)
      toast(message || t('toast.voiceRecognitionFailed'), 'error')
      notifyCancelled()
    }
  } finally {
    isStarted.value = false
    isTranscribing.value = false
    isFinishing.value = false
  }
}

/** The microphone or the provider failed mid-dictation; the text so far is kept */
function handleSessionError(error: Error) {
  if (voiceSession.signal?.aborted) return
  stopRecordingTimer()
  voiceSession.stopTimer()
  isStarted.value = false

  if (!hasText.value) {
    hasSession = false
    toast(error.message || t('toast.voiceRecognitionFailed'), 'error')
    voiceSession.abort()
    notifyCancelled()
    return
  }

  toastText(`${error.message}\n${t('menu.dictationInterrupted')}`, 'error')
}

function handleKeyUp(event: KeyboardEvent) {
  if (event.defaultPrevented) return

  // Esc cancels the whole dictation and closes the quick window, never a step back
  if (event.code === 'Escape') {
    event.preventDefault()
    void cancel()
    return
  }

  if (props.quickSend && event.code === 'Tab') {
    event.preventDefault()
    void finish('insert')
    return
  }

  if (event.code === 'Space' || event.code === 'Enter') {
    void finish(props.quickSend ? 'submit' : 'insert')
  }
}

function handleKeyDown(event: KeyboardEvent) {
  // Tab finishes the quick dictation; it must not move the focus first
  if (props.quickSend && event.code === 'Tab') event.preventDefault()
}

async function startSession() {
  if (isStarted.value || isFinishing.value || starting) return
  transcript.value = createLiveTranscriptState()
  const generation = ++sessionGeneration
  starting = (async () => {
    try {
      await startDictation({
        onText: (state) => {
          if (generation === sessionGeneration) transcript.value = state
        },
        // a fast failure must not overtake the start it belongs to
        onError: (error) => {
          void Promise.resolve(starting).then(() => {
            if (generation === sessionGeneration) handleSessionError(error)
          })
        },
      })
      if (generation !== sessionGeneration) {
        await cancelDictation()
        return
      }
      voiceSession.begin()
      startRecordingTimer()
      hasSession = true
      isStarted.value = true
    } catch (error) {
      if (generation !== sessionGeneration) return
      const message = error instanceof Error ? error.message : String(error)
      toast(message || t('toast.voiceRecognitionFailed'), 'error')
      voiceSession.abort()
      notifyCancelled()
    }
  })().finally(() => {
    starting = undefined
  })
  await starting
}

watch(
  () => ipcStore.params?.isWindowShown,
  (isShown) => {
    if (isShown) {
      void startSession()
    } else {
      if ((isStarted.value || starting) && !isFinishing.value) {
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

  unlistenAudioLevel = await desktopClient.listen(
    DESKTOP_EVENTS.VOICE_AUDIO_LEVEL,
    (payload) => {
      audioLevel.value = payload.level
      audioPeak.value = payload.peak
    }
  )

  if (ipcStore.params?.isWindowShown !== false) {
    await startSession()
  }
})

onUnmounted(() => {
  releaseDismissHold()
  sessionGeneration += 1
  stopRecordingTimer()
  voiceSession.dispose()

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

  void (async () => {
    await starting
    await cancelDictation()
  })().catch(() => undefined)
})
</script>

<style scoped>
.voice-shortcuts {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
</style>
