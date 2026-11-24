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
        <span class="create-command-label">{{ t('commands.typeLabel') }}</span>

        <div class="create-command-list" role="list">
          <template v-for="(item, index) in commandItems" :key="item.key">
            <button
              type="button"
              class="create-command-item"
              :autofocus="index === 0 ? true : undefined"
              @pointerdown="preventMouseFocus"
              @keydown="handleItemKeydown($event, index)"
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
import { preventMouseFocus } from '../../lib/ui/focus'
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
  operationId: string
}

interface CommandItemOption {
  key: string
  operationId: string
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

function defaultIconForOperation(operationId: string): string {
  if (operationId === 'script') return 'mdi:console'
  if (operationId === 'webhook') return 'mdi:webhook'
  if (operationId === 'core.aiTask') return 'mdi:robot-outline'
  return 'mdi:puzzle-outline'
}

const commandItems = computed<CommandItemOption[]>(() =>
  props.tools.map((tool) => ({
    key: tool.id,
    operationId: tool.id,
    name: tool.name,
    description: tool.description,
    icon: tool.icon ?? defaultIconForOperation(tool.id),
  }))
)

function handleSelect(item: CommandItemOption) {
  emit('submit', { operationId: item.operationId })
}

function handleItemKeydown(event: KeyboardEvent, index: number) {
  const items = Array.from(
    (
      event.currentTarget as HTMLElement | null
    )?.parentElement?.querySelectorAll<HTMLButtonElement>(
      '.create-command-item'
    ) ?? []
  )
  if (items.length <= 1) return

  let nextIndex: number
  if (event.key === 'ArrowDown') {
    nextIndex = (index + 1) % items.length
  } else if (event.key === 'ArrowUp') {
    nextIndex = (index - 1 + items.length) % items.length
  } else if (event.key === 'Home') {
    nextIndex = 0
  } else if (event.key === 'End') {
    nextIndex = items.length - 1
  } else {
    return
  }

  event.preventDefault()
  items[nextIndex]?.focus()
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
