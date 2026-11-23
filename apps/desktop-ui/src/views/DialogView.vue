<template>
  <div class="dialog-page">
    <DialogToolbar />
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
    <div class="dialog-body">
      <DialogFeed
        :items="dialog.feedItems"
        :is-bubble="isBubble"
        :is-translation-only="dialog.config.isTranslationOnly"
        :translation-lang="dialog.config.translationTargetLanguage || undefined"
        @retry="retryTranslation"
      >
        <template #empty>
          <StateMessage
            class="dialog-empty"
            :icon="emptyIcon"
            :title="emptyTitle"
            :message="emptyMessage"
          >
            <p
              v-if="dialog.config.source === 'microphoneAndSystem'"
              class="dialog-empty-hint"
            >
              <AppIcon icon="mdi:headphones" size="sm" class="shrink-0" />
              <span>{{ t('dialog.emptyHeadphonesHint') }}</span>
            </p>
          </StateMessage>
        </template>
      </DialogFeed>
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
import DialogToolbar from '../components/dialog/DialogToolbar.vue'
import { useI18n } from '../composables/use-i18n'
import { appNavigation } from '../navigation'
import { useDialogStore } from '../stores/dialog'

const dialog = useDialogStore()
const { t } = useI18n()

const showHeadphonesNotice = computed(
  () =>
    dialog.config.source === 'microphoneAndSystem' &&
    !dialog.config.isHeadphonesNoticeAcknowledged
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
const isBubble = computed(() =>
  dialog.isActive
    ? dialog.hasMicrophone
    : dialog.config.source === 'microphoneAndSystem'
)

const emptyIcon = computed(() => {
  if (dialog.isActive) return 'mdi:waveform'
  return dialog.config.source === 'microphoneAndSystem'
    ? 'mdi:account-voice'
    : 'mdi:monitor-speaker'
})

const emptyTitle = computed(() => {
  if (dialog.isActive) return t('dialog.waitingForSpeech')
  return dialog.config.source === 'microphoneAndSystem'
    ? t('dialog.emptyTitleCall')
    : t('dialog.emptyTitleComputer')
})

const emptyMessage = computed(() => {
  if (dialog.isActive) return t('dialog.waitingForSpeechHint')
  return dialog.config.source === 'microphoneAndSystem'
    ? t('dialog.emptyHintCall')
    : t('dialog.emptyHintComputer')
})

function retryTranslation(ids: string[]) {
  for (const id of ids) dialog.retryTranslation(id)
}

function openSttSettings() {
  void appNavigation.goToConfig('stt')
}
</script>

<style scoped>
.dialog-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.dialog-headphones-notice {
  margin: var(--space-sm) var(--space-md) 0;
}

.dialog-error {
  margin: var(--space-sm) var(--space-md) 0;
}

.dialog-body {
  position: relative;
  flex: 1 1 0%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.dialog-empty {
  margin: auto;
  max-width: 32rem;
}

.dialog-empty-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2xs);
  margin-top: var(--space-xs);
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}
</style>
