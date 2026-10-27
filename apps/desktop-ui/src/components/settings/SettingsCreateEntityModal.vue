<template>
  <BaseDialog
    class="create-entity-dialog"
    :open="open"
    :labelledby="titleId"
    @close="close"
  >
    <form class="create-entity-modal" @submit.prevent="handleSubmit">
      <h3 :id="titleId" class="create-entity-modal-title">
        {{ title }}
      </h3>

      <FieldRow
        class="create-entity-field"
        vertical
        :separator="false"
        :label="label"
      >
        <FieldInput
          ref="inputRef"
          v-model="name"
          :placeholder="placeholder"
          autofocus
          :disabled="isSubmitting"
        />
      </FieldRow>

      <div class="create-entity-modal-actions">
        <Button
          size="sm"
          variant="ghost"
          type="button"
          :disabled="isSubmitting"
          @click="close"
        >
          {{ t('common.cancel') }}
        </Button>
        <Button
          size="sm"
          variant="primary"
          type="submit"
          :disabled="!name.trim() || isSubmitting"
        >
          {{ confirmText || t('common.confirm') }}
        </Button>
      </div>
    </form>
  </BaseDialog>
</template>

<script setup lang="ts">
import { nextTick, ref, useId, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import BaseDialog from '../common/BaseDialog.vue'
import Button from '../common/Button.vue'
import FieldInput from '../common/FieldInput.vue'
import FieldRow from '../common/FieldRow.vue'

const props = defineProps<{
  open: boolean
  title: string
  label: string
  placeholder?: string
  confirmText?: string
  isSubmitting?: boolean
}>()

const emit = defineEmits<{ close: []; submit: [name: string] }>()

const { t } = useI18n()
const titleId = useId()

const name = ref('')
const inputRef = ref<{ focus?: () => void } | null>(null)

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      name.value = ''
      void nextTick(() => {
        inputRef.value?.focus?.()
      })
    }
  }
)

function handleSubmit() {
  const trimmed = name.value.trim()
  if (!trimmed || props.isSubmitting) return
  emit('submit', trimmed)
}

function close() {
  if (props.isSubmitting) return
  emit('close')
}
</script>

<style scoped>
.create-entity-dialog {
  width: min(100% - 2 * var(--space-lg), 28rem);
}

.create-entity-modal {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

.create-entity-modal-title {
  margin: 0;
  color: var(--color-base-content);
  font-size: var(--text-title);
  font-weight: 600;
  line-height: var(--leading-tight);
}

.create-entity-field {
  padding: 0;
}

.create-entity-field :deep(.field-row-control) {
  width: 100%;
}

.create-entity-field :deep(.input) {
  width: 100%;
  max-width: 100%;
}

.create-entity-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
}
</style>
