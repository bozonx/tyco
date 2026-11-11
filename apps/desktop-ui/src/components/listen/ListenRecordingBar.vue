<template>
  <!-- `voice-bar`: the input region keeps it clickable, see `QuickOverlay` -->
  <RecordingBarFrame class="voice-bar listen-bar" :label="t('listen.title')">
    <div class="listen-bar-header">
      <OverlayDragHandle />
      <span class="listen-bar-title">
        <AppIcon icon="mdi:volume-high" />
        {{ t('listen.title') }}
      </span>
      <ListenSourcePicker
        :source="model.source.value"
        :app-label="activeAppLabel"
        :disabled="
          isFinishing || model.isStarting.value || model.isSwitching.value
        "
        @select="onSelectSource"
      />
      <SttLanguagePicker
        placement="top"
        align="right"
        :disabled="isFinishing"
        @change="emit('language-change')"
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
      :class="{ 'is-error': isErrorNotice }"
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
        @click="onSelectSource(SYSTEM_MIX_SOURCE)"
      >
        {{ t('listen.useSystemMix') }}
      </Button>
    </div>
    <LiveTranscript
      class="voice-bar-transcript"
      :committed="model.transcript.value.committed"
      :draft="model.transcript.value.draft"
      :placeholder="transcriptPlaceholder"
      :is-finishing="isFinishing"
    />
    <div class="voice-bar-footer">
      <div class="voice-bar-wave">
        <AudioWaveform
          layout="inline"
          icon="mdi:volume-high"
          :level="audioLevel"
          :peak="audioPeak"
          :duration-ms="recordingDurationMs"
          :is-transcribing="isFinishing"
        />
      </div>
      <VoiceAutoStopNotice
        :deadline-ms="model.autoStopWarning.value?.deadlineMs"
      />
      <QuickModeSwitch
        mode="listen"
        :disabled="isFinishing"
        @switch="emit('switch-mode')"
      />
      <div class="listen-bar-actions">
        <ShortcutButton
          size="sm"
          :keys="['Esc']"
          icon="mdi:close"
          :disabled="isFinishing"
          @click="void model.close()"
        >
          {{ t('common.cancel') }}
        </ShortcutButton>
        <ShortcutButton
          size="sm"
          :keys="stopKeys"
          icon="mdi:check"
          variant="primary"
          :disabled="isFinishing"
          @click="void model.stop()"
        >
          {{ isFinishing ? t('common.inProgress') : t('menu.finish') }}
        </ShortcutButton>
      </div>
    </div>
  </RecordingBarFrame>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

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
import RecordingBarFrame from '../voice/RecordingBarFrame.vue'
import SttLanguagePicker from '../voice/SttLanguagePicker.vue'
import VoiceAutoStopNotice from '../voice/VoiceAutoStopNotice.vue'
import ListenSourcePicker from './ListenSourcePicker.vue'
import type { CaptureSource } from '@tyco/shared'

const props = defineProps<{
  model: ListenModel
  audioLevel: number
  audioPeak: number
  recordingDurationMs: number
  /** The listening hotkey, which stops the recording too */
  stopHotkey?: string
  appLabel?: string
}>()
const emit = defineEmits<{
  (e: 'switch-mode'): void
  (e: 'language-change'): void
}>()
const { t } = useI18n()

const pickedLabel = ref<{ appId: string; label: string }>()
const activeAppLabel = computed(() => {
  if (props.model.source.value.kind !== 'application') return undefined
  const appId = props.model.source.value.appId
  if (pickedLabel.value?.appId === appId) return pickedLabel.value.label
  return props.appLabel
})

function onSelectSource(next: CaptureSource, label?: string) {
  if (next.kind === 'application' && label) {
    pickedLabel.value = { appId: next.appId, label }
  } else {
    pickedLabel.value = undefined
  }
  void props.model.selectSource(next)
}

const isFinishing = computed(() => props.model.phase.value === 'finishing')
const stopKeys = computed(() =>
  props.stopHotkey ? ['Space', 'Enter', props.stopHotkey] : ['Space', 'Enter']
)

const isWaitingForApp = computed(
  () =>
    props.model.isWaiting.value &&
    props.model.source.value.kind === 'application'
)

const transcriptPlaceholder = computed(() =>
  isWaitingForApp.value
    ? t('listen.waitingPlaceholder')
    : t('listen.listeningPlaceholder')
)

const isErrorNotice = computed(
  () =>
    !props.model.isSourceLost.value &&
    !isWaitingForApp.value &&
    Boolean(props.model.errorText.value)
)

const notice = computed(() => {
  const { source, isSourceLost, errorText } = props.model
  if (isSourceLost.value) return t('listen.sourceLost')
  if (isWaitingForApp.value && source.value.kind === 'application')
    return t('listen.waitingFor', {
      app: activeAppLabel.value ?? source.value.appId,
    })
  return errorText.value
})
</script>

<style scoped>
.listen-bar {
  min-height: 9.5rem;
  max-height: 15rem;
}

.listen-bar-header {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-shrink: 0;
  min-width: 0;
}

.listen-bar-title {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs, 0.25rem);
  font-weight: 600;
  color: var(--color-base-content);
  white-space: nowrap;
  flex-shrink: 0;
}

.listen-bar-info {
  margin-left: auto;
}

.listen-bar-notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs) var(--space-sm);
  min-width: 0;
  font-size: var(--text-sm, 0.875rem);
  color: var(--app-text-muted);
}

.listen-bar-notice.is-error {
  color: var(--color-error);
}

.listen-bar .voice-bar-transcript {
  flex: 1 1 auto;
  min-height: 2.5rem;
  max-height: 6rem;
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
