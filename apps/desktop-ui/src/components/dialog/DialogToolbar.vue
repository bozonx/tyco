<template>
  <div class="dialog-toolbar">
    <!-- Start never records; recording is asked for in its menu -->
    <div v-if="isIdle" class="dialog-toolbar-split">
      <Button
        class="dialog-toolbar-run"
        variant="primary"
        size="sm"
        icon="mdi:play"
        @click="dialog.start()"
        >{{ t('dialog.start') }}</Button
      >
      <DropdownMenu
        class="dialog-toolbar-start-menu"
        square
        variant="primary"
        icon="mdi:chevron-down"
        hide-chevron
        :title="t('dialog.startOptions')"
        :items="startItems"
      />
    </div>
    <Button
      v-else
      class="dialog-toolbar-run"
      size="sm"
      icon="mdi:stop"
      :loading="isStopping"
      :disabled="isStopping"
      @click="dialog.stop()"
      >{{ isStopping ? t('dialog.stopping') : t('dialog.stop') }}</Button
    >
    <!-- the source is chosen before the dialog; while it runs, its sound -->
    <SegmentedControl
      v-if="isIdle"
      class="dialog-toolbar-source"
      :model-value="dialog.config.source"
      size="sm"
      :label="t('dialog.source')"
      :options="sourceOptions"
      @update:model-value="(source) => dialog.updateConfig({ source })"
    />
    <div v-else class="dialog-toolbar-levels">
      <DialogRecordingIndicator
        v-if="dialog.recording"
        :started-at-ms="dialog.recording.startedAtMs"
        :label="t('dialog.recording')"
      />
      <DialogLevel
        v-if="dialog.hasMicrophone"
        icon="mdi:microphone"
        :label="levelLabel('me')"
        :level="dialog.levels.me"
        :is-off="dialog.channelStatus.me === 'failed'"
      />
      <DialogLevel
        icon="mdi:volume-high"
        :label="levelLabel('remote')"
        :level="dialog.levels.remote"
        :is-off="dialog.channelStatus.remote === 'failed'"
      />
      <AppIcon
        v-if="channelNotice"
        class="dialog-toolbar-connecting"
        icon="mdi:loading"
        size="sm"
        role="status"
        :title="channelNotice"
        :aria-label="channelNotice"
      />
    </div>

    <DialogLanguageRoute />

    <div class="dialog-toolbar-spacer" />

    <!-- set before anything is said: a mode without text just shows nothing -->
    <SegmentedControl
      class="dialog-toolbar-display"
      :model-value="dialog.config.textDisplay"
      size="sm"
      :label="t('dialog.textDisplay')"
      :options="displayOptions"
      @update:model-value="
        (textDisplay) => dialog.updateConfig({ textDisplay })
      "
    />
    <IconButton
      icon="mdi:picture-in-picture-bottom-right-outline"
      :label="t('dialog.collapse')"
      @click="dialog.showSubtitles()"
    />
    <DropdownMenu
      square
      hide-chevron
      align="right"
      icon="mdi:dots-vertical"
      :title="t('common.more')"
      :items="moreItems"
    />
    <ConfirmModal
      :open="isRecordingNoticeOpen"
      :title="t('dialog.recordingNoticeTitle')"
      :message="t('dialog.recordingNoticeMessage')"
      :confirm-text="t('dialog.recordingNoticeConfirm')"
      @confirm="confirmRecordingNotice"
      @cancel="isRecordingNoticeOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import type { DialogSide } from '../../lib/dialog/dialog-transcript'
import type { ControlOption } from '../../lib/ui/control-option'
import { useDesktopStore } from '../../stores/desktop'
import { useDialogStore } from '../../stores/dialog'
import AppIcon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import DropdownMenu, { type DropdownMenuItem } from '../common/DropdownMenu.vue'
import IconButton from '../common/IconButton.vue'
import SegmentedControl from '../common/SegmentedControl.vue'
import DialogLanguageRoute from './DialogLanguageRoute.vue'
import DialogLevel from './DialogLevel.vue'
import DialogRecordingIndicator from './DialogRecordingIndicator.vue'
import type { DialogSource, DialogTextDisplay } from '@tyco/shared'

const dialog = useDialogStore()
const desktopStore = useDesktopStore()
const { t } = useI18n()

const isIdle = computed(
  () => dialog.status === 'idle' || dialog.status === 'failed'
)
const isStopping = computed(() => dialog.status === 'stopping')
const isEmpty = computed(() => dialog.segments.length === 0)
const isRecordingNoticeOpen = ref(false)

// a recording belongs to its history entry: nothing would keep it otherwise
const canRecord = computed(
  () => desktopStore.userConfig.editor.history.storage === 'disk'
)
const startItems = computed<DropdownMenuItem[]>(() => [
  {
    label: t('dialog.startCompact'),
    icon: 'mdi:picture-in-picture-bottom-right-outline',
    action: startCompact,
  },
  {
    label: canRecord.value
      ? t('dialog.startRecording')
      : t('dialog.startRecordingNeedsHistory'),
    icon: 'mdi:record-circle-outline',
    disabled: !canRecord.value,
    action: startRecording,
  },
])

/** Starts and folds the window into the subtitles strip at once */
async function startCompact() {
  await dialog.start()
  if (dialog.isActive) await dialog.showSubtitles()
}

/** The first recording tells to ask the other side first */
function startRecording() {
  if (dialog.config.isRecordingNoticeAcknowledged)
    void dialog.start({ isRecording: true })
  else isRecordingNoticeOpen.value = true
}

async function confirmRecordingNotice() {
  isRecordingNoticeOpen.value = false
  await dialog.acknowledgeRecordingNotice()
  await dialog.start({ isRecording: true })
}

const sourceOptions = computed<ControlOption<DialogSource>[]>(() => [
  {
    id: 'microphoneAndSystem',
    name: t('dialog.sourceCall'),
    icon: 'mdi:account-multiple-outline',
    title: t('dialog.sourceCallHint'),
  },
  {
    id: 'system',
    name: t('dialog.sourceComputer'),
    icon: 'mdi:monitor-speaker',
    title: t('dialog.sourceComputerHint'),
  },
])

const displayOptions = computed<ControlOption<DialogTextDisplay>[]>(() => [
  { id: 'translation', name: t('dialog.displayTranslation') },
  { id: 'original', name: t('dialog.displayOriginal') },
  { id: 'both', name: t('dialog.displayBoth') },
])

// the view is offered here too: the toolbar drops its control when narrow
const moreItems = computed<DropdownMenuItem[]>(() => [
  ...displayOptions.value.map((option) => ({
    label: `${t('dialog.textDisplay')}: ${option.name}`,
    icon:
      dialog.config.textDisplay === option.id
        ? 'mdi:radiobox-marked'
        : 'mdi:radiobox-blank',
    action: () => void dialog.updateConfig({ textDisplay: option.id }),
  })),
  {
    label: t('dialog.copy'),
    icon: 'mdi:content-copy',
    disabled: isEmpty.value,
    action: () => void dialog.copyTranscript(),
  },
  {
    label: t('dialog.toActionMenu'),
    icon: 'mdi:lightning-bolt-outline',
    disabled: isEmpty.value,
    action: () => void dialog.sendToActionMenu(),
  },
])

const channelNotice = computed(() => {
  const statuses = Object.values(dialog.channelStatus)
  if (statuses.includes('reconnecting')) return t('dialog.reconnecting')
  if (statuses.includes('connecting')) return t('dialog.connecting')
  return ''
})

function levelLabel(side: DialogSide) {
  const label = t(side === 'me' ? 'dialog.levelMe' : 'dialog.levelRemote')
  return dialog.channelStatus[side] === 'failed'
    ? `${label} · ${t('dialog.channelFailed')}`
    : label
}
</script>

<style scoped>
.dialog-toolbar {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: var(--space-sm);
  min-width: 0;
  padding: var(--space-sm) var(--space-md);
  border-bottom: 1px solid var(--app-border-subtle);
  overflow: hidden;
}

.dialog-toolbar > * {
  flex-shrink: 0;
}

/* the same width while it reads Start, Stop or Stopping */
.dialog-toolbar-run {
  min-width: 7.5rem;
  justify-content: center;
}

/* Start and its menu read as one button */
.dialog-toolbar-split {
  display: flex;
  align-items: stretch;
}

.dialog-toolbar-split > .dialog-toolbar-run {
  min-width: 5.5rem;
  border-start-end-radius: 0;
  border-end-end-radius: 0;
}

.dialog-toolbar-start-menu :deep(button) {
  border-start-start-radius: 0;
  border-end-start-radius: 0;
  border-inline-start: 1px solid
    color-mix(in oklab, var(--color-primary-content) 25%, transparent);
}

.dialog-toolbar-levels {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.dialog-toolbar-connecting {
  color: var(--app-text-muted);
  animation: dialog-toolbar-spin 1s linear infinite;
}

@keyframes dialog-toolbar-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .dialog-toolbar-connecting {
    animation: none;
  }
}

.dialog-toolbar-spacer {
  flex: 1 1 0%;
  min-width: 0;
}

/* the route of the languages gives way first */
.dialog-toolbar > .dialog-route {
  flex-shrink: 1;
}

@media (max-width: 48rem) {
  .dialog-toolbar-display {
    display: none;
  }
}

/* narrower still, the sources keep their icons, the tooltips name them */
@media (max-width: 36rem) {
  .dialog-toolbar-source :deep(.option-label) {
    display: none;
  }
}
</style>
