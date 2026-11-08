<template>
  <BaseDialog
    class="create-variable-dialog"
    :open="open"
    :labelledby="titleId"
    @close="close"
  >
    <form class="create-variable-modal" @submit.prevent="handleSubmit">
      <div class="create-variable-modal-header">
        <h3 :id="titleId" class="create-variable-modal-title">
          {{ t('variables.addTitle') }}
        </h3>
        <IconButton
          icon="mdi:close"
          size="sm"
          variant="ghost"
          :label="t('common.cancel')"
          @click="close"
        />
      </div>

      <FieldRow
        class="create-variable-field"
        vertical
        :separator="false"
        :label="t('variables.name')"
        :hint="t('variables.nameHint')"
        :error="nameError"
      >
        <FieldInput
          ref="inputRef"
          v-model="name"
          class="font-mono"
          placeholder="NOTES_DIR"
          data-testid="variable-new-name"
          @update:model-value="nameError = undefined"
        />
      </FieldRow>

      <FieldRow
        class="create-variable-field"
        vertical
        :separator="false"
        :label="t('variables.description')"
      >
        <FieldInput
          v-model="description"
          :placeholder="t('variables.description')"
        />
      </FieldRow>

      <FieldRow
        class="create-variable-field"
        vertical
        :separator="false"
        :label="t('variables.valueOnDevice')"
        :hint="t('variables.valueOnDeviceHint')"
      >
        <VariableValueInput
          ref="valueRef"
          v-model="value"
          test-id="variable-new-value"
        />
      </FieldRow>

      <div class="create-variable-modal-actions">
        <Button size="sm" variant="ghost" type="button" @click="close">
          {{ t('common.cancel') }}
        </Button>
        <Button
          size="sm"
          variant="primary"
          type="submit"
          data-testid="variable-add"
        >
          {{ t('variables.add') }}
        </Button>
      </div>
    </form>
  </BaseDialog>
</template>

<script setup lang="ts">
import { nextTick, ref, useId, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import { addVariable } from '../../lib/variables/variables-settings'
import BaseDialog from '../common/BaseDialog.vue'
import Button from '../common/Button.vue'
import FieldInput from '../common/FieldInput.vue'
import FieldRow from '../common/FieldRow.vue'
import IconButton from '../common/IconButton.vue'
import VariableValueInput from './VariableValueInput.vue'

/** `initialName` fills the name, e.g. for a reference not declared yet */
const props = defineProps<{ open: boolean; initialName?: string }>()

const emit = defineEmits<{ close: []; created: [id: string] }>()

const { t } = useI18n()
const { draft } = useSettingsContext()
const titleId = useId()

const name = ref('')
const description = ref('')
const value = ref('')
const nameError = ref<string>()
const inputRef = ref<{ focus?: () => void } | null>(null)
const valueRef = ref<{ focus?: () => void } | null>(null)

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      name.value = props.initialName ?? ''
      description.value = ''
      value.value = ''
      nameError.value = undefined
      void nextTick(() => {
        const field = props.initialName ? valueRef.value : inputRef.value
        field?.focus?.()
      })
    }
  },
  { immediate: true }
)

function handleSubmit() {
  const result = addVariable(
    draft.value,
    name.value,
    description.value,
    value.value
  )
  if (!result.ok) {
    nameError.value = t(result.issueKey)
    return
  }
  emit('close')
  emit('created', result.variable.id)
}

function close() {
  emit('close')
}
</script>

<style scoped>
.create-variable-dialog {
  width: min(100% - 2 * var(--space-lg), 28rem);
}

.create-variable-modal {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

.create-variable-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}

.create-variable-modal-title {
  margin: 0;
  color: var(--color-base-content);
  font-size: var(--text-title);
  font-weight: 600;
  line-height: var(--leading-tight);
}

.create-variable-field {
  padding: 0;
}

.create-variable-field :deep(.field-row-control) {
  width: 100%;
}

.create-variable-field :deep(.input) {
  width: 100%;
  max-width: 100%;
}

.create-variable-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
}
</style>
