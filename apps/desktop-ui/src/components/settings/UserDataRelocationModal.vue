<template>
  <BaseDialog
    class="user-data-dialog"
    :open="Boolean(model.action.value)"
    :labelledby="titleId"
    @close="model.cancel"
  >
    <div class="user-data-modal">
      <h3 :id="titleId" class="user-data-modal-title">
        {{ title }}
      </h3>

      <FieldRow
        v-if="currentPath"
        class="user-data-modal-field"
        vertical
        :separator="false"
        :label="t('settings.userData.current')"
      >
        <PathDisplay :path="currentPath" />
      </FieldRow>

      <FieldCheckbox
        v-if="model.action.value === 'choose'"
        :model-value="model.moveCurrent.value"
        :disabled="model.isBusy.value"
        :label="t('settings.userData.moveCurrentFolder')"
        @update:model-value="model.setMoveCurrent"
      />

      <template v-if="model.target.value && relocation">
        <FieldRow
          class="user-data-modal-field"
          vertical
          :separator="false"
          :label="t('settings.userData.target')"
        >
          <PathDisplay :path="model.target.value.path" />
        </FieldRow>

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

        <div v-if="relocation.subfolderPath" class="user-data-modal-subfolder">
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

        <InlineNotice
          v-if="model.isConfirmingCrossDisk.value"
          density="compact"
          appearance="surface"
          kind="warning"
          announcement="polite"
          :message="
            t('settings.userData.crossDiskConfirm', {
              current: currentPath,
              path: model.target.value.path,
            })
          "
        />

        <p v-if="relocation.mode" class="user-data-modal-restart">
          {{ t('settings.userData.restartNotice') }}
        </p>
      </template>

      <InlineNotice
        v-if="model.errorMessage.value"
        density="compact"
        appearance="surface"
        kind="error"
        announcement="polite"
        :message="model.errorMessage.value"
      />

      <div class="user-data-modal-actions">
        <template v-if="model.isConfirmingCrossDisk.value">
          <Button
            size="sm"
            variant="ghost"
            :disabled="model.isApplying.value"
            @click="model.dismissCrossDiskConfirm"
          >
            {{ t('common.cancel') }}
          </Button>
          <Button
            size="sm"
            variant="primary"
            :disabled="model.isBusy.value"
            :loading="model.isApplying.value"
            @click="model.apply"
          >
            {{ t('settings.userData.applyMove') }}
          </Button>
        </template>
        <template v-else>
          <Button
            size="sm"
            variant="ghost"
            :disabled="model.isApplying.value"
            @click="model.cancel"
          >
            {{ t('common.cancel') }}
          </Button>
          <Button
            size="sm"
            :variant="relocation?.mode ? 'neutral' : 'primary'"
            icon="mdi:folder-search-outline"
            :disabled="model.isBusy.value"
            @click="model.pickFolder"
          >
            {{
              model.action.value === 'choose'
                ? t('settings.userData.selectLocation')
                : t('settings.selectFolder')
            }}
          </Button>
          <Button
            v-if="relocation?.mode"
            size="sm"
            variant="primary"
            :disabled="model.isBusy.value"
            :loading="model.isApplying.value"
            @click="model.apply"
          >
            {{ applyLabel }}
          </Button>
        </template>
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
import FieldCheckbox from '../common/FieldCheckbox.vue'
import FieldRow from '../common/FieldRow.vue'
import InlineNotice from '../common/InlineNotice.vue'
import PathDisplay from '../common/PathDisplay.vue'

const props = defineProps<{
  model: UserDataFolderModel
  currentPath?: string
}>()

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
.user-data-dialog {
  width: min(100% - 2 * var(--space-lg), 34rem);
}

.user-data-modal {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.user-data-modal-title {
  margin: 0;
  color: var(--color-base-content);
  font-size: var(--text-title);
  font-weight: 600;
  line-height: var(--leading-tight);
}

.user-data-modal-field {
  padding: 0;
}

.user-data-modal-field :deep(.field-row-control) {
  width: 100%;
}

.user-data-modal-restart {
  margin: 0;
  color: var(--app-text-muted);
  font-size: var(--text-caption);
  line-height: 1.4;
}

.user-data-modal-subfolder {
  display: flex;
}

.user-data-modal-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: var(--space-sm);
  margin-top: var(--space-xs);
}
</style>
