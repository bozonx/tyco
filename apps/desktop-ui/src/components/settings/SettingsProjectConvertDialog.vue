<template>
  <BaseDialog
    :open="open"
    :labelledby="titleId"
    :describedby="messageId"
    class="convert-dialog-box"
    @close="emit('cancel')"
  >
    <form class="convert-dialog" @submit.prevent="submit">
      <h3 :id="titleId" class="convert-dialog-title">
        {{
          toExternal
            ? t('settings.projectConvertToExternalTitle')
            : t('settings.projectConvertToInternalTitle')
        }}
      </h3>
      <p :id="messageId" class="convert-dialog-message">
        {{
          toExternal
            ? t('settings.projectConvertToExternalMessage')
            : t('settings.projectConvertToInternalMessage')
        }}
      </p>

      <SettingsProjectFolderField
        v-if="toExternal"
        :path="targetPath"
        :disabled="isBusy"
        @pick="pickFolder"
      />

      <FieldCheckbox
        v-model="transferFiles"
        :disabled="!canTransfer"
        :label="
          toExternal
            ? t('settings.projectConvertMoveFiles')
            : t('settings.projectConvertCopyFiles')
        "
        data-testid="convert-transfer"
      />
      <InlineNotice
        v-if="!transferFiles"
        kind="warning"
        :message="t('settings.projectConvertFilesStay')"
      />

      <div class="convert-dialog-actions">
        <Button size="sm" variant="ghost" @click="emit('cancel')">
          {{ t('common.cancel') }}
        </Button>
        <Button
          size="sm"
          variant="primary"
          type="submit"
          :disabled="!isValid"
          :loading="isBusy"
          data-testid="convert-confirm"
        >
          {{ t('settings.projectConvert') }}
        </Button>
      </div>
    </form>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import type { ConvertProjectOptions } from '../../lib/ai-profiles/ai-projects-model'
import BaseDialog from '../common/BaseDialog.vue'
import Button from '../common/Button.vue'
import FieldCheckbox from '../common/FieldCheckbox.vue'
import InlineNotice from '../common/InlineNotice.vue'
import SettingsProjectFolderField from './SettingsProjectFolderField.vue'

const props = defineProps<{
  open: boolean
  /** The project is internal now and becomes external */
  toExternal: boolean
  /** An external project has its folder on this device to copy from */
  hasSourceFolder: boolean
  isBusy?: boolean
  selectFolder: () => Promise<string | null>
}>()

const emit = defineEmits<{
  confirm: [options: ConvertProjectOptions]
  cancel: []
}>()

const { t } = useI18n()
const titleId = useId()
const messageId = useId()

const targetPath = ref('')
const transferFiles = ref(true)
const canTransfer = computed(() => props.toExternal || props.hasSourceFolder)
const isValid = computed(
  () => !props.toExternal || Boolean(targetPath.value.trim())
)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    targetPath.value = ''
    transferFiles.value = canTransfer.value
  }
)

async function pickFolder() {
  const picked = await props.selectFolder()
  if (picked) targetPath.value = picked
}

function submit() {
  if (!isValid.value || props.isBusy) return
  emit('confirm', {
    targetPath: props.toExternal ? targetPath.value.trim() : undefined,
    transferFiles: transferFiles.value && canTransfer.value,
  })
}
</script>

<style scoped>
.convert-dialog-box {
  width: min(100% - 2 * var(--space-lg), 30rem);
}

.convert-dialog {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.convert-dialog-title {
  margin: 0;
  color: var(--color-base-content);
  font-size: var(--text-title);
  font-weight: 600;
}

.convert-dialog-message {
  margin: 0;
  color: var(--app-text-muted);
  font-size: var(--text-body);
  line-height: 1.5;
}

.convert-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
}
</style>
