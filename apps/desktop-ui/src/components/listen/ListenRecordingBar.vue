<template>
  <!-- `voice-bar`: the input region keeps it clickable, see `QuickOverlay` -->
  <div
    class="voice-bar listen-bar"
    role="region"
    :aria-label="t('listen.title')"
  >
    <div class="listen-bar-header">
      <OverlayDragHandle />
      <QuickModeSwitch mode="listen" @switch="emit('switch-mode')" />
      <span class="listen-bar-title">
        <AppIcon icon="mdi:volume-high" />
        {{ t('listen.title') }}
      </span>
      <ListenSourcePicker
        :source="model.source.value"
        :app-label="appLabel"
        @select="(source) => void model.selectSource(source)"
      />
      <InfoTooltip
        class="listen-bar-info"
        :text="t('listen.privacyHint')"
        :aria-label="t('listen.privacyHintLabel')"
        placement="top"
        align="end"
      />
    </div>
    <div
      v-if="notice"
      class="listen-bar-notice"
      role="status"
      aria-live="polite"
    >
      <span>{{ notice }}</span>
      <Button
        v-if="
          model.isWaiting.value && model.source.value.kind === 'application'
        "
        size="xs"
        variant="ghost"
        @click="void model.selectSource(SYSTEM_MIX_SOURCE)"
      >
        {{ t('listen.useSystemMix') }}
      </Button>
    </div>
    <LiveTranscript
      class="voice-bar-transcript"
      :committed="model.transcript.value.committed"
      :draft="model.transcript.value.draft"
      :is-finishing="isFinishing"
    />
    <div class="voice-bar-footer">
      <div class="voice-bar-wave">
        <AudioWaveform
          layout="inline"
          :level="audioLevel"
          :peak="audioPeak"
          :duration-ms="recordingDurationMs"
          :is-transcribing="isFinishing"
        />
      </div>
      <VoiceAutoStopNotice
        :deadline-ms="model.autoStopWarning.value?.deadlineMs"
      />
      <div class="listen-bar-actions">
        <ShortcutButton
          size="sm"
          :keys="['Esc']"
          :disabled="isFinishing"
          @click="void model.close()"
        >
          {{ t('common.cancel') }}
        </ShortcutButton>
        <ShortcutButton
          size="sm"
          variant="primary"
          :keys="stopKeys"
          :disabled="isFinishing"
          @click="void model.stop()"
        >
          {{ t('listen.stop') }}
        </ShortcutButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import {
  type ListenModel,
  SYSTEM_MIX_SOURCE,
} from '../../lib/listen/listen-model'
import AppIcon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import InfoTooltip from '../common/InfoTooltip.vue'
import ShortcutButton from '../overlay/ShortcutButton.vue'
import OverlayDragHandle from '../quick/OverlayDragHandle.vue'
import AudioWaveform from '../voice/AudioWaveform.vue'
import LiveTranscript from '../voice/LiveTranscript.vue'
import QuickModeSwitch from '../voice/QuickModeSwitch.vue'
import VoiceAutoStopNotice from '../voice/VoiceAutoStopNotice.vue'
import ListenSourcePicker from './ListenSourcePicker.vue'

const props = defineProps<{
  model: ListenModel
  audioLevel: number
  audioPeak: number
  recordingDurationMs: number
  /** The listening hotkey, which stops the recording too */
  stopHotkey?: string
  appLabel?: string
}>()
const emit = defineEmits<{ (e: 'switch-mode'): void }>()
const { t } = useI18n()

const isFinishing = computed(() => props.model.phase.value === 'finishing')
const stopKeys = computed(() =>
  props.stopHotkey ? ['Enter', props.stopHotkey] : ['Enter']
)

const notice = computed(() => {
  const { source, isWaiting, isSourceLost, errorText } = props.model
  if (isSourceLost.value) return t('listen.sourceLost')
  if (isWaiting.value && source.value.kind === 'application')
    return t('listen.waitingFor', { app: props.appLabel ?? source.value.appId })
  return errorText.value
})
</script>

<style scoped>
.listen-bar {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  width: 100%;
  height: 9.5rem;
  padding: var(--space-sm);
  box-sizing: border-box;
  border: 1px solid color-mix(in oklab, var(--color-secondary) 55%, transparent);
  border-radius: var(--radius-lg);
  background-color: var(--app-surface);
  box-shadow: var(--app-shadow-md);
}

.listen-bar-header {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-shrink: 0;
}

.listen-bar-title {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs, 0.25rem);
  font-weight: 600;
  color: var(--color-secondary);
}

.listen-bar-info {
  margin-left: auto;
}

.listen-bar-notice {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-size: var(--text-sm, 0.875rem);
  color: var(--app-text-muted);
}

.listen-bar .voice-bar-transcript {
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

.voice-bar-wave {
  flex: 0 1 18rem;
  min-width: 0;
}

.listen-bar-actions {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  margin-left: auto;
  flex-shrink: 0;
  --shortcut-flex: 0 0 auto;
  --shortcut-width: auto;
}
</style>
