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
            :message="t('dialog.emptyHint')"
          />
        </template>
      </DialogFeed>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

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
</style>
