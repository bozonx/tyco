<template>
  <div class="flex flex-col gap-4 w-full h-full">
    <h1>{{ t('menu.voiceRecognition') }}</h1>

    <div class="flex-1 flex flex-col gap-2 min-h-0">
      <p v-if="statusText" class="voice-status">
        <span class="voice-dot" :class="{ 'is-live': isStarted }" />
        {{ statusText }}
      </p>
      <div class="flex-1 min-h-0">
        <TextPreview :text="recognizedText" />
      </div>
    </div>

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
        :disabled="isFinishing"
        @click="cancel"
      >
        {{ t('common.cancel') }}
      </ShortcutButton>
    </div>
  </div>
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
import { useHistoryStore } from '../../stores/history'
import { useIpcStore } from '../../stores/ipc'
import { useMenuModalsStore } from '../../stores/menuModals'
import { useRouteParams } from '../../stores/routeParams'

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
  getVoiceRecognitionRuntime,
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
const lastRecognizedTextMs = ref(0)
const isFinishing = ref(false)
const isStarted = ref(false)
const isTranscribing = ref(false)
const appConfig = computed(() => ipcStore.params.appConfig)
const voiceRuntime = computed(() => getVoiceRecognitionRuntime())

let voiceListenerIndex = -1
let keyUpHandlerIndex = -1

const statusText = computed(() => {
  if (isTranscribing.value) {
    return t('menu.transcribing')
  }

  if (isStarted.value) {
    return t('menu.listening')
  }

  return ''
})

async function waitForStreamingRecognition() {
  if (!voiceRuntime.value.streaming) {
    return
  }

  if (!lastRecognizedTextMs.value) {
    await new Promise((resolve) =>
      setTimeout(resolve, appConfig.value.recognitionWaitTimeSec * 1000)
    )
    return
  }

  const elapsedMs = Date.now() - lastRecognizedTextMs.value
  const remainingMs = appConfig.value.recognitionWaitTimeSec * 1000 - elapsedMs

  if (remainingMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, remainingMs))
  }
}

function stopVoiceUpdates() {
  if (voiceListenerIndex >= 0) {
    globalEvents.removeListener(voiceListenerIndex)
    voiceListenerIndex = -1
  }
}

function notifyCancelled() {
  props.onCancel?.()
  emit('cancelled')
}

const cancel = async () => {
  if (isFinishing.value) {
    return
  }

  isFinishing.value = true

  try {
    stopVoiceUpdates()
    await cancelVoiceRecognition()
    notifyCancelled()
  } finally {
    isFinishing.value = false
  }
}

const finish = async () => {
  if (isFinishing.value) {
    return
  }

  isFinishing.value = true

  try {
    await waitForStreamingRecognition()

    isTranscribing.value = !voiceRuntime.value.streaming
    const finalRecognizedText = await stopVoiceRecognition()
    isStarted.value = false
    isTranscribing.value = false

    if (finalRecognizedText) {
      recognizedText.value = finalRecognizedText
      lastRecognizedTextMs.value = Date.now()
    }

    if (!recognizedText.value.trim()) {
      toast(t('toast.nothingRecognized'), 'warn')
      notifyCancelled()
      return
    }

    stopVoiceUpdates()

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
        const formattedText = await voiceCorrection(recognizedText.value)

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

    props.onCorrected?.(resultText, recognizedText.value, correctedText)
    emit('corrected', resultText, recognizedText.value, correctedText)
  } finally {
    isFinishing.value = false
  }
}

function goToEditor() {
  if (isFinishing.value) return
  stopVoiceUpdates()
  void cancelVoiceRecognition()
  routeParamsStore.toEditor(recognizedText.value)
}

function handleKeyUp(event: KeyboardEvent) {
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
  lastRecognizedTextMs.value = 0
  try {
    await startVoiceRecognition()
    isStarted.value = true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    toast(message || t('toast.voiceRecognitionFailed'), 'error')
    stopVoiceUpdates()
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
  voiceListenerIndex = globalEvents.addListener(
    GlobalEvents.VOICE_RECOGNITION,
    (text: string) => {
      recognizedText.value = text
      lastRecognizedTextMs.value = Date.now()
    }
  )
  keyUpHandlerIndex = globalEvents.addListener(GlobalEvents.KEY_UP, handleKeyUp)

  if (ipcStore.params?.isWindowShown && ipcStore.params?.mode === 'voice') {
    await startSession()
  }
})

onUnmounted(() => {
  stopVoiceUpdates()

  if (keyUpHandlerIndex >= 0) {
    globalEvents.removeListener(keyUpHandlerIndex)
    keyUpHandlerIndex = -1
  }

  if (!isFinishing.value) {
    void cancelVoiceRecognition()
  }
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
