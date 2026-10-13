<template>
  <ActionOverlayLayout
    :title="quickSend ? t('menu.voiceChat') : t('menu.voiceInput')"
    :onEsc="cancel"
  >
    <template #preview>
      <!-- the question goes to the chat with this text: the user sees what
           the answer will be about -->
      <div v-if="context" class="voice-context">
        <div class="voice-context-header">
          <Icon
            icon="mdi:selection-drag"
            height="14"
            class="shrink-0 text-primary"
          />
          <span class="voice-context-title">{{ t('chat.voiceContext') }}</span>
          <IconButton
            class="voice-context-remove"
            :title="t('chat.removeAttachment')"
            @click="emit('removeContext')"
            :label="t('chat.removeAttachment')"
            icon="mdi:close"
          />
        </div>
        <TextPreview :text="context" />
      </div>
      <AudioWaveform
        :level="audioLevel"
        :peak="audioPeak"
        :duration-ms="recordingDurationMs"
        :is-transcribing="isTranscribing"
      />
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
        :quick-send="quickSend"
        :with-next="withNext"
        :is-finishing="isFinishing"
        :finish="finish"
        :cancel="cancel"
      />
    </template>
  </ActionOverlayLayout>
</template>
<script setup lang="ts">
import { useI18n } from '../../composables/use-i18n'
import ActionOverlayLayout from '../common/ActionOverlayLayout.vue'
import IconButton from '../common/IconButton.vue'
import TextPreview from '../common/TextPreview.vue'
import AudioWaveform from './AudioWaveform.vue'
import LiveTranscript from './LiveTranscript.vue'
import VoiceRecordingActions from './VoiceRecordingActions.vue'
import type { VoiceRecordingProps } from './voice-recording-props'
import { Icon } from '@iconify/vue'

defineProps<VoiceRecordingProps>()
const emit = defineEmits<{ (e: 'removeContext'): void }>()
const { t } = useI18n()
</script>
<style scoped>
.voice-context-header {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  margin-bottom: var(--space-xs);
  color: var(--app-text-muted);
  font-size: var(--text-caption);
}
.voice-context-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.voice-context-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 0.15rem;
  border-radius: var(--radius-sm);
  color: var(--app-text-muted);
  cursor: pointer;
  transition: all 0.15s ease;
}
.voice-context-remove:hover {
  background: var(--app-hover);
  color: var(--color-error);
}
.voice-context {
  display: flex;
  flex-direction: column;
  flex: 0 1 auto;
  max-height: 40%;
  min-height: 0;
  gap: var(--space-xs);
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
