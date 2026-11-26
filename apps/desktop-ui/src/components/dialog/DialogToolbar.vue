<template>
  <div class="dialog-toolbar">
    <div class="dialog-toolbar-actions">
      <Button
        v-if="isIdle"
        class="dialog-toolbar-run"
        variant="primary"
        size="sm"
        :icon="isEmpty ? 'mdi:play' : 'mdi:play-pause'"
        :title="runButtonTitle"
        @click="handleRun"
        >{{ isEmpty ? t('dialog.listen') : t('dialog.resume') }}</Button
      >
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

      <!-- recording modifies the session, so it follows the run button -->
      <div ref="recordContainerRef" class="dialog-toolbar-record-container">
        <Button
          class="dialog-toolbar-record-toggle"
          :class="{
            'is-running': !isIdle,
            'is-armed': isIdle && dialog.isRecordEnabled,
          }"
          :variant="dialog.isRecordEnabled ? 'neutral' : 'ghost'"
          size="sm"
          :tone="!dialog.isRecordEnabled ? 'muted' : undefined"
          :aria-pressed="dialog.isRecordEnabled"
          :disabled="isRecordToggleDisabled"
          :title="recordToggleTitle"
          @click="handleToggleRecord"
        >
          <template v-if="isRecordingRunning">
            <span
              class="dialog-record-dot dialog-record-dot-pulsing"
              aria-hidden="true"
            />
            <span class="sr-only">{{ t('dialog.recording') }}</span>
            <span class="dialog-record-rec">REC</span>
            <span class="dialog-record-timer">{{ elapsed }}</span>
          </template>
          <template v-else-if="dialog.isRecordEnabled">
            <span class="dialog-record-dot" aria-hidden="true" />
            <span>{{ t('dialog.record') }}</span>
          </template>
          <template v-else>
            <AppIcon
              icon="mdi:record-circle-outline"
              size="md"
              class="shrink-0"
            />
            <span>{{ t('dialog.record') }}</span>
          </template>
        </Button>
      </div>

      <Button
        class="dialog-toolbar-mic-toggle"
        :variant="dialog.hasMicrophone ? 'neutral' : 'ghost'"
        size="sm"
        :tone="!dialog.hasMicrophone ? 'muted' : undefined"
        :icon="dialog.hasMicrophone ? 'mdi:microphone' : 'mdi:microphone-off'"
        :aria-pressed="dialog.hasMicrophone"
        :title="micToggleTitle"
        @click="dialog.toggleMicrophone()"
      >
        <span>{{
          dialog.hasMicrophone
            ? t('dialog.microphoneOn')
            : t('dialog.microphoneOff')
        }}</span>
      </Button>
    </div>

    <div v-if="!isIdle" class="dialog-toolbar-levels">
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

    <IconButton
      icon="mdi:picture-in-picture-bottom-right-outline"
      :label="t('dialog.collapse')"
      :disabled="!dialog.isActive"
      @click="dialog.showSubtitles()"
    />
    <IconButton
      class="dialog-toolbar-history"
      :variant="dialog.isHistoryOpen ? 'neutral' : 'ghost'"
      :active="dialog.isHistoryOpen"
      :aria-pressed="dialog.isHistoryOpen"
      icon="mdi:history"
      :label="t('dialog.history')"
      :title="t('dialog.history')"
      @click="dialog.isHistoryOpen = !dialog.isHistoryOpen"
    />
    <Button
      class="dialog-toolbar-new"
      variant="primary"
      size="sm"
      icon="mdi:plus"
      :disabled="dialog.isActive"
      :title="t('dialog.newDialog')"
      @click="handleClear"
    >
      {{ t('dialog.newDialog') }}
    </Button>
    <ConfirmModal
      :open="isClearConfirmOpen"
      :title="t('dialog.clearTitle')"
      :message="clearModalMessage"
      :confirm-text="t('dialog.clearConfirm')"
      @confirm="confirmClear"
      @cancel="isClearConfirmOpen = false"
    />
    <Teleport to="body">
      <Transition name="notice-fade">
        <div
          v-if="isRecordingNoticeOpen"
          ref="recordingNoticePanelRef"
          class="dialog-recording-notice-popover"
          :style="recordingNoticePanelStyle"
          :data-theme="recordingNoticePanelTheme"
          role="region"
          :aria-label="t('dialog.recordingNoticeTitle')"
          tabindex="-1"
          @focusout="onRecordingNoticeFocusout"
          @keydown="onRecordingNoticeKeydown"
        >
          <div class="dialog-recording-notice-content">
            <AppIcon
              icon="mdi:information-outline"
              size="md"
              class="dialog-recording-notice-icon"
            />
            <p class="dialog-recording-notice-text">
              {{ t('dialog.recordingNoticeMessage') }}
            </p>
          </div>
          <div class="dialog-recording-notice-actions">
            <Button size="xs" variant="primary" @click="confirmRecordingNotice">
              {{ t('dialog.recordingNoticeConfirm') }}
            </Button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import { useAnchoredPanel } from '../../composables/use-anchored-panel'
import {
  isWithinDismissibleLayer,
  useDismissibleLayer,
} from '../../composables/use-dismissible-layer'
import { useI18n } from '../../composables/use-i18n'
import { formatRecordingElapsed } from '../../lib/dialog/dialog-recording'
import type { DialogSide } from '../../lib/dialog/dialog-transcript'
import { useDialogStore } from '../../stores/dialog'
import AppIcon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import IconButton from '../common/IconButton.vue'
import DialogLanguageRoute from './DialogLanguageRoute.vue'
import DialogLevel from './DialogLevel.vue'

const dialog = useDialogStore()
const { t } = useI18n()

const isIdle = computed(
  () => dialog.status === 'idle' || dialog.status === 'failed'
)
const isStopping = computed(() => dialog.status === 'stopping')
const isEmpty = computed(() => !dialog.hasContent)
const isClearConfirmOpen = ref(false)
const isRecordingNoticeOpen = ref(false)
const recordContainerRef = ref<HTMLElement | null>(null)
const recordingNoticePanelRef = ref<HTMLElement | null>(null)

const { style: recordingNoticePanelStyle, theme: recordingNoticePanelTheme } =
  useAnchoredPanel({
    isOpen: () => isRecordingNoticeOpen.value,
    anchor: () => recordContainerRef.value?.querySelector('button') ?? null,
    panel: () => recordingNoticePanelRef.value,
    placement: () => 'bottom',
    align: () => 'start',
  })

function closeRecordingNotice() {
  isRecordingNoticeOpen.value = false
}

function onRecordingNoticeKeydown(event: KeyboardEvent) {
  if (isRecordingNoticeOpen.value && event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeRecordingNotice()
    recordContainerRef.value?.querySelector('button')?.focus()
  }
}

async function onRecordingNoticeFocusout(event: FocusEvent) {
  const elements = [recordContainerRef.value, recordingNoticePanelRef.value]
  if (event.relatedTarget instanceof Node) {
    if (!isWithinDismissibleLayer(elements, event.relatedTarget)) {
      closeRecordingNotice()
    }
    return
  }
  await nextTick()
  if (!isWithinDismissibleLayer(elements, document.activeElement)) {
    closeRecordingNotice()
  }
}

useDismissibleLayer({
  isOpen: () => isRecordingNoticeOpen.value,
  elements: () => [recordContainerRef.value, recordingNoticePanelRef.value],
  dismiss: closeRecordingNotice,
  keydown: onRecordingNoticeKeydown,
})

// a recording belongs to its dialog history entry: nothing would keep it otherwise
const canRecord = computed(() => dialog.isHistoryEnabled)

const isRecordToggleDisabled = computed(() => !canRecord.value || !isIdle.value)

const recordToggleTitle = computed(() => {
  if (!canRecord.value) return t('dialog.startRecordingNeedsHistory')
  if (!isIdle.value) return t('dialog.recordStopToChangeHint')
  return dialog.isRecordEnabled
    ? t('dialog.recordToggleDisableHint')
    : t('dialog.recordToggleEnableHint')
})

const runButtonTitle = computed(() => {
  const isRecording = dialog.isRecordEnabled && canRecord.value
  if (isEmpty.value) {
    return isRecording
      ? t('dialog.listenTooltipWithRecord')
      : t('dialog.listenTooltip')
  }
  return isRecording
    ? t('dialog.resumeTooltipWithRecord')
    : t('dialog.resumeTooltip')
})

const micToggleTitle = computed(() =>
  dialog.hasMicrophone
    ? t('dialog.microphoneOnHint')
    : t('dialog.microphoneOffHint')
)

const isRecordingRunning = computed(
  () => !isIdle.value && Boolean(dialog.recording)
)

const now = ref(Date.now())
let recordTimer: ReturnType<typeof setInterval> | undefined

watch(
  () => dialog.recording?.startedAtMs,
  (startedAt) => {
    if (startedAt) {
      now.value = Date.now()
      if (!recordTimer) {
        recordTimer = setInterval(() => {
          now.value = Date.now()
        }, 1000)
      }
    } else if (recordTimer) {
      clearInterval(recordTimer)
      recordTimer = undefined
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  if (recordTimer) clearInterval(recordTimer)
})

const elapsed = computed(() => {
  const startedAt = dialog.recording?.startedAtMs
  if (!startedAt) return ''
  return formatRecordingElapsed(now.value - startedAt)
})

function handleToggleRecord() {
  if (isRecordToggleDisabled.value) return

  if (!dialog.isRecordEnabled) {
    dialog.isRecordEnabled = true
    if (!dialog.config.isRecordingNoticeAcknowledged) {
      isRecordingNoticeOpen.value = true
    }
  } else {
    dialog.isRecordEnabled = false
    isRecordingNoticeOpen.value = false
  }
}

async function confirmRecordingNotice() {
  isRecordingNoticeOpen.value = false
  await dialog.acknowledgeRecordingNotice()
}

function handleRun() {
  void dialog.start({ isRecording: dialog.isRecordEnabled && canRecord.value })
}

const clearModalMessage = computed(() =>
  canRecord.value ? t('dialog.clearMessageSaved') : t('dialog.clearMessage')
)

function handleClear() {
  if (canRecord.value) {
    void dialog.clear()
    return
  }
  isClearConfirmOpen.value = true
}

function confirmClear() {
  isClearConfirmOpen.value = false
  void dialog.clear()
}

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

/* the same width while it reads Listen, Resume, Stop or Stopping */
.dialog-toolbar-run {
  min-width: 7.5rem;
  justify-content: center;
}

.dialog-toolbar-actions {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.dialog-toolbar-record-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  min-width: 5.5rem;
  justify-content: center;
  font-variant-numeric: tabular-nums;
}

.dialog-toolbar-record-toggle:disabled {
  pointer-events: auto;
  cursor: not-allowed;
}

.dialog-toolbar-record-toggle.is-running {
  cursor: default;
  opacity: 1;
}

.dialog-toolbar-record-toggle.is-running:is(:disabled, .btn-disabled) {
  color: var(--color-base-content);
  --btn-bg: var(--color-base-200);
  --btn-border: var(--app-border-subtle);
}

.dialog-toolbar-record-toggle.is-armed {
  color: var(--color-error);
  --btn-border: color-mix(in oklab, var(--color-error) 55%, transparent);
  --btn-bg: color-mix(in oklab, var(--color-error) 10%, transparent);
}

.dialog-record-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--color-error);
  flex-shrink: 0;
}

.dialog-record-dot-pulsing {
  animation: dialog-record-pulse 1.6s ease-in-out infinite;
}

@keyframes dialog-record-pulse {
  50% {
    opacity: 0.35;
  }
}

@media (prefers-reduced-motion: reduce) {
  .dialog-record-dot-pulsing {
    animation: none;
  }
}

.dialog-record-rec {
  font-weight: 600;
  letter-spacing: 0.04em;
  font-size: var(--text-caption);
  color: var(--color-error);
}

.dialog-record-timer {
  font-variant-numeric: tabular-nums;
  font-size: var(--text-caption);
}

.dialog-toolbar-mic-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  min-width: 5.5rem;
  justify-content: center;
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
.dialog-toolbar :deep(.dialog-route),
.dialog-toolbar > .dialog-route {
  flex-shrink: 1;
  min-width: 0;
}

/* narrower still, the sources keep their icons, the tooltips name them */
@media (max-width: 36rem) {
  .dialog-toolbar-source :deep(.option-label) {
    display: none;
  }
}

.dialog-toolbar-record-container {
  display: inline-flex;
  min-width: 0;
}

.dialog-recording-notice-popover {
  z-index: var(--z-popover);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  width: 18rem;
  max-width: calc(100vw - 2 * var(--space-md));
  padding: var(--space-sm) var(--space-md);
  background-color: var(--app-surface-raised);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--app-shadow-lg);
  outline: none;
}

.dialog-recording-notice-content {
  display: flex;
  align-items: flex-start;
  gap: var(--space-xs);
}

.dialog-recording-notice-icon {
  flex-shrink: 0;
  margin-top: 0.125rem;
  color: var(--color-primary);
}

.dialog-recording-notice-text {
  margin: 0;
  font-size: var(--text-caption);
  line-height: 1.45;
  color: var(--color-base-content);
}

.dialog-recording-notice-actions {
  display: flex;
  justify-content: flex-end;
}

.notice-fade-enter-active,
.notice-fade-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}

.notice-fade-enter-from,
.notice-fade-leave-to {
  opacity: 0;
  transform: translateY(3px);
}
</style>
