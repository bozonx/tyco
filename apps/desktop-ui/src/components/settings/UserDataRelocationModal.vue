<template>
  <BaseDialog
    :open="Boolean(model.action.value)"
    :labelledby="titleId"
    @close="model.cancel"
  >
    <div class="user-data-modal">
      <h3 :id="titleId" class="user-data-modal-title">
        {{ title }}
      </h3>

      <div class="user-data-modal-row">
        <span class="user-data-modal-label">{{
          t('settings.userData.current')
        }}</span>
        <code class="user-data-modal-path">{{ currentPath || '—' }}</code>
      </div>

      <template v-if="model.target.value && relocation">
        <div class="user-data-modal-row">
          <span class="user-data-modal-label">{{
            t('settings.userData.target')
          }}</span>
          <code class="user-data-modal-path">{{
            model.target.value.path
          }}</code>
        </div>
        <InlineNotice
          density="compact"
          appearance="surface"
          :kind="relocation.notice.kind"
          :message="
            t(relocation.notice.messageKey, {
              current: currentPath,
              path: model.target.value.path,
            })
          "
        />
        <div v-if="relocation.subfolderPath" class="user-data-modal-actions">
          <Button
            size="sm"
            variant="neutral"
            icon="mdi:folder-plus-outline"
            :disabled="model.isBusy.value"
            @click="model.useSubfolder"
          >
            {{ t('settings.userData.useSubfolder') }}
          </Button>
        </div>
        <p v-if="relocation.mode" class="user-data-modal-restart">
          {{ t('settings.userData.restartNotice') }}
        </p>
      </template>

      <InlineNotice
        v-if="model.errorMessage.value"
        density="compact"
        kind="error"
        announcement="polite"
        :message="model.errorMessage.value"
      />

      <div class="user-data-modal-actions">
        <Button
          size="sm"
          variant="ghost"
          :disabled="model.isApplying.value"
          @click="model.cancel"
        >
          {{ t('common.cancel') }}
        </Button>
        <Button
          v-if="relocation?.mode"
          size="sm"
          variant="primary"
          :disabled="model.isBusy.value"
          @click="model.apply"
        >
          {{ applyLabel }}
        </Button>
        <Button
          v-else
          size="sm"
          variant="neutral"
          icon="mdi:folder-search-outline"
          :disabled="model.isBusy.value"
          @click="model.pickFolder"
        >
          {{ t('settings.selectFolder') }}
        </Button>
      </div>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, useId } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import type { UserDataFolderModel } from '../../lib/storage/user-data-folder-model'
import BaseDialog from '../common/BaseDialog.vue'
import Button from '../common/Button.vue'
import InlineNotice from '../common/InlineNotice.vue'

const props = defineProps<{ model: UserDataFolderModel; currentPath: string }>()

const { t } = useI18n()
const titleId = useId()
const relocation = computed(() => props.model.relocation.value)

const title = computed(() => {
  if (relocation.value?.mode === 'move') return t('settings.userData.moveTitle')
  if (
    relocation.value?.mode === 'connect' ||
    props.model.action.value === 'connect'
  )
    return t('settings.userData.connectTitle')
  return t('settings.userData.title')
})

const applyLabel = computed(() =>
  relocation.value?.mode === 'move'
    ? t('settings.userData.applyMove')
    : t('settings.userData.applyConnect')
)
</script>

<style scoped>
.user-data-modal {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  min-width: min(32rem, 80vw);
}

.user-data-modal-title {
  margin: 0;
  color: var(--color-base-content);
  font-size: var(--text-title);
  font-weight: 600;
}

.user-data-modal-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
}

.user-data-modal-label,
.user-data-modal-restart {
  margin: 0;
  color: var(--app-text-muted);
  font-size: var(--text-control);
}

.user-data-modal-path {
  overflow-wrap: anywhere;
  font-size: var(--text-control);
}

.user-data-modal-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-xs);
}
</style>
