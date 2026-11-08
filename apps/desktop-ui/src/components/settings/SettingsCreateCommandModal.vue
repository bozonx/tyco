<template>
  <BaseDialog
    class="create-command-dialog"
    :open="open"
    :labelledby="titleId"
    @close="close"
  >
    <form class="create-command-modal" @submit.prevent="handleSubmit">
      <h3 :id="titleId" class="create-command-modal-title">
        {{ t('commands.createModalTitle') }}
      </h3>

      <FieldRow
        class="create-command-field"
        vertical
        :separator="false"
        :label="t('commands.toolTypeLabel')"
      >
        <FieldSelect v-model="selectedToolId" :options="toolOptions" />
      </FieldRow>

      <FieldRow
        v-if="selectedToolId === 'core.aiTask'"
        class="create-command-field"
        vertical
        :separator="false"
        :label="t('commands.templateLabel')"
      >
        <FieldSelect v-model="selectedTemplate" :options="templateOptions" />
      </FieldRow>

      <div class="create-command-modal-actions">
        <Button size="sm" variant="ghost" type="button" @click="close">
          {{ t('common.cancel') }}
        </Button>
        <Button
          size="sm"
          variant="primary"
          type="submit"
          :disabled="!selectedToolId"
        >
          {{ t('common.confirm') }}
        </Button>
      </div>
    </form>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import type { ControlOption } from '../../lib/ui/control-option'
import BaseDialog from '../common/BaseDialog.vue'
import Button from '../common/Button.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'

export type AiCommandTemplate = 'none' | 'fix' | 'translate' | 'style'

export interface CreateCommandSubmitEvent {
  toolId: string
  template?: AiCommandTemplate
}

const props = defineProps<{
  open: boolean
  tools: { id: string; name: string }[]
}>()

const emit = defineEmits<{
  close: []
  submit: [event: CreateCommandSubmitEvent]
}>()

const { t } = useI18n()
const titleId = useId()

const selectedToolId = ref(props.tools[0]?.id ?? '')
const selectedTemplate = ref<AiCommandTemplate>('none')

const toolOptions = computed<ControlOption[]>(() =>
  props.tools.map((tool) => ({ id: tool.id, name: tool.name }))
)

const templateOptions = computed<ControlOption[]>(() => [
  { id: 'none', name: t('commands.templateNone') },
  { id: 'fix', name: t('commands.templateFix') },
  { id: 'translate', name: t('commands.templateTranslate') },
  { id: 'style', name: t('commands.templateStyle') },
])

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      selectedToolId.value = props.tools[0]?.id ?? ''
      selectedTemplate.value = 'none'
    }
  },
  { immediate: true }
)

function handleSubmit() {
  if (!selectedToolId.value) return
  emit('submit', {
    toolId: selectedToolId.value,
    template:
      selectedToolId.value === 'core.aiTask'
        ? selectedTemplate.value
        : undefined,
  })
}

function close() {
  emit('close')
}
</script>

<style scoped>
.create-command-dialog {
  width: min(100% - 2 * var(--space-lg), 28rem);
}

.create-command-modal {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

.create-command-modal-title {
  margin: 0;
  color: var(--color-base-content);
  font-size: var(--text-title);
  font-weight: 600;
  line-height: var(--leading-tight);
}

.create-command-field {
  padding: 0;
}

.create-command-field :deep(.field-row-control) {
  width: 100%;
}

.create-command-field :deep(.select) {
  width: 100%;
  max-width: 100%;
}

.create-command-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
}
</style>
