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

      <InlineNotice
        v-if="!toExternal && !hasSourceFolder"
        :message="t('settings.projectConvertNoSourceFolder')"
      />
      <template v-else-if="!toExternal">
        <FieldCheckbox
          v-model="transferFiles"
          :disabled="isBusy"
          :label="t('settings.projectConvertTransferFiles')"
          data-testid="convert-transfer"
        />
        <template v-if="transferFiles">
          <p class="convert-dialog-note">
            {{ t('settings.projectConvertSourceStays') }}
          </p>
          <FieldCheckbox
            v-model="trashSource"
            :disabled="isBusy || isFolderShared"
            :label="t('settings.projectConvertTrashSource')"
            data-testid="convert-trash"
          />
          <InlineNotice
            v-if="isFolderShared"
            density="compact"
            :message="t('settings.projectConvertTrashShared')"
          />
        </template>
        <InlineNotice
          v-else
          kind="warning"
          :message="t('settings.projectConvertNoTransfer')"
        />
      </template>

      <template v-if="isTransferring">
        <p
          v-if="preview"
          class="convert-dialog-summary"
          data-testid="convert-summary"
        >
          {{ summary }}
        </p>
        <StateMessage
          v-else-if="isInspecting"
          kind="loading"
          density="compact"
          :message="t('settings.projectConvertCounting')"
        />
        <InlineNotice
          v-if="inspectError"
          kind="error"
          :message="inspectError"
        />
        <InlineNotice
          v-for="message in check.blockers"
          :key="message.key"
          kind="error"
          :message="t(message.key, message.params ?? {})"
        />
        <InlineNotice
          v-for="message in check.notices"
          :key="message.key"
          :message="t(message.key, message.params ?? {})"
        />
        <p class="convert-dialog-note">
          {{ t('settings.projectConvertSafety') }}
        </p>
      </template>

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
          {{
            toExternal
              ? t('settings.projectConvertConfirmExternal')
              : t('settings.projectConvertConfirmInternal')
          }}
        </Button>
      </div>
    </form>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import type { ConvertProjectOptions } from '../../lib/ai-profiles/ai-projects-model'
import {
  checkProjectTransfer,
  formatByteSize,
} from '../../lib/ai-profiles/project-files'
import { describeError } from '../../lib/errors/describe-error'
import BaseDialog from '../common/BaseDialog.vue'
import Button from '../common/Button.vue'
import FieldCheckbox from '../common/FieldCheckbox.vue'
import InlineNotice from '../common/InlineNotice.vue'
import StateMessage from '../common/StateMessage.vue'
import SettingsProjectFolderField from './SettingsProjectFolderField.vue'
import type { ProjectTransferPreview } from '@tyco/shared'

const props = defineProps<{
  open: boolean
  /** The project is internal now and becomes external */
  toExternal: boolean
  /** An external project has its folder on this device to copy from */
  hasSourceFolder: boolean
  isBusy?: boolean
  selectFolder: () => Promise<string | null>
  /** What the conversion would transfer into `targetPath` */
  inspect: (targetPath?: string) => Promise<ProjectTransferPreview>
}>()

const emit = defineEmits<{
  confirm: [options: ConvertProjectOptions]
  cancel: []
}>()

const i18n = useI18n()
const { t } = i18n
const titleId = useId()
const messageId = useId()

const targetPath = ref('')
const transferFiles = ref(true)
const trashSource = ref(false)
const preview = ref<ProjectTransferPreview | null>(null)
const isInspecting = ref(false)
const inspectError = ref('')

/** An internal project always moves its files; an external one may not */
const isTransferring = computed(
  () => props.toExternal || (props.hasSourceFolder && transferFiles.value)
)
const isFolderShared = computed(
  () => (preview.value?.sharedFolderCount ?? 0) > 0
)
const check = computed(() =>
  preview.value
    ? checkProjectTransfer(preview.value, {
        toExternal: props.toExternal,
        isTransferring: isTransferring.value,
      })
    : { blockers: [], notices: [] }
)
const summary = computed(() => {
  const files = preview.value?.files
  if (!files || files.fileCount === 0)
    return t('settings.projectConvertNoFiles')
  return t('settings.projectConvertFileSummary', {
    count: files.fileCount,
    size: formatByteSize(files.totalBytes, i18n.locale?.value ?? 'en-US'),
  })
})
const isValid = computed(() => {
  if (props.isBusy) return false
  if (props.toExternal && !targetPath.value.trim()) return false
  if (!isTransferring.value) return true
  return (
    Boolean(preview.value) &&
    !isInspecting.value &&
    check.value.blockers.length === 0
  )
})

let inspectRequest = 0
async function loadPreview() {
  const request = ++inspectRequest
  isInspecting.value = true
  inspectError.value = ''
  try {
    const loaded = await props.inspect(targetPath.value.trim() || undefined)
    if (request === inspectRequest) preview.value = loaded
  } catch (error) {
    if (request === inspectRequest) {
      preview.value = null
      inspectError.value = describeError(error, t)
    }
  } finally {
    if (request === inspectRequest) isInspecting.value = false
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    targetPath.value = ''
    transferFiles.value = props.hasSourceFolder
    trashSource.value = false
    preview.value = null
    inspectError.value = ''
    if (props.toExternal || props.hasSourceFolder) void loadPreview()
  }
)

async function pickFolder() {
  const picked = await props.selectFolder()
  if (!picked) return
  targetPath.value = picked
  await loadPreview()
}

function submit() {
  if (!isValid.value) return
  const isCopying = !props.toExternal && isTransferring.value
  emit('confirm', {
    targetPath: props.toExternal ? targetPath.value.trim() : undefined,
    transferFiles: isCopying,
    trashSource: isCopying && trashSource.value && !isFolderShared.value,
  })
}
</script>

<style scoped>
.convert-dialog-box {
  width: min(100% - 2 * var(--space-lg), 32rem);
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

.convert-dialog-message,
.convert-dialog-summary {
  margin: 0;
  color: var(--color-base-content);
  font-size: var(--text-body);
  line-height: 1.5;
}

.convert-dialog-note {
  margin: 0;
  color: var(--app-text-muted);
  font-size: var(--text-caption);
  line-height: 1.5;
}

.convert-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
}
</style>
