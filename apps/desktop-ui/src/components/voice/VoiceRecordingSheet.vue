<template>
  <ActionOverlayLayout :title="title" :on-esc="cancel">
    <template #header-extra>
      <SttLanguagePicker
        placement="bottom"
        align="right"
        :disabled="isFinishing"
        @change="emit('language-change')"
      />
    </template>
    <template #preview>
      <div
        v-if="referenceText"
        class="max-h-40 overflow-auto whitespace-pre-wrap"
      >
        {{ referenceText }}
      </div>
      <!-- the question goes to the chat with this text: the user sees what
           the answer will be about -->
      <SelectionContextPreview
        v-if="context"
        class="voice-context"
        :text="context"
        :title="t('chat.voiceContext')"
        :remove-title="t('chat.removeAttachment')"
        @remove="emit('removeContext')"
      />
      <AudioWaveform
        :level="audioLevel"
        :peak="audioPeak"
        :duration-ms="recordingDurationMs"
        :is-transcribing="isTranscribing"
        :is-correcting="isCorrecting"
        :is-styling="isStyling"
      />
      <VoiceAutoStopNotice :deadline-ms="autoStopDeadlineMs" />
      <LiveTranscript
        :committed="transcript.committed"
        :draft="transcript.draft"
        :prefix="prefix"
        :suffix="suffix"
        :is-finishing="isFinishing"
      />
    </template>

    <template #actions>
      <VoiceRecordingActions
        class="voice-shortcuts"
        :finish-behavior="finishBehavior"
        :has-text="Boolean(liveTranscriptText(transcript).trim())"
        :finish-hotkey="finishHotkey"
        :is-finishing="isFinishing"
        :finish="finish"
        :cancel="cancel"
      />
    </template>
  </ActionOverlayLayout>
</template>
<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { liveTranscriptText } from '../../lib/stt/live-transcript'
import ActionOverlayLayout from '../overlay/ActionOverlayLayout.vue'
import SelectionContextPreview from '../overlay/SelectionContextPreview.vue'
import AudioWaveform from './AudioWaveform.vue'
import LiveTranscript from './LiveTranscript.vue'
import SttLanguagePicker from './SttLanguagePicker.vue'
import VoiceAutoStopNotice from './VoiceAutoStopNotice.vue'
import VoiceRecordingActions from './VoiceRecordingActions.vue'
import type { VoiceRecordingProps } from './voice-recording-props'

const props = defineProps<VoiceRecordingProps>()
const emit = defineEmits<{
  (e: 'removeContext'): void
  (e: 'language-change'): void
}>()
const { t } = useI18n()

const title = computed(() => {
  if (props.isCorrecting) return t('menu.correction')
  if (props.isStyling) return t('menu.styling')
  return props.finishBehavior === 'submitToChat'
    ? t('menu.voiceChat')
    : t('menu.voiceInput')
})
</script>
<style scoped>
.voice-context {
  flex: 0 1 auto;
  max-height: 40%;
  overflow-y: auto;
  overscroll-behavior: contain;
  border-bottom: 1px solid var(--app-border-subtle);
  padding-bottom: var(--space-xs);
}

.voice-shortcuts {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
</style>
