<template>
  <RecordingBarFrame
    class="voice-bar"
    :class="{
      'with-styling': Boolean(slots),
      'with-header':
        canSwitchMode || Boolean(replyTo) || props.showCancelButton,
    }"
    :label="ariaLabel"
  >
    <div class="voice-bar-header">
      <OverlayDragHandle />
      <MicrophoneSourcePicker
        v-if="canSwitchMode"
        :microphone-id="microphoneId"
        @select="selectMicrophone"
        :disabled="isFinishing"
        @switch="emit('switch-mode')"
      />
      <span v-if="replyTo" class="voice-bar-reply" :title="replyTo">
        {{ t('listen.replyingTo', { text: replyTo }) }}
      </span>
      <ShortcutButton
        v-if="props.showCancelButton !== false"
        size="sm"
        :keys="cancelShortcut ? ['Esc'] : []"
        :disabled="isFinishing"
        :title="t('chat.voiceCancelHint')"
        @click="cancel"
        >{{ t('common.cancel') }}</ShortcutButton
      >
    </div>
    <div v-if="referenceText" class="voice-reference-text">
      {{ referenceText }}
    </div>
    <LiveTranscript
      class="voice-bar-transcript"
      :committed="transcript.committed"
      :draft="transcript.draft"
      :prefix="prefix"
      :suffix="suffix"
      :is-finishing="isFinishing"
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
          :title="slot.item.name"
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
          :is-correcting="isCorrecting"
          :is-styling="isStyling"
        />
      </div>
      <VoiceAutoStopNotice :deadline-ms="autoStopDeadlineMs" />
      <SttLanguagePicker
        placement="top"
        align="right"
        :disabled="isFinishing"
        @change="emit('language-change')"
      />
      <VoiceRecordingActions
        class="voice-bar-actions"
        compact
        :chat="chat"
        :cancel-shortcut="cancelShortcut"
        :finish-behavior="finishBehavior"
        :has-text="Boolean(liveTranscriptText(transcript).trim())"
        :finish-hotkey="finishHotkey"
        :is-finishing="isFinishing"
        :finish="finish"
        :cancel="cancel"
      />
    </div>
  </RecordingBarFrame>
</template>
<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { liveTranscriptText } from '../../lib/stt/live-transcript'
import ShortcutButton from '../overlay/ShortcutButton.vue'
import OverlayDragHandle from '../quick/OverlayDragHandle.vue'
import AudioWaveform from './AudioWaveform.vue'
import LiveTranscript from './LiveTranscript.vue'
import MicrophoneSourcePicker from './MicrophoneSourcePicker.vue'
import RecordingBarFrame from './RecordingBarFrame.vue'
import SttLanguagePicker from './SttLanguagePicker.vue'
import VoiceAutoStopNotice from './VoiceAutoStopNotice.vue'
import VoiceRecordingActions from './VoiceRecordingActions.vue'
import type { VoiceRecordingProps } from './voice-recording-props'
import { SHORTCUT_SLOT_KEYS } from '@tyco/shared'

const props = withDefaults(defineProps<VoiceRecordingProps>(), {
  showCancelButton: true,
})
const emit = defineEmits<{
  (e: 'switch-mode'): void
  (e: 'language-change'): void
}>()
const { t } = useI18n()

const ariaLabel = computed(() => {
  if (props.isCorrecting) return t('menu.correction')
  if (props.isStyling) return t('menu.styling')
  if (props.isTranscribing) return t('menu.transcribing')
  return t('menu.listening')
})

const slots = computed(() => {
  if (!props.stylingPresets || !props.stylingPresets.length) return null
  // a preset without a rule does nothing, as its key does not
  return SHORTCUT_SLOT_KEYS.map((key, index) => {
    const item = props.stylingPresets?.[index] ?? null
    return { key, item: item?.rule.trim() ? item : null }
  })
})
</script>
<style scoped>
.voice-reference-text {
  max-height: 10rem;
  overflow: auto;
  white-space: pre-wrap;
  color: var(--app-text-muted);
}

.voice-bar {
  height: 7.5rem;
}

.voice-bar-header > .shortcut {
  margin-left: auto;
  width: auto;
}

.voice-bar-header {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-shrink: 0;
  min-width: 0;
}

.voice-bar-reply {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--text-sm, 0.875rem);
  color: var(--app-text-muted);
}

.voice-bar.with-header {
  height: 9.5rem;
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
.voice-bar:has(.voice-reference-text) {
  height: auto;
}
</style>
