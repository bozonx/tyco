<template>
  <div class="dialog-view">
    <DialogToolbar />
    <DialogSelectionToolbar v-if="dialog.hasSelection" />
    <InlineNotice
      v-if="showHeadphonesNotice"
      class="dialog-headphones-notice"
      kind="info"
      density="compact"
      icon="mdi:headphones"
      :message="t('dialog.headphonesNotice')"
    >
      <Button size="xs" variant="ghost" @click="confirmHeadphonesNotice">{{
        t('dialog.headphonesNoticeConfirm')
      }}</Button>
    </InlineNotice>
    <InlineNotice
      v-if="dialog.errorText"
      class="dialog-error"
      kind="error"
      announcement="assertive"
      density="compact"
      :message="dialog.errorText"
    >
      <Button
        v-if="dialog.canFixInSettings"
        size="xs"
        @click="openSttSettings"
        >{{ t('common.openSettings') }}</Button
      >
    </InlineNotice>
    <div class="dialog-content">
      <div class="dialog-body">
        <DialogFeed
          :items="dialog.feedItems"
          :is-bubble="isBubble"
          :is-translation-only="dialog.config.isTranslationOnly"
          :translation-lang="dialog.effectiveTranslationLanguage || undefined"
          :dialog-id="dialog.currentDialogId"
          :recording-exists="dialog.recordingExists"
          :incomplete-recording-files="dialog.incompleteRecordingFiles"
          :selected-turn-ids="dialog.selectedTurnIds"
          @retry="retryTranslation"
          @select-turn="
            (id, isShift) => dialog.toggleTurnSelection(id, isShift)
          "
        >
          <template #empty>
            <StateMessage
              class="dialog-empty"
              :icon="emptyIcon"
              :title="emptyTitle"
              :message="emptyMessage"
            >
              <p v-if="dialog.hasMicrophone" class="dialog-empty-hint">
                <AppIcon icon="mdi:headphones" size="sm" class="shrink-0" />
                <span>{{ t('dialog.emptyHeadphonesHint') }}</span>
              </p>
            </StateMessage>
          </template>
        </DialogFeed>
      </div>
      <button
        v-if="dialog.isHistoryOpen"
        type="button"
        tabindex="-1"
        class="history-backdrop"
        :aria-label="t('common.close')"
        @pointerdown="preventMouseFocus"
        @click="dialog.isHistoryOpen = false"
      />
      <DialogHistoryPanel
        v-if="dialog.isHistoryOpen"
        class="dialog-history-drawer"
        @navigate="closeMobileHistory"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'

import AppIcon from '../components/common/AppIcon.vue'
import Button from '../components/common/Button.vue'
import InlineNotice from '../components/common/InlineNotice.vue'
import StateMessage from '../components/common/StateMessage.vue'
import DialogFeed from '../components/dialog/DialogFeed.vue'
import DialogHistoryPanel from '../components/dialog/DialogHistoryPanel.vue'
import DialogSelectionToolbar from '../components/dialog/DialogSelectionToolbar.vue'
import DialogToolbar from '../components/dialog/DialogToolbar.vue'
import { useI18n } from '../composables/use-i18n'
import { preventMouseFocus } from '../lib/ui/focus'
import { appNavigation } from '../navigation'
import { useDialogStore } from '../stores/dialog'

const dialog = useDialogStore()
const { t } = useI18n()

const showHeadphonesNotice = computed(
  () => dialog.hasMicrophone && !dialog.config.isHeadphonesNoticeAcknowledged
)

async function confirmHeadphonesNotice() {
  await dialog.acknowledgeHeadphonesNotice()
}

// the mode turned off in the settings takes its view away
watch(
  () => dialog.isEnabled,
  (isEnabled) => {
    if (!isEnabled) void appNavigation.goToEditor()
  }
)

/** Bubbles on both sides when the user is heard too, else paragraphs */
const isBubble = computed(() => dialog.hasMicrophone)

const emptyIcon = computed(() => {
  if (dialog.isActive) return 'mdi:waveform'
  return dialog.hasMicrophone ? 'mdi:account-voice' : 'mdi:monitor-speaker'
})

const emptyTitle = computed(() => {
  if (dialog.isActive) return t('dialog.waitingForSpeech')
  return dialog.hasMicrophone
    ? t('dialog.emptyTitleCall')
    : t('dialog.emptyTitleComputer')
})

const emptyMessage = computed(() => {
  if (dialog.isActive) return t('dialog.waitingForSpeechHint')
  return dialog.hasMicrophone
    ? t('dialog.emptyHintCall')
    : t('dialog.emptyHintComputer')
})

function retryTranslation(ids: string[]) {
  for (const id of ids) dialog.retryTranslation(id)
}

function openSttSettings() {
  void appNavigation.goToConfig('voice')
}

function closeMobileHistory() {
  if (window.matchMedia('(max-width: 47.5rem)').matches)
    dialog.isHistoryOpen = false
}
</script>

<style scoped>
.dialog-view {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  background-color: var(--app-surface);
}

.dialog-content {
  position: relative;
  flex: 1 1 0%;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: row;
}

.history-backdrop {
  display: none;
}

.dialog-history-drawer {
  flex-shrink: 0;
}

.dialog-error,
.dialog-headphones-notice {
  margin: var(--space-sm) var(--space-md) 0;
}

.dialog-body {
  position: relative;
  flex: 1 1 0%;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.dialog-empty {
  flex: 1 1 0%;
  max-width: 26rem;
  margin: auto;
}

.dialog-empty-hint {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  margin: var(--space-xs) 0 0;
  font-size: var(--text-caption);
  color: var(--app-text-faint);
}

@media (max-width: 47.5rem) {
  .history-backdrop {
    display: block;
    position: absolute;
    inset: 0;
    z-index: calc(var(--z-popover) - 2);
    border: none;
    background-color: var(--app-backdrop, rgb(0 0 0 / 0.3));
    cursor: default;
  }

  .dialog-history-drawer {
    position: absolute;
    top: 0;
    bottom: 0;
    right: 0;
    left: auto;
    z-index: calc(var(--z-popover) - 1);
    box-shadow: var(--app-shadow-lg);
  }
}
</style>
