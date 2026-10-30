<template>
  <ActionOverlayLayout
    :title="
      finishBehavior === 'submitToChat'
        ? t('menu.voiceChat')
        : t('menu.voiceInput')
    "
    :on-esc="cancel"
  >
    <template #preview>
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
      />
      <VoiceAutoStopNotice :deadline-ms="autoStopDeadlineMs" />
      <LiveTranscript
        :committed="transcript.committed"
        :draft="transcript.draft"
        :prefix="prefix"
        :suffix="suffix"
      />
    </template>

    <template #actions>
      <VoiceRecordingActions
        class="voice-shortcuts"
        :finish-behavior="finishBehavior"
        :finish-hotkey="finishHotkey"
        :is-finishing="isFinishing"
        :finish="finish"
        :cancel="cancel"
      />
    </template>
  </ActionOverlayLayout>
</template>
<script setup lang="ts">
import { useI18n } from '../../composables/use-i18n'
import ActionOverlayLayout from '../overlay/ActionOverlayLayout.vue'
import SelectionContextPreview from '../overlay/SelectionContextPreview.vue'
import AudioWaveform from './AudioWaveform.vue'
import LiveTranscript from './LiveTranscript.vue'
import VoiceAutoStopNotice from './VoiceAutoStopNotice.vue'
import VoiceRecordingActions from './VoiceRecordingActions.vue'
import type { VoiceRecordingProps } from './voice-recording-props'

defineProps<VoiceRecordingProps>()
const emit = defineEmits<{ (e: 'removeContext'): void }>()
const { t } = useI18n()
</script>
<style scoped>
.voice-context {
  flex: 0 1 auto;
  max-height: 40%;
  overflow-y: auto;
  border-bottom: 1px solid var(--app-border-subtle);
  padding-bottom: var(--space-xs);
}

.voice-shortcuts {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
</style>
