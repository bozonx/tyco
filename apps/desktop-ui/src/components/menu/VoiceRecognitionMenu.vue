<template>
  <ActionOverlayLayout :title="t('menu.voiceRecognition')">
    <template #header-extra>
      <p v-if="statusText" class="voice-status">
        <span class="voice-dot" :class="{ 'is-live': isStarted }" />
        {{ statusText }}
      </p>
    </template>

    <template #preview>
      <AudioWaveform
        v-if="!recognizedText"
        :level="audioLevel"
        :peak="audioPeak"
        :duration-ms="recordingDurationMs"
        :max-duration-ms="MAX_RECORDING_MS"
        :is-live="isStarted"
        :is-transcribing="isTranscribing"
      />
      <TextPreview v-else :text="recognizedText" />
    </template>

    <template #actions>
      <div class="voice-shortcuts">
        <ShortcutButton
          :keys="['Space', 'Enter']"
          icon="mdi:check"
          primary
          :disabled="isFinishing"
          @click="() => finish()"
        >
          {{ isFinishing ? t('common.inProgress') : t('menu.finish') }}
        </ShortcutButton>
        <ShortcutButton
          :keys="['Tab']"
          icon="mdi:pencil-outline"
          :disabled="isFinishing"
          @click="goToEditor"
        >
          {{ t('shortcuts.insertIntoEditor') }}
        </ShortcutButton>
        <ShortcutButton
          :keys="['Esc']"
          icon="mdi:close"
          :disabled="isCancelling"
          @click="cancel"
        >
          {{ t('common.cancel') }}
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
import { createVoiceSession } from '../../lib/stt/voice-session'
import { useHistoryStore } from '../../stores/history'
import { useIpcStore } from '../../stores/ipc'
import { useMenuModalsStore } from '../../stores/menuModals'
import { useQuickDismissStore } from '../../stores/quickDismiss'
import { useRouteParams } from '../../stores/routeParams'
import ActionOverlayLayout from '../common/ActionOverlayLayout.vue'
import AudioWaveform from '../voice/AudioWaveform.vue'
import { DESKTOP_EVENTS } from '@tyco/shared'

const props = defineProps<{
  onCorrected?: (
    resultText: string,
    recognizedText: string,
    correctedText?: string
  ) => void
  onCancel?: () => void
}>()

const emit = defineEmits<{
  (
    e: 'corrected',
    resultText: string,
    recognizedText: string,
    correctedText?: string
  ): void
  (e: 'cancelled'): void
}>()

const {
  cancelVoiceRecognition,
  shouldFormatRecognizedText,
  startVoiceRecognition,
  stopVoiceRecognition,
  voiceCorrection,
} = useCallAi()
const { globalEvents } = useGlobalEvents()
const { toast } = useToast()
const { t } = useI18n()
const ipcStore = useIpcStore()
const historyStore = useHistoryStore()
const menuModalsStore = useMenuModalsStore()
const routeParamsStore = useRouteParams()
// a click elsewhere must not cut a dictation short
const releaseDismissHold = useQuickDismissStore().hold()

const recognizedText = ref('')
const isFinishing = ref(false)
const isCancelling = ref(false)
const isStarted = ref(false)
const isTranscribing = ref(false)
const audioLevel = ref(0)
const audioPeak = ref(0)
const recordingDurationMs = ref(0)

let recordingTimer: ReturnType<typeof setInterval> | undefined
let unlistenAudioLevel: (() => void) | undefined
let unlistenStreamError: (() => void) | undefined
let keyUpHandlerIndex = -1
let sessionGeneration = 0
let starting: Promise<void> | undefined
const MAX_RECORDING_MS = 300_000

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
    void finish()
  },
})

const statusText = computed(() => {
  if (isTranscribing.value) {
    return t('menu.transcribing')
  }

  if (isStarted.value) {
    return t('menu.listening')
  }

  return ''
})

function notifyCancelled() {
  props.onCancel?.()
  emit('cancelled')
}

const cancel = async () => {
  if (isCancelling.value) return
  isCancelling.value = true
  sessionGeneration += 1
  stopRecordingTimer()
  voiceSession.abort()

  try {
    await starting
    await cancelVoiceRecognition()
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

const finish = async (toEditor = false) => {
  if (isFinishing.value || isCancelling.value) {
    return
  }

  isFinishing.value = true
  stopRecordingTimer()
  voiceSession.stopTimer()

  try {
    await starting
    if (!isStarted.value || voiceSession.signal?.aborted) return
    isTranscribing.value = true
    const transcription = await stopVoiceRecognition(voiceSession.signal)
    const finalRecognizedText = transcription.text
    isStarted.value = false
    isTranscribing.value = false

    if (transcription.limitReached) {
      toast(t('toast.recordingLimitReached'), 'warn')
    }

    if (finalRecognizedText) {
      recognizedText.value = finalRecognizedText
    }

    if (!recognizedText.value.trim()) {
      toast(t('toast.nothingRecognized'), 'warn')
      notifyCancelled()
      return
    }

    if (toEditor) {
      routeParamsStore.toEditor(recognizedText.value)
      return
    }

    let resultText = recognizedText.value
    let correctedText: string | undefined

    if (shouldFormatRecognizedText()) {
      // the raw transcript is the only copy of what was said: the LLM may
      // distort it, and it cannot be dictated the same way twice
      const sourceId = await historyStore.saveSource(
        recognizedText.value,
        'voice-correction'
      )
      menuModalsStore.setPendingModal({ correction: true })

      try {
        const formattedText = await voiceCorrection(
          recognizedText.value,
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
      props.onCorrected?.(resultText, recognizedText.value, correctedText)
      emit('corrected', resultText, recognizedText.value, correctedText)
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

function goToEditor() {
  if (isFinishing.value) return
  void finish(true)
}

function handleKeyUp(event: KeyboardEvent) {
  if (event.defaultPrevented) return

  // Esc cancels the whole dictation and closes the quick window, never a step back
  if (event.code === 'Escape') {
    event.preventDefault()
    void cancel()
    return
  }

  if (event.code === 'Tab') {
    event.preventDefault()
    goToEditor()
    return
  }

  if (event.code === 'Space' || event.code === 'Enter') {
    void finish()
  }
}

async function startSession() {
  if (isStarted.value || isFinishing.value || starting) return
  recognizedText.value = ''
  const generation = ++sessionGeneration
  starting = (async () => {
    try {
      await startVoiceRecognition()
      if (generation !== sessionGeneration) {
        await cancelVoiceRecognition()
        return
      }
      voiceSession.begin()
      startRecordingTimer()
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

  unlistenAudioLevel = await desktopClient.listen(
    DESKTOP_EVENTS.VOICE_AUDIO_LEVEL,
    (payload) => {
      audioLevel.value = payload.level
      audioPeak.value = payload.peak
    }
  )

  unlistenStreamError = await desktopClient.listen(
    DESKTOP_EVENTS.VOICE_STREAM_ERROR,
    (errorMessage) => {
      toast(errorMessage || t('menu.micError'), 'error')
      void cancel()
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
  unlistenStreamError?.()

  if (keyUpHandlerIndex >= 0) {
    globalEvents.removeListener(keyUpHandlerIndex)
    keyUpHandlerIndex = -1
  }

  void (async () => {
    await starting
    await cancelVoiceRecognition()
  })().catch(() => undefined)
})
</script>

<style scoped>
.voice-status {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin: 0;
  font-size: 0.8125rem;
  color: var(--app-text-muted);
}

.voice-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
  background-color: var(--app-text-faint);
}

.voice-dot.is-live {
  background-color: var(--color-error);
  animation: voice-pulse 1.2s ease-in-out infinite;
}

.voice-shortcuts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--space-sm);
}

@keyframes voice-pulse {
  50% {
    opacity: 0.35;
  }
}
</style>
