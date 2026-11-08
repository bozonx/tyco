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

      <div class="create-command-section">
        <span class="create-command-label">{{
          t('commands.toolTypeLabel')
        }}</span>
        <div class="create-command-list" role="radiogroup">
          <button
            v-for="tool in tools"
            :key="tool.id"
            type="button"
            role="radio"
            :aria-checked="selectedToolId === tool.id"
            class="create-command-item"
            :class="{ 'is-selected': selectedToolId === tool.id }"
            @click="selectedToolId = tool.id"
          >
            <AppIcon
              :icon="tool.icon ?? defaultIconForTool(tool.id)"
              size="lg"
              class="create-command-item-icon"
              aria-hidden="true"
            />
            <span class="create-command-item-copy">
              <span class="create-command-item-name">{{ tool.name }}</span>
              <span v-if="tool.description" class="create-command-item-desc">
                {{ tool.description }}
              </span>
            </span>
            <AppIcon
              v-if="selectedToolId === tool.id"
              icon="mdi:check"
              size="md"
              class="create-command-item-check"
              aria-hidden="true"
            />
          </button>
        </div>
      </div>

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
import AppIcon from '../common/AppIcon.vue'
import BaseDialog from '../common/BaseDialog.vue'
import Button from '../common/Button.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'

export type AiCommandTemplate = 'none' | 'fix' | 'translate' | 'style'

export interface CreateCommandToolOption {
  id: string
  name: string
  description?: string
  icon?: string
}

export interface CreateCommandSubmitEvent {
  toolId: string
  template?: AiCommandTemplate
}

const props = defineProps<{ open: boolean; tools: CreateCommandToolOption[] }>()

const emit = defineEmits<{
  close: []
  submit: [event: CreateCommandSubmitEvent]
}>()

const { t } = useI18n()
const titleId = useId()

const selectedToolId = ref(props.tools[0]?.id ?? '')
const selectedTemplate = ref<AiCommandTemplate>('none')

function defaultIconForTool(toolId: string): string {
  if (toolId === 'script') return 'mdi:console'
  if (toolId === 'webhook') return 'mdi:webhook'
  if (toolId === 'core.aiTask') return 'mdi:robot-outline'
  return 'mdi:puzzle-outline'
}

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
  width: min(100% - 2 * var(--space-lg), 32rem);
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

.create-command-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.create-command-label {
  font-size: var(--text-caption);
  font-weight: 500;
  color: var(--app-text-muted);
}

.create-command-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  max-height: 18rem;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-right: var(--space-xxs);
}

.create-command-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-md);
  background-color: var(--app-surface-raised);
  text-align: start;
  color: inherit;
  cursor: pointer;
  transition:
    background-color var(--transition-fast),
    border-color var(--transition-fast);
}

.create-command-item:hover {
  background-color: var(--app-hover);
  border-color: var(--app-border);
}

.create-command-item.is-selected {
  border-color: var(--color-primary);
  background-color: var(--app-surface-active, var(--app-hover));
}

.create-command-item-icon {
  flex-shrink: 0;
  color: var(--color-primary);
}

.create-command-item-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.create-command-item-name {
  font-size: var(--text-body);
  font-weight: 500;
  color: var(--color-base-content);
}

.create-command-item-desc {
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}

.create-command-item-check {
  flex-shrink: 0;
  color: var(--color-primary);
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
