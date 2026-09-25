<template>
  <ActionOverlayLayout :title="t('menu.voiceRecognition')">
    <template #header-extra>
      <p v-if="statusText" class="voice-status">
        <span class="voice-dot" :class="{ 'is-live': isStarted }" />
        {{ statusText }}
      </p>
    </template>

    <template #preview>
      <TextPreview :text="recognizedText" />
    </template>

    <template #actions>
      <div class="voice-shortcuts">
        <ShortcutButton
          :keys="['Space', 'Enter']"
          icon="mdi:check"
          primary
          :disabled="isFinishing"
          @click="finish"
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
          :disabled="isCancelling || isFinishing"
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
import { createVoiceSession } from '../../lib/stt/voice-session'
import { useHistoryStore } from '../../stores/history'
import { useIpcStore } from '../../stores/ipc'
import { useMenuModalsStore } from '../../stores/menuModals'
import { useRouteParams } from '../../stores/routeParams'
import ActionOverlayLayout from '../common/ActionOverlayLayout.vue'

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

const recognizedText = ref('')
const isFinishing = ref(false)
const isCancelling = ref(false)
const isStarted = ref(false)
const isTranscribing = ref(false)

let keyUpHandlerIndex = -1
const MAX_RECORDING_MS = 300_000
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
  if (isCancelling.value || isFinishing.value) return
  isCancelling.value = true
  voiceSession.abort()

  try {
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

const finish = async () => {
  if (isFinishing.value || isCancelling.value) {
    return
  }

  isFinishing.value = true
  voiceSession.stopTimer()

  try {
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
  voiceSession.abort()
  void cancelVoiceRecognition().catch(() => undefined)
  routeParamsStore.toEditor(recognizedText.value)
}

function handleKeyUp(event: KeyboardEvent) {
  if (event.defaultPrevented) return

  if (event.code === 'Escape') {
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
  if (isStarted.value || isFinishing.value) return
  recognizedText.value = ''
  try {
    await startVoiceRecognition()
    voiceSession.begin()
    isStarted.value = true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    toast(message || t('toast.voiceRecognitionFailed'), 'error')
    voiceSession.abort()
    notifyCancelled()
  }
}

watch(
  () => [ipcStore.params?.isWindowShown, ipcStore.params?.mode],
  ([isShown, mode]) => {
    if (isShown && mode === 'voice') {
      void startSession()
    } else {
      if (isStarted.value && !isFinishing.value) {
        void cancel()
      }
    }
  }
)

onMounted(async () => {
  keyUpHandlerIndex = globalEvents.addListener(GlobalEvents.KEY_UP, handleKeyUp)

  if (ipcStore.params?.isWindowShown && ipcStore.params?.mode === 'voice') {
    await startSession()
  }
})

onUnmounted(() => {
  voiceSession.dispose()

  if (keyUpHandlerIndex >= 0) {
    globalEvents.removeListener(keyUpHandlerIndex)
    keyUpHandlerIndex = -1
  }

  void cancelVoiceRecognition().catch(() => undefined)
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
