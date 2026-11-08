<template>
  <BaseDialog
    class="create-command-dialog"
    :open="open"
    :labelledby="titleId"
    @close="close"
  >
    <div class="create-command-modal">
      <div class="create-command-modal-header">
        <h3 :id="titleId" class="create-command-modal-title">
          {{ t('commands.createModalTitle') }}
        </h3>
        <IconButton
          icon="mdi:close"
          size="sm"
          variant="ghost"
          :label="t('common.cancel')"
          @click="close"
        />
      </div>

      <div class="create-command-section">
        <span class="create-command-label">{{
          t('commands.toolTypeLabel')
        }}</span>

        <div class="create-command-list" role="list">
          <template v-for="item in commandItems" :key="item.key">
            <button
              type="button"
              class="create-command-item"
              @click="handleSelect(item)"
            >
              <AppIcon
                :icon="item.icon"
                size="lg"
                class="create-command-item-icon"
                aria-hidden="true"
              />
              <span class="create-command-item-copy">
                <span class="create-command-item-name">{{ item.name }}</span>
                <span v-if="item.description" class="create-command-item-desc">
                  {{ item.description }}
                </span>
              </span>
            </button>
          </template>
        </div>
      </div>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, useId } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import AppIcon from '../common/AppIcon.vue'
import BaseDialog from '../common/BaseDialog.vue'
import IconButton from '../common/IconButton.vue'

export interface CreateCommandToolOption {
  id: string
  name: string
  description?: string
  icon?: string
}

export interface CreateCommandSubmitEvent {
  toolId: string
}

interface CommandItemOption {
  key: string
  toolId: string
  name: string
  description?: string
  icon: string
}

const props = defineProps<{ open: boolean; tools: CreateCommandToolOption[] }>()

const emit = defineEmits<{
  close: []
  submit: [event: CreateCommandSubmitEvent]
}>()

const { t } = useI18n()
const titleId = useId()

function defaultIconForTool(toolId: string): string {
  if (toolId === 'script') return 'mdi:console'
  if (toolId === 'webhook') return 'mdi:webhook'
  if (toolId === 'core.aiTask') return 'mdi:robot-outline'
  return 'mdi:puzzle-outline'
}

const commandItems = computed<CommandItemOption[]>(() =>
  props.tools.map((tool) => ({
    key: tool.id,
    toolId: tool.id,
    name: tool.name,
    description: tool.description,
    icon: tool.icon ?? defaultIconForTool(tool.id),
  }))
)

function handleSelect(item: CommandItemOption) {
  emit('submit', { toolId: item.toolId })
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
  gap: var(--space-md);
}

.create-command-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
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
  max-height: 22rem;
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
</style>
