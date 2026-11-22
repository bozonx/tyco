<template>
  <div class="dialog-page">
    <DialogToolbar />
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
        :turns="dialog.turns"
        :is-bubble="isBubble"
        :text-display="textDisplay"
        :translation-lang="dialog.config.translationTargetLanguage || undefined"
        @retry="retryTranslation"
      >
        <template #empty>
          <StateMessage
            class="dialog-empty"
            icon="mdi:account-voice"
            :title="emptyTitle"
            :message="emptyMessage"
          />
        </template>
      </DialogFeed>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'

import Button from '../components/common/Button.vue'
import InlineNotice from '../components/common/InlineNotice.vue'
import StateMessage from '../components/common/StateMessage.vue'
import DialogFeed from '../components/dialog/DialogFeed.vue'
import DialogToolbar from '../components/dialog/DialogToolbar.vue'
import { useI18n } from '../composables/use-i18n'
import { dialogRouteLabel } from '../lib/dialog/dialog-languages'
import { translationLanguageLabel } from '../lib/translation/translation-languages'
import { appNavigation } from '../navigation'
import { useDesktopStore } from '../stores/desktop'
import { useDialogStore } from '../stores/dialog'

const dialog = useDialogStore()
const desktopStore = useDesktopStore()
const { t, locale } = useI18n()

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
const textDisplay = computed(() =>
  dialog.config.translationTargetLanguage
    ? dialog.config.textDisplay
    : 'original'
)
const emptyTitle = computed(() =>
  dialog.isActive ? t('dialog.waitingForSpeech') : t('dialog.emptyTitle')
)

const isDeepgram = computed(
  () => desktopStore.userConfig.stt?.provider === 'deepgram'
)
/** Before the start, the hint ends with what the dialog is set to do */
const emptyMessage = computed(() => {
  if (dialog.isActive) return t('dialog.emptyHint')
  const source =
    dialog.config.source === 'microphoneAndSystem'
      ? t('dialog.sourceCall')
      : t('dialog.sourceComputer')
  const route = dialogRouteLabel({
    translationTargetLanguage: dialog.config.translationTargetLanguage,
    remoteLanguage: isDeepgram.value
      ? (dialog.config.remoteLanguage ?? 'auto')
      : undefined,
    labelOf: (id) => translationLanguageLabel(id, String(locale.value)),
    translate: t,
  })
  return `${t('dialog.emptyHint')}\n\n${source} · ${route}`
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
}

/* the hint and, apart, what the dialog is set to do */
.dialog-empty :deep(.ui-state-message) {
  white-space: pre-line;
}
</style>
