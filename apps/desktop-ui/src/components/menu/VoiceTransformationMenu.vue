<template>
  <ActionOverlayLayout :title="t('action.voiceTransformation')" :on-esc="close">
    <template #preview>
      <TextPreview :text="props.text" />
      <div class="voice-transcription-box">
        <AudioWaveform
          :level="audioLevel"
          :peak="audioPeak"
          :duration-ms="recordingDurationMs"
          :is-transcribing="isFinishing"
        />
        <LiveTranscript
          :committed="liveTranscript.committed"
          :draft="liveTranscript.draft"
        />
      </div>
    </template>

    <template #actions>
      <div class="voice-actions">
        <ShortcutButton
          variant="primary"
          :keys="primaryKeys"
          icon="mdi:check"
          :disabled="isFinishing"
          @click="finish"
        >
          {{ isFinishing ? t('common.inProgress') : t('menu.aiPromptRun') }}
        </ShortcutButton>
        <ShortcutButton
          variant="ghost"
          :keys="['Esc']"
          icon="mdi:close"
          :disabled="isFinishing"
          @click="close"
        >
          {{ t('common.cancel') }}
        </ShortcutButton>
      </div>
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { useDictationActions } from '../../composables/use-dictation-actions'
import { useI18n } from '../../composables/use-i18n'
import { useMenuStepRun } from '../../composables/use-menu-step-run'
import useToast from '../../composables/use-toast'
import { useVoiceFinishSignal } from '../../composables/use-voice-finish-signal'
import { useVoiceRecordingMeter } from '../../composables/use-voice-recording-meter'
import { isQuickWindow as isInQuickWindow } from '../../lib/desktop/window'
import { describeError } from '../../lib/errors/describe-error'
import { pushRecent } from '../../lib/menu-query/menu-query'
import type { VoiceTransformationMenuParams } from '../../lib/modals/menu-modal-params'
import { describeDictationError } from '../../lib/stt/dictation-error'
import { useDesktopStore } from '../../stores/desktop'
import { useInvocationsStore } from '../../stores/invocations'
import { MenuModals, useMenuModalsStore } from '../../stores/menu-modals'
import { useWindowStore } from '../../stores/window'
import TextPreview from '../common/TextPreview.vue'
import ActionOverlayLayout from '../overlay/ActionOverlayLayout.vue'
import ShortcutButton from '../overlay/ShortcutButton.vue'
import AudioWaveform from '../voice/AudioWaveform.vue'
import LiveTranscript from '../voice/LiveTranscript.vue'
import { APP_CONFIG } from '@tyco/shared'

const props = withDefaults(defineProps<VoiceTransformationMenuParams>(), {
  text: '',
  shortcutsDisabled: false,
})

const menuModalsStore = useMenuModalsStore()
const desktopStore = useDesktopStore()
const invocations = useInvocationsStore()
const windowStore = useWindowStore()
const { toastKey, toastText } = useToast()
const runStep = useMenuStepRun()
const { t } = useI18n()
const dictation = useDictationActions()

const isQuickWindow = isInQuickWindow()
const isListening = ref(false)
const isFinishing = ref(false)
const liveTranscript = ref({ committed: '', draft: '' })

const { audioLevel, audioPeak, recordingDurationMs } = useVoiceRecordingMeter(
  () => isListening.value
)

const finishHotkey = useVoiceFinishSignal(
  () => (isQuickWindow ? 'voiceTransformation' : undefined),
  () => void finish(),
  () => void finish()
)

const primaryKeys = computed(() =>
  finishHotkey.value ? [finishHotkey.value, 'Enter'] : ['Enter']
)

const recentPrompts = computed(
  () => desktopStore.sessionState?.recentAiPrompts ?? []
)

const rememberPrompt = (value: string) => {
  void desktopStore.patchSessionState({
    recentAiPrompts: pushRecent(recentPrompts.value, value),
  })
}

const handleKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'Enter' && !event.isComposing && !isFinishing.value) {
    event.preventDefault()
    void finish()
  }
}

onMounted(async () => {
  window.addEventListener('keydown', handleKeyDown)
  try {
    await dictation.startDictation({
      onText: (event) => {
        liveTranscript.value = {
          committed: event.committed,
          draft: event.draft,
        }
      },
      onError: (err) => {
        toastText(describeDictationError(err, t), 'error')
      },
    })
    isListening.value = true
  } catch (error) {
    toastText(describeError(error, t), 'error')
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
  if (isListening.value) {
    void dictation.cancelDictation().catch(() => undefined)
  }
})

async function close() {
  if (isListening.value) {
    await dictation.cancelDictation().catch(() => undefined)
    isListening.value = false
  }
  if (isQuickWindow) {
    void windowStore.hide()
  } else {
    menuModalsStore.closeAll()
  }
}

async function finish() {
  if (isFinishing.value) return
  isFinishing.value = true
  try {
    const text = await dictation.finishDictation()
    isListening.value = false
    const prompt =
      (
        liveTranscript.value.committed +
        ' ' +
        (liveTranscript.value.draft || '')
      ).trim() || text.trim()

    if (!prompt) {
      toastKey('toast.noTextToProcess', 'warn')
      isFinishing.value = false
      return
    }

    rememberPrompt(prompt)

    const trimmedText = props.text.trim()
    if (!trimmedText) {
      toastKey('toast.noTextToProcess', 'warn')
      isFinishing.value = false
      return
    }

    if (trimmedText.length < APP_CONFIG.minTransformationLength) {
      toastKey('toast.textTooShortToProcess', 'warn')
      isFinishing.value = false
      return
    }

    await runStep({
      text: trimmedText,
      sourceText: props.text,
      operation: 'aiTask',
      pending: { transformation: true },
      invoke: (signal) =>
        invocations.call('core.transformation', trimmedText, {
          signal,
          toolConfig: { prompt },
        }),
      read: (result) => result.content ?? null,
      show: (newText) =>
        menuModalsStore.nextModal(MenuModals.DIFF, {
          oldText: props.text,
          newText,
        }),
    })
  } catch (error) {
    toastText(describeError(error, t), 'error')
    isFinishing.value = false
  }
}
</script>

<style scoped>
.voice-transcription-box {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  margin-top: var(--space-sm);
}

.voice-actions {
  display: flex;
  align-items: center;
  gap: var(--space-md);
}
</style>
