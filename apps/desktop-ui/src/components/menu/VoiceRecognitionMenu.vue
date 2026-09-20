<template>
  <div class="flex flex-col gap-4 w-full h-full">
    <h1>{{ t('menu.voiceRecognition') }}</h1>

    <div class="flex-1">
      <p v-if="statusText" class="text-sm text-muted mb-2">
        {{ statusText }}
      </p>
      <TextPreview :text="recognizedText" />
    </div>

    <div class="shortcuts-list">
      <div class="flex flex-col gap-2">
        <span class="flex flex-row gap-1">
          <KeyButton>Esc</KeyButton>
          <Button sm neutral :disabled="isFinishing" @click="cancel">
            {{ t('common.cancel') }}
          </Button>
        </span>

        <span class="flex flex-row gap-1">
          <KeyButton>Space</KeyButton>
          <KeyButton>Enter</KeyButton>
          <Button sm neutral :disabled="isFinishing" @click="finish">
            {{ isFinishing ? t('common.inProgress') : t('menu.finish') }}
          </Button>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { useCallAi } from '../../composables/useCallAi'
import { GlobalEvents, useGlobalEvents } from '../../composables/useGlobalEvents'
import { useI18n } from '../../composables/useI18n'
import useToast from '../../composables/useToast'
import { useHistoryStore } from '../../stores/history'
import { useIpcStore } from '../../stores/ipc'
import { useMenuModalsStore } from '../../stores/menuModals'

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
      menuModalsStore.setPendingModal({
        correction: true,
      })

      try {
        const formattedText = await voiceCorrection(recognizedText.value)

        if (formattedText.trim()) {
          resultText = formattedText
          correctedText = formattedText
          await historyStore.saveTransformHistory(formattedText)
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

function handleKeyUp(event: KeyboardEvent) {
  if (event.code === 'Escape') {
    void cancel()
    return
  }

  if (event.code === 'Space' || event.code === 'Enter') {
    void finish()
  }
}

onMounted(async () => {
  voiceListenerIndex = globalEvents.addListener(
    GlobalEvents.VOICE_RECOGNITION,
    (text: string) => {
      recognizedText.value = text
      lastRecognizedTextMs.value = Date.now()
    }
  )
  keyUpHandlerIndex = globalEvents.addListener(GlobalEvents.KEY_UP, handleKeyUp)

  try {
    await startVoiceRecognition()
    isStarted.value = true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    toast(message || t('toast.voiceRecognitionFailed'), 'error')
    stopVoiceUpdates()
    notifyCancelled()
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
.shortcuts-list {
  text-align: left;
  font-family: var(--font-mono);
  font-size: 0.875rem;
  line-height: 1.5;
  white-space: pre-wrap;
  display: flex;
  justify-content: center;
}
</style>
