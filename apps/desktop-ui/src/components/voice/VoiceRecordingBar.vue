<template>
  <div
    class="voice-bar"
    :class="{ 'with-styling': Boolean(slots) }"
    role="region"
    :aria-label="t('menu.listening')"
  >
    <LiveTranscript
      class="voice-bar-transcript"
      :committed="transcript.committed"
      :draft="transcript.draft"
      :prefix="prefix"
      :suffix="suffix"
    />
    <div
      v-if="slots"
      class="voice-bar-styling-grid"
      role="group"
      :aria-label="t('menu.styling')"
    >
      <template v-for="slot in slots" :key="slot.key">
        <ShortcutButton
          v-if="slot.item"
          size="sm"
          :keys="[slot.key.toUpperCase()]"
          :disabled="isFinishing"
          @click="finishWithStyle?.(slot.item.rule)"
        >
          {{ slot.item.name }}
        </ShortcutButton>
        <div v-else class="shortcut-empty-slot" aria-hidden="true" />
      </template>
    </div>
    <div class="voice-bar-footer">
      <div class="voice-bar-wave">
        <AudioWaveform
          layout="inline"
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
        :finish-behavior="finishBehavior"
        :finish-hotkey="finishHotkey"
        :is-finishing="isFinishing"
        :finish="finish"
        :cancel="cancel"
      />
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import ShortcutButton from '../overlay/ShortcutButton.vue'
import AudioWaveform from './AudioWaveform.vue'
import LiveTranscript from './LiveTranscript.vue'
import VoiceRecordingActions from './VoiceRecordingActions.vue'
import type { VoiceRecordingProps } from './voice-recording-props'
import { SHORTCUT_SLOT_KEYS } from '@tyco/shared'

const props = defineProps<VoiceRecordingProps>()
const { t } = useI18n()

const slots = computed(() => {
  if (!props.stylingPresets || !props.stylingPresets.length) return null
  return SHORTCUT_SLOT_KEYS.map((key, index) => ({
    key,
    item: props.stylingPresets?.[index] ?? null,
  }))
})
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

.voice-bar.with-styling {
  height: auto;
  min-height: 15rem;
}

.voice-bar-styling-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  grid-template-rows: repeat(3, 2.125rem);
  gap: var(--space-xs);
  padding: var(--space-xs) 0;
  border-top: 1px solid var(--app-border-subtle);
}

.shortcut-empty-slot {
  min-height: 2.125rem;
  border-radius: var(--radius-md);
  border: 1px dashed transparent;
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

.voice-bar-actions {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  margin-left: auto;
  flex-shrink: 0;
}

/* In a row the buttons take their content width, not an equal share */
.voice-bar-actions {
  --shortcut-flex: 0 0 auto;
  --shortcut-width: auto;
}
</style>
