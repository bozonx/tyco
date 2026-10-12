<template>
  <div class="voice-bar" role="region">
    <LiveTranscript
      class="voice-bar-transcript"
      :committed="transcript.committed"
      :draft="transcript.draft"
      :prefix="prefix"
      :suffix="suffix"
    />
    <div class="voice-bar-footer">
      <div class="voice-bar-wave">
        <AudioWaveform
          :level="audioLevel"
          :peak="audioPeak"
          :duration-ms="recordingDurationMs"
          :is-transcribing="isTranscribing"
        />
      </div>
      <VoiceRecordingActions
        class="voice-bar-actions"
        compact
        :chat="chat"
        :quick-send="quickSend"
        :with-next="withNext"
        :is-finishing="isFinishing"
        :finish="finish"
        :cancel="cancel"
      />
    </div>
  </div>
</template>
<script setup lang="ts">
import type { LiveTranscriptState } from '../../lib/stt/live-transcript'
import type { VoiceFinishIntent } from '../../lib/stt/voice-finish-intent'
import AudioWaveform from './AudioWaveform.vue'
import LiveTranscript from './LiveTranscript.vue'
import VoiceRecordingActions from './VoiceRecordingActions.vue'

defineProps<{
  transcript: LiveTranscriptState
  audioLevel: number
  audioPeak: number
  recordingDurationMs: number
  isTranscribing: boolean
  isFinishing: boolean
  quickSend?: boolean
  withNext?: boolean
  chat?: boolean
  prefix?: string
  suffix?: string
  context?: string
  finish: (intent?: VoiceFinishIntent) => Promise<void>
  cancel: () => Promise<void>
}>()
</script>
<style scoped>
.voice-bar {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  width: 100%;
  height: 7.5rem;
  padding: var(--space-sm);
  box-sizing: border-box;
  border: 1px solid color-mix(in oklab, var(--color-primary) 45%, transparent);
  border-radius: var(--radius-lg);
  background-color: var(--app-surface);
  box-shadow: var(--app-shadow-md);
}

.voice-bar .voice-bar-transcript {
  flex: 1 1 0%;
  min-height: 0;
  padding: var(--space-xs) var(--space-sm);
}

.voice-bar-footer {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  flex-shrink: 0;
  padding-top: var(--space-xs);
  border-top: 1px solid var(--app-border-subtle);
}

/* The waveform, the status and the timer share one line */
.voice-bar-wave {
  flex: 0 1 18rem;
  min-width: 0;
}

.voice-bar-wave :deep(.audio-waveform-container) {
  padding: 0;
  border-bottom: none;
  background-color: transparent;
}

.voice-bar-wave :deep(.listening-state) {
  flex-direction: row;
  gap: var(--space-sm);
}

.voice-bar-wave :deep(.waveform-visualizer) {
  flex: 1 1 0%;
  min-width: 0;
  height: 28px;
  gap: 2px;
}

.voice-bar-wave :deep(.waveform-meta) {
  width: auto;
  flex-shrink: 0;
  gap: var(--space-sm);
}

.voice-bar-wave :deep(.transcribing-state) {
  min-height: 0;
  padding: 0;
}

.voice-bar-actions {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  margin-left: auto;
  flex-shrink: 0;
}

/* In a row the buttons take their content width, not an equal share */
.voice-bar-actions :deep(.shortcut) {
  flex: 0 0 auto;
  width: auto;
}
</style>
